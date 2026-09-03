'use strict';
/**
 * payrollDeductionService.js
 *
 * ระบบหักเงินรายได้พนักงานรายเดือน — หลายรายการ แยกตามหมวดหมู่
 *
 * การเชื่อมโยงกับฟังก์ชันอื่น:
 *  - payroll_deductions        → เก็บรายการหักย่อยแต่ละรายการ
 *  - payrollService.calculatePayslip() → SUM ยอดหักของเดือนนั้น มารวมใน total_deduction/net_income
 *  - payroll_records.other_deduction   → snapshot ยอดรวม ณ ตอน generatePayroll()
 */

const db = require('../db');

const CATEGORIES = ['uniform', 'loan_repay', 'fine', 'equipment', 'advance', 'other'];

// ─── รายการหักของพนักงาน 1 คน ในเดือนที่ระบุ ──────────────────────────────

async function listByEmployeeMonth(employeeId, year, month) {
  const { rows } = await db.query(
    `SELECT pd.*, cb.name AS created_by_name
     FROM payroll_deductions pd
     LEFT JOIN employees cb ON cb.id = pd.created_by
     WHERE pd.employee_id = $1 AND pd.year = $2 AND pd.month = $3
     ORDER BY pd.created_at DESC`,
    [employeeId, year, month]
  );
  return rows;
}

// ─── ยอดรวมหักของพนักงาน 1 คน ในเดือนที่ระบุ (ใช้ใน payrollService) ───────

async function getMonthlyTotal(employeeId, year, month) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM payroll_deductions
     WHERE employee_id = $1 AND year = $2 AND month = $3`,
    [employeeId, year, month]
  );
  return parseFloat(rows[0].total || 0);
}

// ─── เพิ่มรายการหัก ────────────────────────────────────────────────────────

async function add({ employeeId, year, month, category, amount, note, createdBy }) {
  if (!employeeId) throw new Error('ต้องระบุ employee_id');
  if (!year || !month) throw new Error('ต้องระบุ year และ month');
  if (!CATEGORIES.includes(category)) throw new Error('หมวดหมู่ไม่ถูกต้อง');
  const amt = parseFloat(amount);
  if (!(amt > 0)) throw new Error('จำนวนเงินต้องมากกว่า 0');

  const empRes = await db.query('SELECT id, name FROM employees WHERE id = $1', [employeeId]);
  if (!empRes.rows[0]) throw new Error('ไม่พบพนักงาน');

  const { rows } = await db.query(
    `INSERT INTO payroll_deductions (employee_id, year, month, category, amount, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [employeeId, year, month, category, amt, note || null, createdBy || null]
  );

  await syncPayrollRecord(employeeId, year, month);

  return { ...rows[0], employee_name: empRes.rows[0].name };
}

// ─── ลบรายการหัก ───────────────────────────────────────────────────────────

async function remove(id) {
  const { rows } = await db.query('SELECT * FROM payroll_deductions WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) throw new Error('ไม่พบรายการหักเงิน');

  await db.query('DELETE FROM payroll_deductions WHERE id = $1', [id]);
  await syncPayrollRecord(row.employee_id, row.year, row.month);

  return row;
}

// ─── sync ยอดรวมเข้า payroll_records.other_deduction (ถ้ามี record อยู่แล้ว) ─
// หมายเหตุ: ไม่ recalculate ทั้งสลิป (SS/PF/tax) ที่นี่ — แค่ปรับ other_deduction,
// total_deduction, net_income ให้ตรงกับยอดหักล่าสุด เฉพาะ record ที่ยังเป็น draft
// (record ที่ confirmed/paid แล้ว ต้องกด Recalculate เองถ้าต้องการปรับ)

async function syncPayrollRecord(employeeId, year, month) {
  const total = await getMonthlyTotal(employeeId, year, month);
  await db.query(
    `UPDATE payroll_records
     SET other_deduction = $4,
         total_deduction = social_security + provident_fund + tax_withholding
                            + late_deduction + absent_deduction + $4,
         net_income = gross_income - (social_security + provident_fund + tax_withholding
                            + late_deduction + absent_deduction + $4),
         updated_at = NOW()
     WHERE employee_id = $1 AND year = $2 AND month = $3 AND status = 'draft'`,
    [employeeId, year, month, total]
  );
}

module.exports = { CATEGORIES, listByEmployeeMonth, getMonthlyTotal, add, remove, syncPayrollRecord };
