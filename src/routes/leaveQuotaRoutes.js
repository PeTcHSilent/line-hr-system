// ══════════════════════════════════════════════════════
// Leave Quota per Seniority — โควต้าลาตามอายุงาน
// ══════════════════════════════════════════════════════
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

async function ensureTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS leave_quota_rules (
      id              SERIAL PRIMARY KEY,
      leave_type_id   INT NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
      min_years       NUMERIC(4,1) NOT NULL DEFAULT 0,
      max_years       NUMERIC(4,1),
      quota_days      INT NOT NULL,
      description     VARCHAR(100),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (leave_type_id, min_years)
    )
  `);
  // เพิ่ม hire_date column ถ้ายังไม่มี
  await db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS hire_date DATE`);
}

// ── GET /api/leave-quota — ดูกฎทั้งหมด ──────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    await ensureTable();
    const { rows } = await db.query(
      `SELECT lqr.*, lt.name AS leave_type_name
       FROM leave_quota_rules lqr
       JOIN leave_types lt ON lt.id = lqr.leave_type_id
       ORDER BY lqr.leave_type_id, lqr.min_years`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/leave-quota/types — leave_types ที่ใช้ร่วม ─
router.get('/types', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, name FROM leave_types ORDER BY id');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/leave-quota — สร้างกฎ ─────────────────
router.post('/', requireAuth, async (req, res) => {
  try {
    await ensureTable();
    const { leave_type_id, min_years, max_years, quota_days, description } = req.body;
    if (!leave_type_id || quota_days === undefined) return res.status(400).json({ error: 'ต้องระบุ leave_type_id และ quota_days' });
    const { rows } = await db.query(
      `INSERT INTO leave_quota_rules (leave_type_id, min_years, max_years, quota_days, description)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (leave_type_id, min_years)
       DO UPDATE SET max_years=$3, quota_days=$4, description=$5
       RETURNING *`,
      [leave_type_id, min_years ?? 0, max_years || null, quota_days, description?.trim() || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── PUT /api/leave-quota/:id ─────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  try {
    await ensureTable();
    const { min_years, max_years, quota_days, description } = req.body;
    const { rows } = await db.query(
      `UPDATE leave_quota_rules SET min_years=$2, max_years=$3, quota_days=$4, description=$5
       WHERE id=$1 RETURNING *`,
      [req.params.id, min_years ?? 0, max_years || null, quota_days, description?.trim() || null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบกฎ' });
    res.json(rows[0]);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── DELETE /api/leave-quota/:id ──────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await ensureTable();
    const { rowCount } = await db.query('DELETE FROM leave_quota_rules WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'ไม่พบกฎ' });
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── GET /api/leave-quota/calculate/:employee_id ─────
// คำนวณโควต้าลาของพนักงานตามอายุงาน
router.get('/calculate/:employee_id', requireAuth, async (req, res) => {
  try {
    await ensureTable();
    const { rows: empRows } = await db.query(
      'SELECT id, name, hire_date FROM employees WHERE id=$1 AND is_active=TRUE',
      [req.params.employee_id]
    );
    const emp = empRows[0];
    if (!emp) return res.status(404).json({ error: 'ไม่พบพนักงาน' });

    let seniorityYears = 0;
    if (emp.hire_date) {
      const ms = Date.now() - new Date(emp.hire_date).getTime();
      seniorityYears = ms / (1000 * 60 * 60 * 24 * 365.25);
    }

    // ดึง leave types + quota rules
    const { rows: ltRows } = await db.query('SELECT * FROM leave_types ORDER BY id');
    const { rows: rules }  = await db.query(
      `SELECT * FROM leave_quota_rules ORDER BY leave_type_id, min_years`
    );

    const result = ltRows.map(lt => {
      // หากฎที่ match อายุงาน
      const matching = rules.filter(r =>
        r.leave_type_id === lt.id &&
        seniorityYears >= parseFloat(r.min_years) &&
        (r.max_years === null || seniorityYears < parseFloat(r.max_years))
      ).sort((a, b) => parseFloat(b.min_years) - parseFloat(a.min_years));

      const appliedRule = matching[0] || null;
      return {
        leave_type_id: lt.id,
        leave_type_name: lt.name,
        default_max_days: lt.max_days,
        seniority_quota: appliedRule ? appliedRule.quota_days : null,
        effective_quota: appliedRule ? appliedRule.quota_days : lt.max_days,
        rule_description: appliedRule?.description || null,
      };
    });

    res.json({
      employee_id: emp.id,
      employee_name: emp.name,
      hire_date: emp.hire_date,
      seniority_years: Math.round(seniorityYears * 10) / 10,
      quotas: result,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
