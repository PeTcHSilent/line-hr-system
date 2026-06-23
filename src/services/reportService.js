const db = require('../db');

/**
 * รายงานสรุปรายเดือน
 * คืนค่า: attendance, leave, OT per employee/department
 */
async function getMonthlySummary({ year, month, departmentId } = {}) {
  const cy = year  || new Date().getFullYear();
  const cm = month || new Date().getMonth() + 1;

  const deptFilter = departmentId ? 'AND e.department_id = $3' : '';
  const attVals = departmentId ? [cy, cm, departmentId] : [cy, cm];

  // ---- Attendance summary per employee ----
  const attQ = `
    SELECT
      e.id AS employee_id,
      e.employee_code,
      e.name AS employee_name,
      d.name AS department_name,
      COUNT(a.id)                                              AS work_days,
      COUNT(a.id) FILTER (WHERE a.check_in IS NOT NULL)       AS checkin_days,
      COUNT(a.id) FILTER (WHERE a.check_out IS NOT NULL)      AS checkout_days,
      ROUND(AVG(EXTRACT(EPOCH FROM (a.check_out - a.check_in))/3600)
            FILTER (WHERE a.check_out IS NOT NULL AND a.check_in IS NOT NULL), 2)
                                                               AS avg_hours,
      COUNT(a.id) FILTER (WHERE a.check_in_within_radius = FALSE
                             OR  a.check_out_within_radius = FALSE)
                                                               AS outside_radius_days
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN attendance a
          ON a.employee_id = e.id
         AND EXTRACT(YEAR  FROM a.work_date) = $1
         AND EXTRACT(MONTH FROM a.work_date) = $2
    WHERE e.is_active = TRUE
      ` + deptFilter + `
    GROUP BY e.id, e.employee_code, e.name, d.name
    ORDER BY d.name, e.employee_code
  `;
  const attResult = await db.query(attQ, attVals);

  // ---- Leave summary per employee ----
  const leaveQ = `
    SELECT
      e.id AS employee_id,
      COUNT(lr.id) FILTER (WHERE lr.status='approved')                    AS approved_leaves,
      COALESCE(SUM(lr.total_days) FILTER (WHERE lr.status='approved'), 0) AS leave_days,
      COUNT(lr.id) FILTER (WHERE lr.status='pending')                     AS pending_leaves
    FROM employees e
    LEFT JOIN leave_requests lr
          ON lr.employee_id = e.id
         AND EXTRACT(YEAR  FROM lr.start_date) = $1
         AND EXTRACT(MONTH FROM lr.start_date) = $2
    WHERE e.is_active = TRUE
      ` + deptFilter + `
    GROUP BY e.id
  `;
  const leaveResult = await db.query(leaveQ, attVals);
  const leaveMap = {};
  leaveResult.rows.forEach(r => { leaveMap[r.employee_id] = r; });

  // ---- OT summary + pay per employee ----
  // weekday OT -> x1.5, holiday OT -> x3.0
  const otQ = `
    SELECT
      e.id AS employee_id,
      COALESCE(e.salary, 0)                                                    AS salary,
      COUNT(o.id) FILTER (WHERE o.status='approved')                           AS approved_ot,
      COALESCE(SUM(o.total_hours) FILTER (WHERE o.status='approved'), 0)       AS ot_hours,
      COALESCE(
        SUM(
          CASE
            WHEN o.status = 'approved'
            THEN (COALESCE(e.salary,0) / 30.0 / 8.0)
                 * COALESCE(o.total_hours, 0)
                 * CASE COALESCE(o.ot_type, 'weekday')
                     WHEN 'holiday' THEN 3.0
                     ELSE 1.5
                   END
            ELSE 0
          END
        ), 0
      )                                                                         AS ot_pay
    FROM employees e
    LEFT JOIN ot_records o
          ON o.employee_id = e.id
         AND EXTRACT(YEAR  FROM o.ot_date) = $1
         AND EXTRACT(MONTH FROM o.ot_date) = $2
    WHERE e.is_active = TRUE
      ` + deptFilter + `
    GROUP BY e.id, e.salary
  `;
  const otResult = await db.query(otQ, attVals);
  const otMap = {};
  otResult.rows.forEach(r => { otMap[r.employee_id] = r; });

  // ---- Merge ----
  const rows = attResult.rows.map(r => ({
    ...r,
    ...(leaveMap[r.employee_id] || { approved_leaves: 0, leave_days: 0, pending_leaves: 0 }),
    ...(otMap[r.employee_id]    || { approved_ot: 0, ot_hours: 0, ot_pay: 0 }),
  }));

  // ---- Overall totals ----
  const totalEmp       = rows.length;
  const totalWorkDays  = rows.reduce((s, r) => s + parseInt(r.checkin_days || 0), 0);
  const totalLeaveDays = rows.reduce((s, r) => s + parseFloat(r.leave_days  || 0), 0);
  const totalOTHours   = rows.reduce((s, r) => s + parseFloat(r.ot_hours   || 0), 0);

  return {
    year: cy, month: cm,
    summary: {
      totalEmp,
      totalWorkDays,
      totalLeaveDays: totalLeaveDays.toFixed(1),
      totalOTHours: totalOTHours.toFixed(1),
    },
    rows,
  };
}

/**
 * ปฏิทิน: วันหยุด + ใบลาอนุมัติในเดือนนั้น
 */
async function getCalendarData({ year, month } = {}) {
  const cy = year  || new Date().getFullYear();
  const cm = month || new Date().getMonth() + 1;

  const holResult = await db.query(
    `SELECT date, name FROM holidays
     WHERE EXTRACT(YEAR FROM date)=$1 AND EXTRACT(MONTH FROM date)=$2
     ORDER BY date`,
    [cy, cm]
  );

  const leaveResult = await db.query(
    `SELECT lr.start_date, lr.end_date, lr.total_days,
            e.name AS employee_name, e.employee_code,
            lt.name AS leave_type_name
     FROM leave_requests lr
     JOIN employees e  ON e.id  = lr.employee_id
     JOIN leave_types lt ON lt.id = lr.leave_type_id
     WHERE lr.status = 'approved'
       AND (
         (EXTRACT(YEAR FROM lr.start_date)=$1 AND EXTRACT(MONTH FROM lr.start_date)=$2)
         OR
         (EXTRACT(YEAR FROM lr.end_date)=$1   AND EXTRACT(MONTH FROM lr.end_date)=$2)
       )
     ORDER BY lr.start_date`,
    [cy, cm]
  );

  return {
    year: cy, month: cm,
    holidays: holResult.rows,
    leaves: leaveResult.rows,
  };
}

module.exports = { getMonthlySummary, getCalendarData };
