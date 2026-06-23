// ══════════════════════════════════════════════════════
// Probation Evaluations — ประเมินผลการทดลองงาน
// ══════════════════════════════════════════════════════
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

async function ensureTable() {
  // เพิ่มคอลัมน์ probation_start_date ในตาราง employees ถ้ายังไม่มี
  await db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS probation_start_date DATE`);

  // สร้างตาราง probation_evaluations
  await db.query(`
    CREATE TABLE IF NOT EXISTS probation_evaluations (
      id           SERIAL PRIMARY KEY,
      employee_id  INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      eval_date    DATE NOT NULL DEFAULT CURRENT_DATE,
      eval_score   SMALLINT CHECK (eval_score BETWEEN 1 AND 5),
      eval_result  VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (eval_result IN ('passed','failed','extended','pending')),
      eval_note    TEXT,
      eval_by      VARCHAR(100),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_prob_eval_emp ON probation_evaluations(employee_id)
  `);
}

// GET /api/probation-eval/:employeeId — ดูประวัติประเมินของพนักงาน
router.get('/:employeeId', requireAuth, async (req, res) => {
  try {
    await ensureTable();
    const { rows } = await db.query(
      `SELECT pe.*, e.name AS employee_name, e.employee_code
       FROM probation_evaluations pe
       JOIN employees e ON e.id = pe.employee_id
       WHERE pe.employee_id = $1
       ORDER BY pe.eval_date DESC, pe.id DESC`,
      [req.params.employeeId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/probation-eval — บันทึกผลประเมิน
router.post('/', requireAuth, async (req, res) => {
  try {
    await ensureTable();
    const { employee_id, eval_date, eval_score, eval_result, eval_note, eval_by } = req.body;
    if (!employee_id) return res.status(400).json({ error: 'ต้องระบุ employee_id' });
    if (!eval_result) return res.status(400).json({ error: 'ต้องระบุผลการประเมิน' });

    const { rows } = await db.query(
      `INSERT INTO probation_evaluations (employee_id, eval_date, eval_score, eval_result, eval_note, eval_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        employee_id,
        eval_date || new Date().toISOString().slice(0, 10),
        eval_score || null,
        eval_result,
        eval_note?.trim() || null,
        eval_by?.trim() || null,
      ]
    );

    // อัปเดต probation_status ของพนักงานอัตโนมัติถ้าผลชัดเจน
    if (['passed', 'failed', 'extended'].includes(eval_result)) {
      await db.query(
        `UPDATE employees SET probation_status = $1, updated_at = NOW() WHERE id = $2`,
        [eval_result, employee_id]
      );
    }

    res.status(201).json(rows[0]);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE /api/probation-eval/:id — ลบรายการประเมิน
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await ensureTable();
    const { rowCount } = await db.query(
      'DELETE FROM probation_evaluations WHERE id = $1', [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'ไม่พบรายการ' });
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
