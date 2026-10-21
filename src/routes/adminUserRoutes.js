// ══════════════════════════════════════════════════════
// Admin LINE Users — จัดการ admin_line_users ผ่าน UI
// ══════════════════════════════════════════════════════
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const audit   = require('../services/auditService');
const { requireAuth } = require('../middleware/authMiddleware');

async function ensureTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_line_users (
      id           SERIAL PRIMARY KEY,
      line_user_id VARCHAR(50) NOT NULL UNIQUE,
      name         VARCHAR(100),
      note         TEXT
    )
  `);
  // เพิ่มคอลัมน์ที่ขาดหาย (กรณีตารางถูกสร้างจาก migration_v13 ซึ่งใช้ schema เก่า)
  await db.query(`ALTER TABLE admin_line_users ADD COLUMN IF NOT EXISTS name VARCHAR(100)`);
  await db.query(`ALTER TABLE admin_line_users ADD COLUMN IF NOT EXISTS note TEXT`);
  await db.query(`ALTER TABLE admin_line_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
}

// ══════════════════════════════════════════════════════
//  ตรวจระบบแจ้งเตือน — "ทำไมกดลา/OT แล้วไม่มีแจ้งเตือน"
//
//  ❗ มีไว้เพื่อตอบคำถามนี้ได้เองโดยไม่ต้องไล่อ่าน log
//    สาเหตุที่เป็นไปได้มี 4 ข้อ และแยกจากกันไม่ออกถ้าไม่ตรวจทีละชั้น:
//      1. ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN
//      2. Token ผิด / เป็นของ LINE OA คนละตัว
//      3. ไม่มีรายชื่อ Admin LINE เลย
//      4. มีรายชื่อ แต่คนนั้นยังไม่ได้แอด OA เป็นเพื่อน
//         (หรือ User ID เป็นของ OA เดิมที่เลิกใช้แล้ว — User ID ผูกกับ OA)
// ══════════════════════════════════════════════════════
router.get('/diagnose', requireAuth, async (req, res) => {
  try {
    await ensureTable();
    const push = require('../services/pushService');

    const bot = await push.botInfo();
    const { rows: admins } = await db.query(
      'SELECT id, line_user_id, name FROM admin_line_users ORDER BY created_at');

    // ตรวจทีละคนว่ารับข้อความได้จริงไหม (ใช้ getProfile ไม่ได้ส่งข้อความรบกวน)
    const checked = bot.ok
      ? await Promise.all(admins.map(async a => ({
          ...a,
          ...(await push.canReceive(a.line_user_id)),
        })))
      : admins.map(a => ({ ...a, ok: false, reason: 'ตรวจไม่ได้ เพราะ token ใช้ไม่ได้' }));

    // หัวหน้าที่ผูก LINE ไว้ (ช่องทางสำรองเวลาไม่มี Admin LINE)
    const { rows: mgr } = await db.query(
      `SELECT COUNT(*)::int AS n FROM employees
        WHERE line_user_id IS NOT NULL AND TRIM(line_user_id) <> ''
          AND id IN (SELECT DISTINCT manager_id FROM employees WHERE manager_id IS NOT NULL)`);

    const reachable = checked.filter(c => c.ok).length;

    // สรุปเป็นข้อความเดียวที่บอกได้เลยว่าต้องไปแก้อะไร
    let verdict, fix = null;
    if (!bot.ok) {
      verdict = 'ส่งแจ้งเตือนไม่ได้เลย — ปัญหาอยู่ที่ LINE Token';
      fix = bot.error;
    } else if (!admins.length) {
      verdict = 'ส่งแจ้งเตือนไม่ได้เลย — ยังไม่มีรายชื่อ Admin LINE';
      fix = 'ไปที่หน้า "Admin LINE" แล้วเพิ่ม LINE User ID ของคนที่ต้องรับแจ้งเตือน ' +
            'หรือให้คนนั้นพิมพ์คำสั่งผูกบัญชีในแชท LINE OA';
    } else if (reachable === 0) {
      verdict = `มีรายชื่อ ${admins.length} คน แต่ส่งถึงไม่ได้สักคน`;
      fix = 'ทุกคนต้องเพิ่ม LINE OA ของระบบ HR (' + (bot.basic_id || '-') + ') เป็นเพื่อนก่อน — ' +
            'ถ้าแอดแล้วยังไม่ได้ แปลว่า User ID ที่บันทึกไว้เป็นของ LINE OA ตัวเดิม ต้องผูกใหม่';
    } else if (reachable < admins.length) {
      verdict = `ส่งถึงได้ ${reachable} จาก ${admins.length} คน — บางคนยังไม่ได้รับ`;
      fix = 'ดูรายชื่อด้านล่างว่าคนไหนติดปัญหา แล้วให้คนนั้นแอด OA เป็นเพื่อนหรือผูกบัญชีใหม่';
    } else {
      verdict = `พร้อมใช้งาน — ส่งถึงได้ครบทั้ง ${admins.length} คน`;
    }

    res.json({
      ok: bot.ok && reachable > 0,
      verdict, fix,
      token: bot.ok
        ? { ok: true, oa_name: bot.display_name, basic_id: bot.basic_id }
        : { ok: false, error: bot.error },
      admins: checked,
      summary: { total: admins.length, reachable, unreachable: admins.length - reachable },
      managers_with_line: mgr[0].n,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin-users/:id/test — ส่งข้อความทดสอบจริงไปหาคนนั้น
// ❗ แยกจาก /diagnose ตั้งใจ — diagnose ตรวจได้โดยไม่รบกวนใคร
//   ส่วนอันนี้รบกวนจริง จึงต้องกดเจาะจงเป็นรายคน
router.post('/:id/test', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT line_user_id, name FROM admin_line_users WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบรายชื่อนี้' });

    const r = await require('../services/pushService').pushTo(
      [rows[0].line_user_id],
      [{ type: 'text',
         text: '🔔 ทดสอบระบบแจ้งเตือน HR\n\nถ้าเห็นข้อความนี้ แปลว่าการแจ้งเตือน ลา/OT/เบิกเงิน จะส่งถึงคุณได้แล้ว' }],
      'ทดสอบแจ้งเตือน');

    if (r.sent) return res.json({ success: true, message: 'ส่งแล้ว — ลองเช็คใน LINE' });
    res.status(400).json({
      error: r.failed[0]?.reason || 'ส่งไม่สำเร็จ โดยไม่ทราบสาเหตุ',
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin-users
router.get('/', requireAuth, async (req, res) => {
  try {
    await ensureTable();
    const { rows } = await db.query('SELECT * FROM admin_line_users ORDER BY created_at');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin-users
router.post('/', requireAuth, async (req, res) => {
  try {
    await ensureTable();
    const { line_user_id, name, note } = req.body;
    if (!line_user_id?.trim()) return res.status(400).json({ error: 'ต้องระบุ LINE User ID' });
    const { rows } = await db.query(
      `INSERT INTO admin_line_users (line_user_id, name, note)
       VALUES ($1, $2, $3) RETURNING *`,
      [line_user_id.trim(), name?.trim() || null, note?.trim() || null]
    );
    audit.log({
      actorName:   req.admin.display_name || req.admin.username,
      actorRole:   req.admin.role,
      action:      'add_admin_line_user',
      targetType:  'admin_user',
      targetId:    rows[0].id,
      description: 'เพิ่ม Admin LINE: ' + (name || line_user_id),
      meta:        { line_user_id: line_user_id.trim(), name: name && name.trim() },
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'LINE User ID นี้มีอยู่แล้ว' });
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/admin-users/:id
router.put('/:id', requireAuth, async (req, res) => {
  try {
    await ensureTable();
    const { name, note } = req.body;
    const { rows } = await db.query(
      `UPDATE admin_line_users SET name=$2, note=$3 WHERE id=$1 RETURNING *`,
      [req.params.id, name?.trim() || null, note?.trim() || null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบรายการ' });
    audit.log({
      actorName:   req.admin.display_name || req.admin.username,
      actorRole:   req.admin.role,
      action:      'update_admin_line_user',
      targetType:  'admin_user',
      targetId:    rows[0].id,
      description: 'แก้ไข Admin LINE: ' + (rows[0].name || rows[0].line_user_id),
      meta:        { name: rows[0].name, note: rows[0].note },
    });
    res.json(rows[0]);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE /api/admin-users/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await ensureTable();
    const { rows: before } = await db.query('SELECT * FROM admin_line_users WHERE id=$1', [req.params.id]);
    const { rowCount } = await db.query('DELETE FROM admin_line_users WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'ไม่พบรายการ' });
    audit.log({
      actorName:   req.admin.display_name || req.admin.username,
      actorRole:   req.admin.role,
      action:      'remove_admin_line_user',
      targetType:  'admin_user',
      targetId:    parseInt(req.params.id),
      description: 'ลบ Admin LINE: ' + (before[0] && (before[0].name || before[0].line_user_id) || req.params.id),
      meta:        { line_user_id: before[0] && before[0].line_user_id, name: before[0] && before[0].name },
    });
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
