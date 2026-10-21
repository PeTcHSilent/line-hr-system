'use strict';
/**
 * offboardService.js — ขั้นตอนเมื่อพนักงานลาออก
 *
 * ❗ ทำไมต้องรวมไว้ที่เดียว
 *   เดิมการ "ให้ออก" คือแค่ตั้ง is_active = false ซึ่งทิ้งงานค้างไว้เต็มไปหมด:
 *     · LINE ยังผูกอยู่ → เช็คอิน/ยื่นลาผ่าน LIFF ได้ต่อทั้งที่ออกไปแล้ว
 *     · ใบลา/OT/เบิกเงินที่ยังรออนุมัติ ค้างในคิวหัวหน้าตลอดไป
 *     · รหัสพนักงานยังถูกจองไว้ รับคนใหม่แล้วใช้รหัสเดิมไม่ได้
 *   สามอย่างนี้เกิดพร้อมกันเสมอ จึงต้องทำพร้อมกันใน transaction เดียว
 *   ไม่ใช่ให้ HR ไล่กดทีละหน้าแล้วลืมข้อใดข้อหนึ่ง
 *
 * ❗ สิ่งที่จงใจ "ไม่" ทำ
 *   · ไม่ลบประวัติใด ๆ — เงินเดือน ลา เข้าออก ต้องเก็บตามกฎหมาย
 *   · ไม่เปลี่ยนรหัสพนักงานคนเก่า — สลิปที่ออกไปแล้วต้องยังตรงกับระบบ
 *   · ไม่ยุ่งกับคำขอที่อนุมัติไปแล้ว — เป็นข้อเท็จจริงที่เกิดขึ้นจริง
 */

const db = require('../db');

/** ตารางที่มีจริงในฐานข้อมูลนี้เท่านั้น — เผื่อบางระบบยังไม่ได้รัน migration ครบ */
async function tableExists(name) {
  const r = await db.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name=$1`, [name]);
  return r.rowCount > 0;
}

/**
 * ดูก่อนว่าถ้ากด "ออก" จะมีอะไรถูกยกเลิกบ้าง — ยังไม่เปลี่ยนอะไร
 *
 * ❗ ต้องมีขั้นนี้ เพราะการยกเลิกใบลาที่รออนุมัติอยู่เป็นเรื่องใหญ่
 *   HR ควรเห็นก่อนว่ากำลังจะยกเลิกอะไร ไม่ใช่กดแล้วหายไปเงียบ ๆ
 */
async function preview(employeeId) {
  const emp = (await db.query(
    `SELECT id, employee_code, name, line_user_id, is_active FROM employees WHERE id=$1`,
    [employeeId])).rows[0];
  if (!emp) throw new Error('ไม่พบพนักงานคนนี้');

  const out = {
    employee: emp,
    pending_leave: 0,
    pending_ot: 0,
    pending_expense: 0,
    has_line: !!emp.line_user_id,
    is_manager_of: 0,
    in_admin_line: false,
  };

  if (await tableExists('leave_requests')) {
    out.pending_leave = (await db.query(
      `SELECT COUNT(*)::int n FROM leave_requests WHERE employee_id=$1 AND status='pending'`,
      [employeeId])).rows[0].n;
  }
  if (await tableExists('ot_records')) {
    out.pending_ot = (await db.query(
      `SELECT COUNT(*)::int n FROM ot_records WHERE employee_id=$1 AND status='pending'`,
      [employeeId])).rows[0].n;
  }
  if (await tableExists('expense_claims')) {
    out.pending_expense = (await db.query(
      `SELECT COUNT(*)::int n FROM expense_claims WHERE employee_id=$1 AND status='pending'`,
      [employeeId])).rows[0].n;
  }

  // ❗ ถ้าคนนี้เป็นหัวหน้าของใคร ต้องเตือน — ลูกน้องจะไม่มีคนอนุมัติ
  out.is_manager_of = (await db.query(
    `SELECT COUNT(*)::int n FROM employees WHERE manager_id=$1 AND is_active=TRUE`,
    [employeeId])).rows[0].n;

  if (emp.line_user_id && await tableExists('admin_line_users')) {
    out.in_admin_line = (await db.query(
      `SELECT 1 FROM admin_line_users WHERE line_user_id=$1`, [emp.line_user_id])).rowCount > 0;
  }

  // รหัสนี้จะว่างให้ใช้ซ้ำได้ไหมหลังออก
  out.code_will_be_free = true;

  return out;
}

/**
 * ให้พนักงานออก + ยกเลิกงานค้าง
 *
 * @param {number} employeeId
 * @param {{resign_date?:string, reason?:string, actor?:string}} opts
 */
async function resign(employeeId, opts = {}) {
  const { resign_date = null, reason = null, actor = null } = opts;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // ❗ ล็อกแถวไว้ กันกดพร้อมกันสองหน้าจอแล้วยกเลิกซ้อน
    const emp = (await client.query(
      `SELECT id, employee_code, name, line_user_id, is_active
         FROM employees WHERE id=$1 FOR UPDATE`, [employeeId])).rows[0];
    if (!emp) throw new Error('ไม่พบพนักงานคนนี้');
    if (!emp.is_active) throw new Error(`${emp.name} ถูกบันทึกว่าออกไปแล้ว`);

    const done = { leave: 0, ot: 0, expense: 0, line_unlinked: false, admin_removed: false };
    const note = `ยกเลิกอัตโนมัติ: พนักงานลาออก${resign_date ? ' (' + resign_date + ')' : ''}`;

    // ── 1. ยกเลิกคำขอที่ยังรออนุมัติ ─────────────────────────
    // ❗ เฉพาะ pending เท่านั้น — ที่อนุมัติไปแล้วคือข้อเท็จจริง ห้ามแตะ
    if (await tableExists('leave_requests')) {
      const r = await client.query(
        `UPDATE leave_requests
            SET status='rejected',
                reject_reason = COALESCE(NULLIF(TRIM(reject_reason),''), $2)
          WHERE employee_id=$1 AND status='pending'`, [employeeId, note]);
      done.leave = r.rowCount;
    }
    if (await tableExists('ot_records')) {
      const r = await client.query(
        `UPDATE ot_records SET status='rejected'
          WHERE employee_id=$1 AND status='pending'`, [employeeId]);
      done.ot = r.rowCount;
    }
    if (await tableExists('expense_claims')) {
      const r = await client.query(
        `UPDATE expense_claims
            SET status='rejected',
                reject_reason = COALESCE(NULLIF(TRIM(reject_reason),''), $2)
          WHERE employee_id=$1 AND status='pending'`, [employeeId, note]);
      done.expense = r.rowCount;
    }

    // ── 2. ปลด LINE ──────────────────────────────────────────
    // ❗ สำคัญกว่าที่คิด: ถ้าไม่ปลด คนที่ออกไปแล้วยังเช็คอินและยื่นลาได้
    //   และ LINE ID นั้นจะผูกกับคนใหม่ไม่ได้ด้วย (ระบบกันผูกซ้ำ)
    if (emp.line_user_id) {
      await client.query(`UPDATE employees SET line_user_id=NULL WHERE id=$1`, [employeeId]);
      done.line_unlinked = true;

      // ถ้าเคยเป็น Admin LINE ต้องถอดออก ไม่งั้นยังได้รับใบลาของคนอื่นอยู่
      if (await tableExists('admin_line_users')) {
        const r = await client.query(
          `DELETE FROM admin_line_users WHERE line_user_id=$1`, [emp.line_user_id]);
        done.admin_removed = r.rowCount > 0;
      }
    }

    // ── 3. บันทึกการลาออก ────────────────────────────────────
    // ❗ is_active=FALSE คือสิ่งที่ปล่อยรหัสพนักงานคืน (ดู migration v34)
    await client.query(
      `UPDATE employees
          SET is_active=FALSE,
              resign_date = COALESCE($2::date, CURRENT_DATE),
              resign_reason = $3,
              resigned_at = NOW(),
              resigned_by = $4
        WHERE id=$1`, [employeeId, resign_date, reason, actor]);

    await client.query('COMMIT');

    console.log(`[offboard] ${emp.name} (${emp.employee_code}) ออกแล้ว — ` +
      `ยกเลิกใบลา ${done.leave} · OT ${done.ot} · เบิกเงิน ${done.expense}` +
      `${done.line_unlinked ? ' · ปลด LINE' : ''}${done.admin_removed ? ' · ถอด Admin LINE' : ''}`);

    return { employee: emp, cancelled: done };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * รับกลับเข้าทำงาน
 * ❗ ต้องเช็คว่ารหัสเดิมถูกคนใหม่เอาไปใช้หรือยัง
 *   ถ้าใช้ไปแล้วจะกลับมาไม่ได้ด้วยรหัสเดิม — ต้องบอกให้ชัดตั้งแต่ตอนกด
 *   ไม่ใช่ปล่อยให้เจอ error จากฐานข้อมูลที่อ่านไม่รู้เรื่อง
 */
async function rehire(employeeId, actor = null) {
  const emp = (await db.query(
    `SELECT id, employee_code, name, is_active FROM employees WHERE id=$1`,
    [employeeId])).rows[0];
  if (!emp) throw new Error('ไม่พบพนักงานคนนี้');
  if (emp.is_active) throw new Error('คนนี้ยังทำงานอยู่');

  const taken = await db.query(
    `SELECT name FROM employees
      WHERE UPPER(employee_code)=UPPER($1) AND is_active=TRUE AND id<>$2`,
    [emp.employee_code, employeeId]);
  if (taken.rowCount)
    throw new Error(
      `รหัส ${emp.employee_code} ถูกใช้โดย ${taken.rows[0].name} แล้ว — ` +
      `ต้องเปลี่ยนรหัสของ ${emp.name} ก่อนรับกลับเข้าทำงาน`);

  await db.query(
    `UPDATE employees
        SET is_active=TRUE, resign_date=NULL, resign_reason=NULL,
            resigned_at=NULL, resigned_by=$2
      WHERE id=$1`, [employeeId, actor]);

  // ❗ ไม่คืน LINE ให้อัตโนมัติ — ต้องผูกใหม่เอง
  //   เพราะ LINE ID เดิมอาจถูกผูกกับคนอื่นไปแล้ว และการคืนสิทธิ์เข้าถึง
  //   ข้อมูลพนักงานควรเป็นการกระทำที่ตั้งใจ ไม่ใช่ผลพลอยได้
  return { employee: emp, note: 'ต้องให้พนักงานผูก LINE ใหม่เอง' };
}

module.exports = { preview, resign, rehire, tableExists };
