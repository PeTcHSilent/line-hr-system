// ══════════════════════════════════════════════════════
// Admin LINE Users — จัดการ admin_line_users ผ่าน UI
// ══════════════════════════════════════════════════════
const express = require('express');
const router  = express.Router();
const db      = require('../db');
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
    res.json(rows[0]);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE /api/admin-users/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await ensureTable();
    const { rowCount } = await db.query('DELETE FROM admin_line_users WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'ไม่พบรายการ' });
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
