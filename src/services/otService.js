const db = require('../db');

async function getAllOT({ year, month, departmentId, status, employeeId, branchId } = {}) {
  const conditions = ['1=1'];
  const values = [];
  let idx = 1;
  if (year)         { conditions.push('EXTRACT(YEAR  FROM o.ot_date) = $' + idx++); values.push(year); }
  if (month)        { conditions.push('EXTRACT(MONTH FROM o.ot_date) = $' + idx++); values.push(month); }
  if (status)       { conditions.push('o.status = $' + idx++); values.push(status); }
  if (employeeId)   { conditions.push('o.employee_id = $' + idx++); values.push(employeeId); }
  if (departmentId) { conditions.push('e.department_id = $' + idx++); values.push(departmentId); }
  if (branchId)     { conditions.push('e.branch_id = $' + idx++); values.push(branchId); }
  const result = await db.query(
    'SELECT o.*,' +
    '  e.name    AS employee_name,' +
    '  e.employee_code,' +
    '  d.name    AS department_name,' +
    '  a.name    AS approved_by_name' +
    ' FROM ot_records o' +
    ' JOIN employees e ON e.id = o.employee_id' +
    ' LEFT JOIN departments d ON d.id = e.department_id' +
    ' LEFT JOIN employees a ON a.id = o.approved_by' +
    ' WHERE ' + conditions.join(' AND ') +
    ' ORDER BY o.ot_date DESC, o.created_at DESC' +
    ' LIMIT 500',
    values
  );
  return result.rows;
}

async function createOT({ employeeId, otDate, startTime, endTime, reason }) {
  if (!otDate || !startTime || !endTime || !reason)
    throw new Error('กรุณากรอกข้อมูลให้ครบ (วันที่, เวลา, เหตุผล)');
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const totalHours = parseFloat(((eh * 60 + em - sh * 60 - sm) / 60).toFixed(2));
  if (totalHours <= 0) throw new Error('เวลาสิ้นสุดต้องหลังจากเวลาเริ่มต้น');
  const settingsService = require('./settingsService');
  const otType = await settingsService.getOTType(otDate);
  const result = await db.query(
    'INSERT INTO ot_records (employee_id, ot_date, start_time, end_time, total_hours, reason, ot_type)' +
    ' VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
    [employeeId, otDate, startTime, endTime, totalHours, reason, otType]
  );
  return result.rows[0];
}

async function updateOTStatus(id, status, approvedBy) {
  const allowed = ['approved', 'rejected'];
  if (!allowed.includes(status)) throw new Error('สถานะไม่ถูกต้อง');
  const current = await db.query('SELECT status FROM ot_records WHERE id=$1', [id]);
  if (!current.rows[0]) throw new Error('ไม่พบรายการ OT');
  if (current.rows[0].status !== 'pending') {
    const statusTh = current.rows[0].status === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว';
    throw new Error('รายการ OT นี้ถูก' + statusTh + 'ไปแล้ว ไม่สามารถเปลี่ยนสถานะซ้ำได้');
  }
  const result = await db.query(
    'UPDATE ot_records' +
    " SET status=$1, approved_by=$2, approved_at=NOW(), updated_at=NOW()" +
    " WHERE id=$3 AND status='pending'" +
    ' RETURNING *,' +
    '   (SELECT name FROM employees WHERE id=employee_id)         AS employee_name,' +
    '   (SELECT line_user_id FROM employees WHERE id=employee_id) AS employee_line_id',
    [status, approvedBy || null, id]
  );
  if (!result.rows[0]) throw new Error('ไม่สามารถอัปเดตสถานะได้ (อาจถูกเปลี่ยนไปแล้ว)');
  return result.rows[0];
}

async function deleteOT(id, employeeId) {
  const check = await db.query('SELECT status FROM ot_records WHERE id=$1 AND employee_id=$2', [id, employeeId]);
  if (!check.rows[0]) throw new Error('ไม่พบรายการ OT');
  if (check.rows[0].status !== 'pending') throw new Error('ลบได้เฉพาะรายการที่ยังไม่ได้อนุมัติ');
  await db.query('DELETE FROM ot_records WHERE id=$1', [id]);
  return { success: true };
}

async function getOTSummary({ year, month } = {}) {
  const cy = year  || new Date().getFullYear();
  const cm = month || new Date().getMonth() + 1;
  const result = await db.query(
    'SELECT' +
    "  COUNT(*) FILTER (WHERE status='pending')  AS pending," +
    "  COUNT(*) FILTER (WHERE status='approved') AS approved," +
    "  COUNT(*) FILTER (WHERE status='rejected') AS rejected," +
    "  COALESCE(SUM(total_hours) FILTER (WHERE status='approved'), 0) AS total_hours" +
    ' FROM ot_records' +
    ' WHERE EXTRACT(YEAR FROM ot_date)=$1 AND EXTRACT(MONTH FROM ot_date)=$2',
    [cy, cm]
  );
  return result.rows[0];
}

async function getOTReportPerEmployee({ year, month, employeeId } = {}) {
  const settingsService = require('./settingsService');
  const otRates = await settingsService.getOTRates();
  const conditions = ["o.status = 'approved'", 'e.is_active = TRUE'];
  const values = [otRates.holiday, otRates.weekend, otRates.weekday];
  let idx = 4;
  if (year)       { conditions.push('EXTRACT(YEAR  FROM o.ot_date) = $' + idx++); values.push(year); }
  if (month)      { conditions.push('EXTRACT(MONTH FROM o.ot_date) = $' + idx++); values.push(month); }
  if (employeeId) { conditions.push('o.employee_id = $' + idx++); values.push(employeeId); }
  const result = await db.query(
    `SELECT
       e.id              AS employee_id,
       e.name            AS employee_name,
       e.employee_code,
       d.name            AS department_name,
       b.name            AS branch_name,
       COUNT(o.id)::int  AS ot_count,
       ROUND(COALESCE(SUM(o.total_hours), 0)::numeric, 2) AS total_hours,
       ROUND(COALESCE(SUM(
         (e.salary / 30.0 / 8.0) *
         CASE COALESCE(o.ot_type,'weekday')
           WHEN 'holiday' THEN $1
           WHEN 'weekend' THEN $2
           ELSE $3
         END * o.total_hours
       ), 0)::numeric, 2) AS ot_pay
     FROM ot_records o
     JOIN employees e ON e.id = o.employee_id
     LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN branches b ON b.id = e.branch_id
     WHERE ${conditions.join(' AND ')}
     GROUP BY e.id, e.name, e.employee_code, d.name, b.name
     ORDER BY d.name, e.name`,
    values
  );
  return result.rows;
}

async function getOTMonthlyBreakdown({ year, employeeId } = {}) {
  if (!employeeId) throw new Error('ต้องระบุ employeeId');
  const cy = year || new Date().getFullYear();
  const settingsService = require('./settingsService');
  const otRates = await settingsService.getOTRates();
  const result = await db.query(
    `SELECT
       EXTRACT(MONTH FROM o.ot_date)::int AS month,
       COUNT(o.id)::int                   AS ot_count,
       ROUND(COALESCE(SUM(o.total_hours), 0)::numeric, 2) AS total_hours,
       ROUND(COALESCE(SUM(
         (e.salary / 30.0 / 8.0) *
         CASE COALESCE(o.ot_type,'weekday')
           WHEN 'holiday' THEN $3
           WHEN 'weekend' THEN $4
           ELSE $5
         END * o.total_hours
       ), 0)::numeric, 2) AS ot_pay
     FROM ot_records o
     JOIN employees e ON e.id = o.employee_id
     WHERE o.status = 'approved'
       AND o.employee_id = $1
       AND EXTRACT(YEAR FROM o.ot_date) = $2
     GROUP BY EXTRACT(MONTH FROM o.ot_date)
     ORDER BY month`,
    [employeeId, cy, otRates.holiday, otRates.weekend, otRates.weekday]
  );
  return result.rows;
}

async function getOTDailyRecords({ year, month, employeeId } = {}) {
  if (!employeeId) throw new Error('ต้องระบุ employeeId');
  const settingsService = require('./settingsService');
  const otRates = await settingsService.getOTRates();
  const conditions = ["o.status = 'approved'", 'o.employee_id = $1'];
  const values = [employeeId, otRates.holiday, otRates.weekend, otRates.weekday];
  let idx = 5;
  if (year)  { conditions.push('EXTRACT(YEAR  FROM o.ot_date) = $' + idx++); values.push(year); }
  if (month) { conditions.push('EXTRACT(MONTH FROM o.ot_date) = $' + idx++); values.push(month); }
  const result = await db.query(
    `SELECT
       o.id, o.ot_date, o.ot_type, o.start_time, o.end_time, o.total_hours, o.reason,
       ROUND((
         (e.salary / 30.0 / 8.0) *
         CASE COALESCE(o.ot_type,'weekday')
           WHEN 'holiday' THEN $2
           WHEN 'weekend' THEN $3
           ELSE $4
         END * o.total_hours
       )::numeric, 2) AS ot_pay_day
     FROM ot_records o
     JOIN employees e ON e.id = o.employee_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY o.ot_date ASC, o.start_time ASC`,
    values
  );
  return result.rows;
}

async function updateOTRecord(id, { otDate, startTime, endTime, totalHours, otType, reason }) {
  const existing = await db.query('SELECT * FROM ot_records WHERE id = $1', [id]);
  if (!existing.rows[0]) throw new Error('ไม่พบ OT record');
  let computedHours = totalHours != null ? parseFloat(totalHours) : null;
  if (computedHours == null && startTime && endTime) {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    computedHours = parseFloat(((eh * 60 + em - sh * 60 - sm) / 60).toFixed(2));
    if (computedHours <= 0) throw new Error('เวลาสิ้นสุดต้องหลังเวลาเริ่มต้น');
  }
  const r         = existing.rows[0];
  const newDate   = otDate     !== undefined ? otDate     : r.ot_date;
  const newStart  = startTime  !== undefined ? startTime  : r.start_time;
  const newEnd    = endTime    !== undefined ? endTime    : r.end_time;
  const newHours  = computedHours != null   ? computedHours : parseFloat(r.total_hours);
  const newReason = reason     !== undefined ? reason     : r.reason;
  let newType = otType !== undefined ? otType : r.ot_type;
  if (otDate && !otType) {
    try {
      const settingsService = require('./settingsService');
      newType = await settingsService.getOTType(otDate);
    } catch (_) { /* fallback */ }
  }
  const result = await db.query(
    `UPDATE ot_records
     SET ot_date=$1, start_time=$2, end_time=$3, total_hours=$4, ot_type=$5, reason=$6, updated_at=NOW()
     WHERE id=$7 RETURNING *`,
    [newDate, newStart, newEnd, newHours, newType, newReason, id]
  );
  return result.rows[0];
}

module.exports = {
  getAllOT, createOT, updateOTStatus, deleteOT, getOTSummary,
  getOTReportPerEmployee, getOTMonthlyBreakdown, getOTDailyRecords, updateOTRecord,
};
