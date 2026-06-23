const express = require('express');
const router  = express.Router();
const db      = require('../db');
const employeeService = require('../services/employeeService');
const line    = require('@line/bot-sdk');

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

// auto-migrate: สร้าง table ถ้ายังไม่มี
async function ensureExpenseTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS expense_claims (
      id              SERIAL PRIMARY KEY,
      employee_id     INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      claim_date      DATE NOT NULL DEFAULT CURRENT_DATE,
      category        VARCHAR(50) NOT NULL DEFAULT 'other',
      amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      description     TEXT NOT NULL,
      receipt_url     TEXT,
      status          VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','rejected','paid')),
      approved_by     INT REFERENCES employees(id),
      approved_at     TIMESTAMPTZ,
      reject_reason   TEXT,
      payroll_year    INT,
      payroll_month   INT,
      notes           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// ── helper: push แจ้ง admin ทั้งหมด ─────────────────────────────
async function notifyAdmins(text) {
  try {
    const rows = await db.query('SELECT line_user_id FROM admin_line_users');
    await Promise.all(rows.rows.map(r =>
      client.pushMessage({ to: r.line_user_id, messages: [{ type: 'text', text }] }).catch(() => {})
    ));
  } catch {}
}

// ── POST /api/expense  (LIFF — พนักงานยื่นเบิก) ──────────────────
router.post('/', async (req, res) => {
  try {
    await ensureExpenseTable();
    const { line_user_id, employee_id, claim_date, category, amount, description, receipt_url, status, _admin } = req.body;

    if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ error: 'จำนวนเงินไม่ถูกต้อง' });
    if (!description?.trim()) return res.status(400).json({ error: 'กรุณาระบุรายละเอียด' });

    // หา employee — admin ส่ง employee_id โดยตรง, LIFF ส่ง line_user_id
    let emp;
    if (_admin && employee_id) {
      const { rows } = await db.query('SELECT * FROM employees WHERE id = $1 AND is_active = TRUE', [employee_id]);
      emp = rows[0];
    } else if (line_user_id) {
      emp = await employeeService.findByLineId(line_user_id);
    }
    if (!emp) return res.status(404).json({ error: 'ไม่พบพนักงาน' });

    // status: LIFF ใช้ 'pending' เสมอ, admin กำหนดได้
    const initialStatus = (_admin && status) ? status : 'pending';
    const VALID_STATUS = ['pending','approved','rejected','paid'];
    if (!VALID_STATUS.includes(initialStatus)) return res.status(400).json({ error: 'status ไม่ถูกต้อง' });

    const { rows } = await db.query(
      `INSERT INTO expense_claims
         (employee_id, claim_date, category, amount, description, receipt_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [emp.id, claim_date || new Date().toISOString().slice(0, 10),
       category || 'other', parseFloat(amount), description.trim(), receipt_url || null, initialStatus]
    );
    const claim = rows[0];

    // แจ้ง admin เฉพาะกรณี LIFF submit (ไม่แจ้งถ้า admin เพิ่มเอง)
    if (!_admin) {
      const catLabel = { travel: '🚗 ค่าเดินทาง', meal: '🍱 ค่าอาหาร', accommodation: '🏨 ที่พัก',
        medical: '🏥 ค่ารักษา', communication: '📞 ค่าสื่อสาร', other: '📋 อื่นๆ' };
      await notifyAdmins(
        `📝 คำขอเบิกค่าใช้จ่ายใหม่\n` +
        `พนักงาน: ${emp.name}\n` +
        `ประเภท: ${catLabel[category] || category}\n` +
        `จำนวน: ฿${parseFloat(amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}\n` +
        `รายละเอียด: ${description}\n` +
        `วันที่: ${claim_date || 'วันนี้'}`
      );
    }

    res.status(201).json({ success: true, id: claim.id, claim });
  } catch (err) {
    console.error('expense POST error:', err);
    res.status(400).json({ error: err.message });
  }
});

// ── GET /api/expense/mine?line_user_id=&year=&month= ──────────────
router.get('/mine', async (req, res) => {
  try {
    await ensureExpenseTable();
    const { line_user_id, year, month } = req.query;
    if (!line_user_id) return res.status(400).json({ error: 'ต้องระบุ line_user_id' });

    const emp = await employeeService.findByLineId(line_user_id);
    if (!emp) return res.status(404).json({ error: 'ไม่พบพนักงาน' });

    const { rows } = await db.query(
      `SELECT * FROM expense_claims
       WHERE employee_id = $1
         AND ($2::int IS NULL OR EXTRACT(YEAR  FROM claim_date) = $2)
         AND ($3::int IS NULL OR EXTRACT(MONTH FROM claim_date) = $3)
       ORDER BY claim_date DESC, created_at DESC`,
      [emp.id, year ? parseInt(year) : null, month ? parseInt(month) : null]
    );

    const total = rows.reduce((s, r) => s + parseFloat(r.amount || 0), 0);
    const approved = rows.filter(r => r.status === 'approved' || r.status === 'paid');
    res.json({
      employee_name: emp.name,
      claims: rows,
      summary: {
        total_claims: rows.length,
        total_amount: total,
        approved_amount: approved.reduce((s, r) => s + parseFloat(r.amount || 0), 0),
        pending: rows.filter(r => r.status === 'pending').length,
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/expense  (Admin — ดูทั้งหมด) ────────────────────────
router.get('/', async (req, res) => {
  try {
    await ensureExpenseTable();
    const { year, month, status, employee_id, department_id } = req.query;
    const { rows } = await db.query(
      `SELECT ec.*,
              e.name AS employee_name, e.employee_code,
              d.name AS department_name,
              ae.name AS approved_by_name
       FROM expense_claims ec
       JOIN employees e ON e.id = ec.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN employees ae ON ae.id = ec.approved_by
       WHERE ($1::int IS NULL OR EXTRACT(YEAR  FROM ec.claim_date) = $1)
         AND ($2::int IS NULL OR EXTRACT(MONTH FROM ec.claim_date) = $2)
         AND ($3::text IS NULL OR ec.status = $3)
         AND ($4::int IS NULL OR ec.employee_id = $4)
         AND ($5::int IS NULL OR e.department_id = $5)
       ORDER BY ec.created_at DESC`,
      [year ? parseInt(year) : null, month ? parseInt(month) : null,
       status || null, employee_id ? parseInt(employee_id) : null,
       department_id ? parseInt(department_id) : null]
    );
    const total = rows.reduce((s, r) => s + parseFloat(r.amount || 0), 0);
    res.json({ claims: rows, total_amount: total, count: rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/expense/:id/approve  (Admin) ──────────────────────
router.patch('/:id/approve', async (req, res) => {
  try {
    await ensureExpenseTable();
    const { notes } = req.body;
    const { rows } = await db.query(
      `UPDATE expense_claims
       SET status='approved', approved_at=NOW(), notes=$2, updated_at=NOW()
       WHERE id=$1 AND status='pending' RETURNING *`,
      [req.params.id, notes || null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบคำขอ หรือสถานะไม่ใช่ pending' });

    // แจ้งพนักงาน
    const empRow = await db.query(
      'SELECT e.line_user_id, e.name FROM employees e WHERE e.id = $1',
      [rows[0].employee_id]
    );
    const emp = empRow.rows[0];
    if (emp?.line_user_id) {
      await client.pushMessage({
        to: emp.line_user_id,
        messages: [{ type: 'text', text:
          `✅ คำขอเบิกค่าใช้จ่ายของคุณได้รับการอนุมัติ\n` +
          `จำนวน: ฿${parseFloat(rows[0].amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}\n` +
          `รายละเอียด: ${rows[0].description}` +
          (notes ? `\nหมายเหตุ: ${notes}` : '')
        }]
      }).catch(() => {});
    }
    res.json({ success: true, claim: rows[0] });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── PATCH /api/expense/:id/reject  (Admin) ───────────────────────
router.patch('/:id/reject', async (req, res) => {
  try {
    await ensureExpenseTable();
    const { reject_reason } = req.body;
    const { rows } = await db.query(
      `UPDATE expense_claims
       SET status='rejected', approved_at=NOW(), reject_reason=$2, updated_at=NOW()
       WHERE id=$1 AND status='pending' RETURNING *`,
      [req.params.id, reject_reason || 'ไม่อนุมัติโดย HR']
    );
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบคำขอ หรือสถานะไม่ใช่ pending' });

    const empRow = await db.query(
      'SELECT e.line_user_id FROM employees e WHERE e.id = $1', [rows[0].employee_id]
    );
    const emp = empRow.rows[0];
    if (emp?.line_user_id) {
      await client.pushMessage({
        to: emp.line_user_id,
        messages: [{ type: 'text', text:
          `❌ คำขอเบิกค่าใช้จ่ายไม่ได้รับการอนุมัติ\n` +
          `จำนวน: ฿${parseFloat(rows[0].amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}\n` +
          `เหตุผล: ${rows[0].reject_reason}`
        }]
      }).catch(() => {});
    }
    res.json({ success: true, claim: rows[0] });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── PATCH /api/expense/:id/mark-paid  (Admin — จ่ายแล้ว) ─────────
router.patch('/:id/mark-paid', async (req, res) => {
  try {
    await ensureExpenseTable();
    const { payroll_year, payroll_month } = req.body;
    const { rows } = await db.query(
      `UPDATE expense_claims
       SET status='paid', payroll_year=$2, payroll_month=$3, updated_at=NOW()
       WHERE id=$1 AND status='approved' RETURNING *`,
      [req.params.id, payroll_year || null, payroll_month || null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบคำขอ หรือสถานะไม่ใช่ approved' });
    res.json({ success: true, claim: rows[0] });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── GET /api/expense/summary?year=&month=  (Admin — ยอดรวมเพื่อรวม payroll) ─
router.get('/summary', async (req, res) => {
  try {
    await ensureExpenseTable();
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).json({ error: 'ต้องระบุ year และ month' });

    // ค่าใช้จ่ายที่ approved ในเดือนนั้น แต่ยังไม่ได้ paid
    const { rows } = await db.query(
      `SELECT ec.employee_id, e.name AS employee_name, e.employee_code,
              SUM(ec.amount) AS total_expense,
              COUNT(*) AS claim_count
       FROM expense_claims ec
       JOIN employees e ON e.id = ec.employee_id
       WHERE ec.status = 'approved'
         AND (ec.payroll_year IS NULL OR (ec.payroll_year = $1 AND ec.payroll_month = $2))
         AND EXTRACT(YEAR  FROM ec.claim_date) <= $1
         AND EXTRACT(MONTH FROM ec.claim_date) <= $2
       GROUP BY ec.employee_id, e.name, e.employee_code
       ORDER BY e.name`,
      [parseInt(year), parseInt(month)]
    );
    res.json({ year: parseInt(year), month: parseInt(month), by_employee: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/expense/:id  (ลบเฉพาะ pending) ───────────────────
router.delete('/:id', async (req, res) => {
  try {
    await ensureExpenseTable();
    const { line_user_id } = req.body;
    let whereClause = 'id=$1 AND status=\'pending\'';
    const params = [req.params.id];
    if (line_user_id) {
      const emp = await employeeService.findByLineId(line_user_id);
      if (!emp) return res.status(404).json({ error: 'ไม่พบพนักงาน' });
      whereClause += ' AND employee_id=$2';
      params.push(emp.id);
    }
    const { rowCount } = await db.query(`DELETE FROM expense_claims WHERE ${whereClause}`, params);
    if (!rowCount) return res.status(404).json({ error: 'ไม่พบคำขอ หรือไม่ใช่สถานะ pending' });
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
