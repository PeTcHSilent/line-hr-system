// ══════════════════════════════════════════════════════
// Shift Management — กะการทำงาน
// ══════════════════════════════════════════════════════
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

async function ensureTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS shifts (
      id             SERIAL PRIMARY KEY,
      name           VARCHAR(50) NOT NULL,
      start_time     TIME NOT NULL,
      end_time       TIME NOT NULL,
      break_minutes  INT NOT NULL DEFAULT 60,
      is_active      BOOLEAN NOT NULL DEFAULT TRUE,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS employee_shifts (
      id             SERIAL PRIMARY KEY,
      employee_id    INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      shift_id       INT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
      effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
      end_date       DATE,
      day_of_week    SMALLINT[],
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (employee_id, effective_date)
    )
  `);
}

// ── GET /api/shift — รายการกะทั้งหมด ─────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    await ensureTables();
    const { rows } = await db.query('SELECT * FROM shifts ORDER BY start_time');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/shift — สร้างกะใหม่ ────────────────────
router.post('/', requireAuth, async (req, res) => {
  try {
    await ensureTables();
    const { name, start_time, end_time, break_minutes } = req.body;
    if (!name || !start_time || !end_time) return res.status(400).json({ error: 'ต้องระบุ name, start_time, end_time' });
    const { rows } = await db.query(
      `INSERT INTO shifts (name, start_time, end_time, break_minutes)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name.trim(), start_time, end_time, break_minutes || 60]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── PUT /api/shift/:id ────────────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  try {
    await ensureTables();
    const { name, start_time, end_time, break_minutes, is_active } = req.body;
    const { rows } = await db.query(
      `UPDATE shifts SET name=$2, start_time=$3, end_time=$4,
         break_minutes=$5, is_active=$6 WHERE id=$1 RETURNING *`,
      [req.params.id, name, start_time, end_time, break_minutes ?? 60, is_active ?? true]
    );
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบกะ' });
    res.json(rows[0]);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── DELETE /api/shift/:id ─────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await ensureTables();
    const { rowCount } = await db.query('DELETE FROM shifts WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'ไม่พบกะ' });
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── GET /api/shift/assignments — กะทั้งหมดของพนักงาน ──
router.get('/assignments', requireAuth, async (req, res) => {
  try {
    await ensureTables();
    const { employee_id } = req.query;
    const { rows } = await db.query(
      `SELECT es.*, s.name AS shift_name, s.start_time, s.end_time, s.break_minutes,
              e.name AS employee_name, e.employee_code
       FROM employee_shifts es
       JOIN shifts s ON s.id = es.shift_id
       JOIN employees e ON e.id = es.employee_id
       WHERE ($1::int IS NULL OR es.employee_id = $1)
       ORDER BY es.effective_date DESC`,
      [employee_id ? parseInt(employee_id) : null]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/shift/assign — กำหนดกะให้พนักงาน ────────
router.post('/assign', requireAuth, async (req, res) => {
  try {
    await ensureTables();
    const { employee_id, shift_id, effective_date, end_date, day_of_week } = req.body;
    if (!employee_id || !shift_id) return res.status(400).json({ error: 'ต้องระบุ employee_id และ shift_id' });
    const { rows } = await db.query(
      `INSERT INTO employee_shifts (employee_id, shift_id, effective_date, end_date, day_of_week)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (employee_id, effective_date)
       DO UPDATE SET shift_id=$2, end_date=$4, day_of_week=$5
       RETURNING *`,
      [employee_id, shift_id, effective_date || new Date().toISOString().slice(0,10),
       end_date || null, day_of_week || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── DELETE /api/shift/assignments/:id ────────────────
router.delete('/assignments/:id', requireAuth, async (req, res) => {
  try {
    await ensureTables();
    const { rowCount } = await db.query('DELETE FROM employee_shifts WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'ไม่พบรายการ' });
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── GET /api/shift/employee/:id/current — กะปัจจุบันของพนักงาน ─
router.get('/employee/:id/current', async (req, res) => {
  try {
    await ensureTables();
    const today = new Date().toISOString().slice(0, 10);
    const { rows } = await db.query(
      `SELECT es.*, s.name AS shift_name, s.start_time, s.end_time, s.break_minutes
       FROM employee_shifts es
       JOIN shifts s ON s.id = es.shift_id
       WHERE es.employee_id = $1
         AND es.effective_date <= $2
         AND (es.end_date IS NULL OR es.end_date >= $2)
       ORDER BY es.effective_date DESC LIMIT 1`,
      [req.params.id, today]
    );
    res.json(rows[0] || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
