'use strict';
/**
 * salaryAdjustmentService.js
 *
 * ระบบปรับเงินเดือนประจำปี
 *
 * การเชื่อมโยงกับฟังก์ชันอื่น:
 *  - employees.salary       → UPDATE ทันทีเมื่อ applyAdjustment()
 *  - salary_adjustments     → บันทึกประวัติทุกครั้งที่ปรับ
 *  - payroll_records        → ดึง salary จาก employees เสมอ → payroll รอบถัดไปใช้ค่าใหม่อัตโนมัติ
 *  - audit_logs             → บันทึก action ผ่าน auditService (ถ้าต้องการ)
 */

const db = require('../db');

// ─── ดึงประวัติการปรับเงินเดือนทั้งหมด ────────────────────────────────────

async function getAll({ employeeId, roundName, year } = {}) {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (employeeId) {
    conditions.push(`sa.employee_id = $${idx++}`);
    values.push(employeeId);
  }
  if (roundName) {
    conditions.push(`sa.round_name ILIKE $${idx++}`);
    values.push(`%${roundName}%`);
  }
  if (year) {
    conditions.push(`EXTRACT(YEAR FROM sa.effective_date) = $${idx++}`);
    values.push(year);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const { rows } = await db.query(
    `SELECT
       sa.id, sa.effective_date, sa.old_salary, sa.new_salary,
       sa.adjustment_type, sa.adjustment_value,
       ROUND((sa.new_salary - sa.old_salary)::numeric, 2)          AS diff_amount,
       CASE WHEN sa.old_salary > 0
            THEN ROUND(((sa.new_salary - sa.old_salary) / sa.old_salary * 100)::numeric, 2)
            ELSE 0 END                                              AS diff_percent,
       sa.reason, sa.round_name, sa.created_at,
       e.id          AS employee_id,
       e.employee_code,
       e.name        AS employee_name,
       e.salary      AS current_salary,
       d.name        AS department_name,
       b.name        AS branch_name,
       ap.name       AS applied_by_name
     FROM salary_adjustments sa
     JOIN employees e ON e.id = sa.employee_id
     LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN branches    b ON b.id = e.branch_id
     LEFT JOIN employees  ap ON ap.id = sa.applied_by
     ${where}
     ORDER BY sa.effective_date DESC, sa.created_at DESC`,
    values
  );
  return rows;
}

// ─── ดึงรายชื่อ round ที่มีอยู่ ────────────────────────────────────────────

async function getRounds() {
  const { rows } = await db.query(
    `SELECT DISTINCT round_name, COUNT(*) AS emp_count,
            MIN(effective_date) AS effective_date
     FROM salary_adjustments
     WHERE round_name IS NOT NULL
     GROUP BY round_name
     ORDER BY MIN(effective_date) DESC`
  );
  return rows;
}

// ─── ขึ้นเงินเดือนพนักงานรายคน ─────────────────────────────────────────────

/**
 * @param {object} params
 * @param {number} params.employeeId
 * @param {string} params.adjustmentType  'percent' | 'amount'
 * @param {number} params.adjustmentValue % หรือจำนวนเงิน
 * @param {string} params.effectiveDate   YYYY-MM-DD
 * @param {string} [params.reason]
 * @param {string} [params.roundName]     ชื่อรอบ เช่น "ประจำปี 2026"
 * @param {number} [params.appliedBy]     employee_id ของ admin
 */
async function applyOne({ employeeId, adjustmentType, adjustmentValue, effectiveDate, reason, roundName, appliedBy }) {
  // ดึงเงินเดือนปัจจุบัน
  const empRes = await db.query(
    `SELECT id, name, salary FROM employees WHERE id = $1 AND is_active = TRUE`,
    [employeeId]
  );
  if (!empRes.rows[0]) throw new Error('ไม่พบพนักงาน');

  const emp = empRes.rows[0];
  const oldSalary = parseFloat(emp.salary || 0);

  let newSalary;
  if (adjustmentType === 'percent') {
    newSalary = Math.round(oldSalary * (1 + adjustmentValue / 100) * 100) / 100;
  } else if (adjustmentType === 'amount') {
    newSalary = Math.round((oldSalary + adjustmentValue) * 100) / 100;
  } else {
    throw new Error('adjustmentType ต้องเป็น percent หรือ amount');
  }

  if (newSalary < 0) throw new Error('เงินเดือนใหม่ต้องไม่ติดลบ');

  // บันทึกประวัติ
  const adjRes = await db.query(
    `INSERT INTO salary_adjustments
       (employee_id, effective_date, old_salary, new_salary, adjustment_type, adjustment_value, reason, round_name, applied_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [employeeId, effectiveDate, oldSalary, newSalary, adjustmentType, adjustmentValue, reason || null, roundName || null, appliedBy || null]
  );

  // อัปเดตเงินเดือนพนักงาน
  await db.query(
    `UPDATE employees SET salary = $1, updated_at = NOW() WHERE id = $2`,
    [newSalary, employeeId]
  );

  return {
    ...adjRes.rows[0],
    employee_name: emp.name,
    old_salary: oldSalary,
    new_salary: newSalary,
    diff_amount: Math.round((newSalary - oldSalary) * 100) / 100,
    diff_percent: oldSalary > 0
      ? Math.round((newSalary - oldSalary) / oldSalary * 10000) / 100
      : 0,
  };
}

// ─── ขึ้นเงินเดือน Bulk (ทั้งหมด / ตามแผนก / ตามสาขา) ────────────────────

/**
 * @param {object} params
 * @param {string} params.adjustmentType  'percent' | 'amount'
 * @param {number} params.adjustmentValue
 * @param {string} params.effectiveDate
 * @param {string} [params.roundName]
 * @param {string} [params.reason]
 * @param {number} [params.departmentId]  null = ทุกแผนก
 * @param {number} [params.branchId]      null = ทุกสาขา
 * @param {number[]} [params.employeeIds] ถ้าระบุ — ใช้เฉพาะรายชื่อนี้
 * @param {number} [params.appliedBy]
 */
async function applyBulk({ adjustmentType, adjustmentValue, effectiveDate, roundName, reason, departmentId, branchId, employeeIds, appliedBy }) {
  // ดึงรายชื่อพนักงานที่จะขึ้น
  let empQuery = `SELECT id, name, salary FROM employees WHERE is_active = TRUE AND salary > 0`;
  const vals = [];
  let idx = 1;

  if (employeeIds && employeeIds.length > 0) {
    empQuery += ` AND id = ANY($${idx++}::int[])`;
    vals.push(employeeIds);
  } else {
    if (departmentId) {
      empQuery += ` AND department_id = $${idx++}`;
      vals.push(departmentId);
    }
    if (branchId) {
      empQuery += ` AND branch_id = $${idx++}`;
      vals.push(branchId);
    }
  }
  empQuery += ` ORDER BY id`;

  const { rows: employees } = await db.query(empQuery, vals);
  if (employees.length === 0) throw new Error('ไม่พบพนักงานที่ตรงเงื่อนไข');

  const results = [];
  for (const emp of employees) {
    try {
      const result = await applyOne({
        employeeId: emp.id,
        adjustmentType,
        adjustmentValue,
        effectiveDate,
        reason,
        roundName,
        appliedBy,
      });
      results.push({ ...result, success: true });
    } catch (e) {
      results.push({ employee_id: emp.id, employee_name: emp.name, success: false, error: e.message });
    }
  }

  return {
    total: employees.length,
    success: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    items: results,
  };
}

// ─── ลบประวัติ + ย้อนเงินเดือนกลับ (rollback) ────────────────────────────

async function rollback(adjustmentId) {
  const adjRes = await db.query(
    `SELECT * FROM salary_adjustments WHERE id = $1`,
    [adjustmentId]
  );
  if (!adjRes.rows[0]) throw new Error('ไม่พบรายการปรับเงินเดือน');

  const adj = adjRes.rows[0];

  // ตรวจว่าเป็น adjustment ล่าสุดของพนักงานนี้
  const latestRes = await db.query(
    `SELECT id FROM salary_adjustments WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [adj.employee_id]
  );
  if (latestRes.rows[0]?.id !== adj.id) {
    throw new Error('สามารถยกเลิกได้เฉพาะรายการล่าสุดเท่านั้น');
  }

  // คืนเงินเดือนเดิม
  await db.query(
    `UPDATE employees SET salary = $1, updated_at = NOW() WHERE id = $2`,
    [adj.old_salary, adj.employee_id]
  );

  // ลบ record
  await db.query(`DELETE FROM salary_adjustments WHERE id = $1`, [adjustmentId]);

  return { rolled_back: adj };
}

// ─── สรุปรอบการขึ้นเงินเดือน ──────────────────────────────────────────────

async function getSummary(roundName) {
  const { rows } = await db.query(
    `SELECT
       COUNT(*)                                                    AS total_employees,
       ROUND(AVG(adjustment_value)::numeric, 2)                   AS avg_value,
       ROUND(SUM(new_salary - old_salary)::numeric, 2)            AS total_diff_amount,
       ROUND(AVG((new_salary - old_salary) / NULLIF(old_salary,0) * 100)::numeric, 2) AS avg_diff_percent,
       MIN(effective_date)                                         AS effective_date
     FROM salary_adjustments
     WHERE round_name = $1`,
    [roundName]
  );
  return rows[0];
}

module.exports = { getAll, getRounds, applyOne, applyBulk, rollback, getSummary };
