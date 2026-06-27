/**
 * taxService.js — รายงานภาษีหัก ณ ที่จ่าย
 *
 * รองรับ:
 *   - ภ.ง.ด.1  : รายเดือน (per month + per employee)
 *   - ภ.ง.ด.1ก : รายปี   (cumulative annual per employee)
 *   - YTD Summary : สรุปรายปีเดือนต่อเดือน
 *
 * ฐานข้อมูลที่ใช้:
 *   payroll_records — salary, ot_pay, bonus, special_allowance,
 *                     social_security, provident_fund, tax_withholding, net_income
 *   employees       — name, employee_code, citizen_id, name_prefix, tax_id
 */

'use strict';
const db = require('../db');

// ─── helpers ──────────────────────────────────────────────────────────────

function round2(n) { return Math.round((n || 0) * 100) / 100; }

function thMonth(m) {
  const MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                  'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return MONTHS[(m - 1)] || String(m);
}

// ─── ภ.ง.ด.1 : รายเดือน ─────────────────────────────────────────────────

/**
 * ดึงข้อมูลสำหรับยื่น ภ.ง.ด.1 ของเดือนที่กำหนด
 * @param {number} year  ค.ศ.
 * @param {number} month 1–12
 */
async function getPND1(year, month) {
  const { rows } = await db.query(
    `SELECT
       e.id                                                     AS employee_id,
       COALESCE(e.employee_code, '')                            AS employee_code,
       COALESCE(e.name_prefix, '')                              AS name_prefix,
       e.name                                                   AS employee_name,
       COALESCE(e.citizen_id, e.tax_id, '')                    AS tax_id,
       COALESCE(e.bank_name, '')                                AS bank_name,
       COALESCE(e.bank_account_no, '')                         AS bank_account_no,
       pr.year,
       pr.month,
       ROUND((COALESCE(pr.salary,0) + COALESCE(pr.ot_pay,0)
         + COALESCE(pr.bonus,0) + COALESCE(pr.special_allowance,0))::numeric, 2) AS gross_income,
       ROUND((COALESCE(pr.salary,0))::numeric, 2)                           AS base_salary,
       ROUND((COALESCE(pr.ot_pay,0))::numeric, 2)                           AS ot_pay,
       ROUND((COALESCE(pr.bonus,0))::numeric, 2)                            AS bonus,
       ROUND((COALESCE(pr.special_allowance,0))::numeric, 2)                AS special_allowance,
       ROUND((COALESCE(pr.social_security,0))::numeric, 2)                  AS social_security,
       ROUND((COALESCE(pr.provident_fund,0))::numeric, 2)                   AS provident_fund,
       ROUND((COALESCE(pr.tax_withholding,0))::numeric, 2)                  AS tax_withholding,
       ROUND((COALESCE(pr.late_deduction,0))::numeric, 2)                   AS late_deduction,
       ROUND((COALESCE(pr.absent_deduction,0))::numeric, 2)                 AS absent_deduction,
       ROUND((COALESCE(pr.net_income,0))::numeric, 2)                       AS net_income,
       d.name                                                   AS department_name,
       b.name                                                   AS branch_name
     FROM payroll_records pr
     JOIN employees e  ON e.id  = pr.employee_id
     LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN branches    b ON b.id = e.branch_id
     WHERE pr.year = $1 AND pr.month = $2
       AND e.is_active = TRUE
     ORDER BY d.name, e.name`,
    [year, month]
  );

  const totals = rows.reduce((acc, r) => {
    acc.gross_income   += r.gross_income;
    acc.tax_withholding += r.tax_withholding;
    acc.social_security += r.social_security;
    acc.provident_fund  += r.provident_fund;
    acc.net_income      += r.net_income;
    return acc;
  }, { gross_income: 0, tax_withholding: 0, social_security: 0, provident_fund: 0, net_income: 0 });

  return {
    year, month,
    month_name: thMonth(month),
    count: rows.length,
    rows: rows.map((r, i) => ({ seq: i + 1, ...r })),
    totals: {
      gross_income:    round2(totals.gross_income),
      tax_withholding: round2(totals.tax_withholding),
      social_security: round2(totals.social_security),
      provident_fund:  round2(totals.provident_fund),
      net_income:      round2(totals.net_income),
    },
  };
}

// ─── ภ.ง.ด.1ก : รายปี ───────────────────────────────────────────────────

/**
 * ดึงข้อมูลสำหรับยื่น ภ.ง.ด.1ก ของปีที่กำหนด
 * รวม income + tax ตลอดทั้งปีต่อพนักงาน 1 คน
 */
async function getPND1K(year) {
  const { rows } = await db.query(
    `SELECT
       e.id                                                     AS employee_id,
       COALESCE(e.employee_code, '')                            AS employee_code,
       COALESCE(e.name_prefix, '')                              AS name_prefix,
       e.name                                                   AS employee_name,
       COALESCE(e.citizen_id, e.tax_id, '')                    AS tax_id,
       d.name                                                   AS department_name,
       b.name                                                   AS branch_name,
       COUNT(pr.id)                                             AS months_paid,
       ROUND((SUM(COALESCE(pr.salary,0)))::numeric, 2)                      AS ytd_salary,
       ROUND((SUM(COALESCE(pr.ot_pay,0)))::numeric, 2)                      AS ytd_ot_pay,
       ROUND((SUM(COALESCE(pr.bonus,0)))::numeric, 2)                       AS ytd_bonus,
       ROUND((SUM(COALESCE(pr.special_allowance,0)))::numeric, 2)           AS ytd_special,
       ROUND((SUM(COALESCE(pr.salary,0) + COALESCE(pr.ot_pay,0)
         + COALESCE(pr.bonus,0) + COALESCE(pr.special_allowance,0)))::numeric, 2) AS ytd_gross,
       ROUND((SUM(COALESCE(pr.social_security,0)))::numeric, 2)             AS ytd_ss,
       ROUND((SUM(COALESCE(pr.provident_fund,0)))::numeric, 2)              AS ytd_pf,
       ROUND((SUM(COALESCE(pr.tax_withholding,0)))::numeric, 2)             AS ytd_tax,
       ROUND((SUM(COALESCE(pr.net_income,0)))::numeric, 2)                  AS ytd_net,
       -- รายเดือน JSON array สำหรับ drill-down
       json_agg(
         json_build_object(
           'month', pr.month,
           'gross', ROUND((COALESCE(pr.salary,0) + COALESCE(pr.ot_pay,0) + COALESCE(pr.bonus,0) + COALESCE(pr.special_allowance,0))::numeric, 2),
           'tax',   ROUND((COALESCE(pr.tax_withholding,0))::numeric, 2),
           'ss',    ROUND((COALESCE(pr.social_security,0))::numeric, 2),
           'net',   ROUND((COALESCE(pr.net_income,0))::numeric, 2)
         ) ORDER BY pr.month
       )                                                        AS monthly_breakdown
     FROM payroll_records pr
     JOIN employees e  ON e.id  = pr.employee_id
     LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN branches    b ON b.id = e.branch_id
     WHERE pr.year = $1
     GROUP BY e.id, e.employee_code, e.name_prefix, e.name,
              e.citizen_id, e.tax_id, d.name, b.name
     ORDER BY d.name, e.name`,
    [year]
  );

  const totals = rows.reduce((acc, r) => {
    acc.ytd_gross += r.ytd_gross;
    acc.ytd_tax   += r.ytd_tax;
    acc.ytd_ss    += r.ytd_ss;
    acc.ytd_pf    += r.ytd_pf;
    acc.ytd_net   += r.ytd_net;
    return acc;
  }, { ytd_gross: 0, ytd_tax: 0, ytd_ss: 0, ytd_pf: 0, ytd_net: 0 });

  return {
    year,
    count: rows.length,
    rows: rows.map((r, i) => ({ seq: i + 1, ...r })),
    totals: {
      ytd_gross: round2(totals.ytd_gross),
      ytd_tax:   round2(totals.ytd_tax),
      ytd_ss:    round2(totals.ytd_ss),
      ytd_pf:    round2(totals.ytd_pf),
      ytd_net:   round2(totals.ytd_net),
    },
  };
}

// ─── YTD Summary : สรุปรายเดือนตลอดปี ─────────────────────────────────

/**
 * ยอดรวมรายเดือน (ทุกพนักงาน) ตลอดปี
 */
async function getYTDSummary(year) {
  // รายเดือน
  const { rows: monthly } = await db.query(
    `SELECT
       pr.month,
       COUNT(DISTINCT pr.employee_id)                          AS head_count,
       ROUND((SUM(COALESCE(pr.salary,0)))::numeric, 2)                     AS total_salary,
       ROUND((SUM(COALESCE(pr.ot_pay,0)))::numeric, 2)                     AS total_ot,
       ROUND((SUM(COALESCE(pr.bonus,0)))::numeric, 2)                      AS total_bonus,
       ROUND((SUM(COALESCE(pr.special_allowance,0)))::numeric, 2)          AS total_special,
       ROUND((SUM(COALESCE(pr.salary,0) + COALESCE(pr.ot_pay,0)
         + COALESCE(pr.bonus,0) + COALESCE(pr.special_allowance,0)))::numeric, 2) AS gross,
       ROUND((SUM(COALESCE(pr.social_security,0)))::numeric, 2)            AS total_ss,
       ROUND((SUM(COALESCE(pr.provident_fund,0)))::numeric, 2)             AS total_pf,
       ROUND((SUM(COALESCE(pr.tax_withholding,0)))::numeric, 2)            AS total_tax,
       ROUND((SUM(COALESCE(pr.late_deduction,0)))::numeric, 2)             AS total_late,
       ROUND((SUM(COALESCE(pr.absent_deduction,0)))::numeric, 2)           AS total_absent,
       ROUND((SUM(COALESCE(pr.net_income,0)))::numeric, 2)                 AS total_net
     FROM payroll_records pr
     JOIN employees e ON e.id = pr.employee_id
     WHERE pr.year = $1
     GROUP BY pr.month
     ORDER BY pr.month`,
    [year]
  );

  // fill missing months with 0
  const byMonth = {};
  monthly.forEach(r => { byMonth[r.month] = r; });

  const allMonths = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    return byMonth[m] || {
      month: m, head_count: 0,
      total_salary: 0, total_ot: 0, total_bonus: 0, total_special: 0,
      gross: 0, total_ss: 0, total_pf: 0, total_tax: 0,
      total_late: 0, total_absent: 0, total_net: 0,
    };
  });

  // YTD running totals
  let running = { gross: 0, total_tax: 0, total_ss: 0, total_pf: 0, total_net: 0 };
  const rows = allMonths.map(r => {
    running.gross     += parseFloat(r.gross || 0);
    running.total_tax += parseFloat(r.total_tax || 0);
    running.total_ss  += parseFloat(r.total_ss || 0);
    running.total_pf  += parseFloat(r.total_pf || 0);
    running.total_net += parseFloat(r.total_net || 0);
    return {
      ...r,
      month_name: thMonth(r.month),
      ytd_gross: round2(running.gross),
      ytd_tax:   round2(running.total_tax),
      ytd_net:   round2(running.total_net),
    };
  });

  const totals = rows.reduce((acc, r) => {
    acc.gross     += parseFloat(r.gross || 0);
    acc.total_ot  += parseFloat(r.total_ot || 0);
    acc.total_bonus += parseFloat(r.total_bonus || 0);
    acc.total_ss  += parseFloat(r.total_ss || 0);
    acc.total_pf  += parseFloat(r.total_pf || 0);
    acc.total_tax += parseFloat(r.total_tax || 0);
    acc.total_net += parseFloat(r.total_net || 0);
    return acc;
  }, { gross: 0, total_ot: 0, total_bonus: 0, total_ss: 0, total_pf: 0, total_tax: 0, total_net: 0 });

  // รายพนักงาน YTD
  const { rows: perEmp } = await db.query(
    `SELECT
       e.id AS employee_id,
       COALESCE(e.employee_code,'') AS employee_code,
       e.name AS employee_name,
       d.name AS department_name,
       ROUND((SUM(COALESCE(pr.salary,0) + COALESCE(pr.ot_pay,0)
         + COALESCE(pr.bonus,0) + COALESCE(pr.special_allowance,0)))::numeric, 2) AS ytd_gross,
       ROUND((SUM(COALESCE(pr.social_security,0)))::numeric, 2)   AS ytd_ss,
       ROUND((SUM(COALESCE(pr.tax_withholding,0)))::numeric, 2)   AS ytd_tax,
       ROUND((SUM(COALESCE(pr.net_income,0)))::numeric, 2)         AS ytd_net,
       COUNT(pr.id) AS months_count
     FROM payroll_records pr
     JOIN employees e ON e.id = pr.employee_id
     LEFT JOIN departments d ON d.id = e.department_id
     WHERE pr.year = $1
     GROUP BY e.id, e.employee_code, e.name, d.name
     ORDER BY d.name, e.name`,
    [year]
  );

  return {
    year,
    monthly: rows,
    per_employee: perEmp,
    totals: {
      gross:      round2(totals.gross),
      total_ot:   round2(totals.total_ot),
      total_bonus: round2(totals.total_bonus),
      total_ss:   round2(totals.total_ss),
      total_pf:   round2(totals.total_pf),
      total_tax:  round2(totals.total_tax),
      total_net:  round2(totals.total_net),
    },
  };
}

// ─── ปีที่มีข้อมูล ────────────────────────────────────────────────────────

async function getAvailableYears() {
  const { rows } = await db.query(
    `SELECT DISTINCT year FROM payroll_records ORDER BY year DESC`
  );
  return rows.map(r => r.year);
}

// ─── Export ──────────────────────────────────────────────────────────────

// ฟังก์ชัน helper ที่ถูก register ในฐานข้อมูลด้วย CREATE FUNCTION — ไม่ได้ใช้จริง
// สำหรับ export ให้ใช้ GET /api/tax/pnd1/export?format=csv หรือ format=xlsx

function round2Fn(x) { return Math.round((x || 0) * 100) / 100; }

module.exports = { getPND1, getPND1K, getYTDSummary, getAvailableYears };
