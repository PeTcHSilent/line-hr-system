'use strict';
/**
 * accountingSyncRoutes.js — ส่งสรุปเงินเดือนให้ระบบบัญชี (line-accounting)
 *
 * ป้องกันด้วย header 'x-sync-key' เทียบกับ env HR_SYNC_SECRET
 * (กุญแจดอกเดียวกับที่ระบบ Sales ใช้ดึงข้อมูลพนักงานจากที่นี่)
 *
 * ❗ อ่านอย่างเดียว — ระบบบัญชีแก้ข้อมูลเงินเดือนไม่ได้
 *    ตัวเลขผิดต้องไปแก้ที่ระบบ HR ซึ่งเป็นเจ้าของข้อมูลจริง
 *
 * ❗ ไม่ส่งข้อมูลส่วนบุคคลเกินจำเป็น — ส่งแค่รหัสพนักงาน ชื่อ แผนก
 *    และตัวเลขที่จำเป็นต่อการลงบัญชี ไม่ส่งเลขบัตร ที่อยู่ เบอร์โทร
 *    บัญชีธนาคาร หรือข้อมูลการลา
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');

// ❗ ไม่ได้ตั้งกุญแจ = ปิดช่องทาง ไม่ใช่เปิดฟรี
//    ตรงนี้ต่างจาก /api/employee/notify-targets เดิมที่ปล่อยผ่านเมื่อไม่ได้ตั้งค่า
//    เงินเดือนเป็นข้อมูลที่อ่อนไหวกว่ารายชื่อพนักงานมาก
function requireSyncKey(req, res, next) {
  const secret = process.env.HR_SYNC_SECRET;
  if (!secret) {
    return res.status(503).json({
      success: false,
      error: 'ยังไม่ได้ตั้ง HR_SYNC_SECRET ในระบบ HR — ช่องทาง sync ปิดอยู่',
    });
  }
  const given = req.headers['x-sync-key'];
  if (typeof given !== 'string' || given.length !== secret.length || given !== secret) {
    return res.status(401).json({ success: false, error: 'x-sync-key ไม่ถูกต้อง' });
  }
  return next();
}

router.use(requireSyncKey);

// ══════════════════════════════════════════════════════════════
//  GET /api/accounting-sync/payroll?year=2026&month=10
//  สรุปเงินเดือนของเดือนนั้น รายคน
// ══════════════════════════════════════════════════════════════
//
// ❗ year ที่รับคือ ค.ศ. ตามที่ payroll_records เก็บ
//    ฝั่งบัญชีเก็บงวดเป็น พ.ศ. จึงต้องแปลงก่อนเรียก — ทำที่ฝั่งนั้น
//
// ❗ ส่งเฉพาะ status = confirmed / paid
//    'draft' คือยังคำนวณไม่เสร็จ ตัวเลขเปลี่ยนได้ตลอด
//    ลงบัญชีจากร่างแล้วงบจะเพี้ยนโดยไม่มีใครรู้ว่าเพี้ยนตอนไหน
//
router.get('/payroll', async (req, res) => {
  const year  = Number(req.query.year);
  const month = Number(req.query.month);

  if (!Number.isInteger(year) || year < 2000 || year > 2200)
    return res.status(400).json({ success: false, error: 'year ต้องเป็นปี ค.ศ. เช่น 2026' });
  if (!Number.isInteger(month) || month < 1 || month > 12)
    return res.status(400).json({ success: false, error: 'month ต้องอยู่ระหว่าง 1-12' });

  try {
    const { rows } = await db.query(`
      SELECT
        e.employee_code,
        e.name                         AS employee_name,
        d.name                         AS department,
        COALESCE(p.gross_income,    0) AS gross_income,
        COALESCE(p.ot_pay,          0) AS ot_pay,
        COALESCE(p.social_security, 0) AS sso_employee,
        COALESCE(p.provident_fund,  0) AS provident_fund,
        COALESCE(p.tax_withholding, 0) AS tax_withholding,
        COALESCE(p.other_deduction, 0) AS other_deduction,
        COALESCE(p.total_deduction, 0) AS total_deduction,
        COALESCE(p.net_income,      0) AS net_income,
        p.status
      FROM payroll_records p
      JOIN employees e        ON e.id = p.employee_id
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE p.year = $1 AND p.month = $2
        AND p.status IN ('confirmed', 'paid')
      ORDER BY e.employee_code
    `, [year, month]);

    // นับร่างที่ยังไม่ยืนยัน — บอกฝั่งบัญชีว่ายังไม่ควรปิดงบ
    const draft = await db.query(
      "SELECT COUNT(*)::int AS n FROM payroll_records WHERE year=$1 AND month=$2 AND status='draft'",
      [year, month]);

    const employees = rows.map(r => ({
      ...r,
      // เงินสมทบประกันสังคมฝั่งนายจ้าง = เท่ากับฝั่งลูกจ้าง
      // ❗ เป็นต้นทุนของบริษัทที่ไม่ปรากฏในสลิปพนักงาน
      //    ลืมบวกตัวนี้ = ประเมินต้นทุนทีมต่ำกว่าจริงทุกเดือน
      sso_employer: Number(r.sso_employee),
    }));

    res.json({
      success: true,
      period: { year, month },
      note: 'ส่งเฉพาะรายการที่ยืนยันแล้ว (confirmed/paid) | sso_employer = เงินสมทบฝั่งนายจ้าง เท่ากับฝั่งลูกจ้าง',
      warnings: { draft_records: draft.rows[0].n },
      employees,
    });
  } catch (err) {
    console.error('[acc-sync] payroll:', err);
    res.status(500).json({ success: false, error: 'ดึงข้อมูลเงินเดือนไม่สำเร็จ' });
  }
});

// ── ให้ฝั่งบัญชีเช็คว่ากุญแจถูกไหมก่อนดึงจริง ─────────────────
router.get('/ping', (_req, res) =>
  res.json({ success: true, service: 'hr', ts: new Date().toISOString() }));

module.exports = router;
