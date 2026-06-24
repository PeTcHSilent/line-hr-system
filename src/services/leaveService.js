const db = require('../db');
const dayjs = require('dayjs');
const holidayService = require('./holidayService');

/**
 * สร้างคำขอลา (พร้อม validate gender restriction)
 * @param {boolean} isHalfDay     - ลาครึ่งวัน (true/false)
 * @param {string}  halfDayPeriod - 'morning' | 'afternoon' (ถ้า isHalfDay = true)
 */
async function createLeaveRequest({ employeeId, leaveTypeId, startDate, endDate, reason, employeeSex, isHalfDay = false, halfDayPeriod = null }) {
  // ตรวจสอบ gender restriction
  const typeCheck = await db.query(
    'SELECT * FROM leave_types WHERE id = $1', [leaveTypeId]
  );
  const leaveType = typeCheck.rows[0];
  if (!leaveType) throw new Error('ไม่พบประเภทการลา');

  if (leaveType.gender_restriction && leaveType.gender_restriction !== employeeSex) {
    const genderTH = leaveType.gender_restriction === 'M' ? 'ชาย' : 'หญิง';
    throw new Error(`การลาประเภท "${leaveType.name}" สำหรับพนักงานเพศ${genderTH}เท่านั้น`);
  }

  // คำนวณจำนวนวัน
  let totalDays;
  if (isHalfDay) {
    // ลาครึ่งวัน: ต้องเป็นวันเดียว และต้องระบุช่วงเช้า/บ่าย
    if (startDate !== endDate) throw new Error('การลาครึ่งวันต้องเป็นวันเดียวกัน (startDate = endDate)');
    if (!['morning', 'afternoon'].includes(halfDayPeriod)) throw new Error('กรุณาระบุช่วงเวลา: เช้า (morning) หรือ บ่าย (afternoon)');
    // ตรวจว่าวันนั้นเป็นวันทำงาน
    const workdays = await countWorkdays(startDate, endDate);
    if (workdays === 0) throw new Error('วันที่เลือกเป็นวันหยุดหรือวันเสาร์-อาทิตย์');
    totalDays = 0.5;
  } else {
    // ลาเต็มวัน: คำนวณปกติ (ไม่นับเสาร์-อาทิตย์ และวันหยุดนักขัตฤกษ์)
    totalDays = await countWorkdays(startDate, endDate);
    if (totalDays === 0) throw new Error('ไม่มีวันทำงานในช่วงที่เลือก');
  }

  const result = await db.query(
    `INSERT INTO leave_requests
       (employee_id, leave_type_id, start_date, end_date, total_days, reason, is_half_day, half_day_period)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *, (SELECT name FROM leave_types WHERE id = $2) AS leave_type_name`,
    [employeeId, leaveTypeId, startDate, endDate, totalDays, reason, isHalfDay, halfDayPeriod || null]
  );
  return result.rows[0];
}

/**
 * อนุมัติ / ปฏิเสธคำขอลา (พร้อม return line_user_id ของพนักงาน)
 */
async function updateLeaveStatus(leaveId, status, approvedBy, rejectReason = null) {
  // ตรวจสถานะปัจจุบันก่อน — ป้องกันอนุมัติ/ปฏิเสธซ้ำ
  const current = await db.query(
    'SELECT status FROM leave_requests WHERE id=$1', [leaveId]
  );
  if (!current.rows[0]) throw new Error('ไม่พบคำขอลา');
  if (current.rows[0].status !== 'pending') {
    const statusTh = current.rows[0].status === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว';
    throw new Error(`คำขอลานี้ถูก${statusTh}ไปแล้ว ไม่สามารถเปลี่ยนสถานะซ้ำได้`);
  }

  const result = await db.query(
    `UPDATE leave_requests
     SET status = $1, approved_by = $2, approved_at = NOW(),
         reject_reason = $3, updated_at = NOW()
     WHERE id = $4 AND status = 'pending'
     RETURNING *,
       (SELECT name FROM employees WHERE id = employee_id) AS employee_name,
       (SELECT line_user_id FROM employees WHERE id = employee_id) AS employee_line_id`,
    [status, approvedBy, rejectReason, leaveId]
  );
  if (!result.rows[0]) throw new Error('ไม่สามารถอัปเดตสถานะได้ (อาจถูกเปลี่ยนไปแล้ว)');
  return result.rows[0];
}

/**
 * ดึงคำขอลาที่รอการอนุมัติ (สำหรับหัวหน้า)
 */
async function getPendingRequests(managerId) {
  const result = await db.query(
    `SELECT lr.*, e.name AS employee_name, lt.name AS leave_type_name
     FROM leave_requests lr
     JOIN employees e ON lr.employee_id = e.id
     JOIN leave_types lt ON lr.leave_type_id = lt.id
     WHERE e.manager_id = $1 AND lr.status = 'pending'
     ORDER BY lr.created_at ASC`,
    [managerId]
  );
  return result.rows;
}

/**
 * ดึงปฏิทินการลา
 */
async function getLeaveCalendar(year, month) {
  const result = await db.query(
    `SELECT lr.start_date, lr.end_date, lr.total_days,
            e.name AS employee_name, d.name AS department_name, lt.name AS leave_type
     FROM leave_requests lr
     JOIN employees e ON lr.employee_id = e.id
     JOIN departments d ON e.department_id = d.id
     JOIN leave_types lt ON lr.leave_type_id = lt.id
     WHERE lr.status = 'approved'
       AND (
         (EXTRACT(YEAR FROM lr.start_date) = $1 AND EXTRACT(MONTH FROM lr.start_date) = $2)
         OR (EXTRACT(YEAR FROM lr.end_date) = $1 AND EXTRACT(MONTH FROM lr.end_date) = $2)
       )
     ORDER BY lr.start_date`,
    [year, month]
  );
  return result.rows;
}

/**
 * นับวันทำงาน (ทำงานจันทร์-เสาร์ — ข้ามเฉพาะอาทิตย์ และวันหยุดนักขัตฤกษ์)
 * @returns {Promise<number>}
 */
async function countWorkdays(startDate, endDate) {
  // ดึง Set ของวันหยุดในช่วงนี้จาก DB
  const holidaySet = await holidayService.getHolidayDatesInRange(startDate, endDate);

  let count = 0;
  let current = dayjs(startDate);
  const end = dayjs(endDate);

  while (current.isBefore(end) || current.isSame(end, 'day')) {
    const day = current.day();
    const dateStr = current.format('YYYY-MM-DD');
    // ข้ามเฉพาะอาทิตย์ (0) และวันหยุดนักขัตฤกษ์ — เสาร์ (6) นับเป็นวันทำงาน
    if (day !== 0 && !holidaySet.has(dateStr)) count++;
    current = current.add(1, 'day');
  }
  return count;
}

/**
 * ดึงประวัติการลาของพนักงาน (สำหรับ employee ดูของตัวเอง)
 * @param {number} employeeId
 * @param {number|null} year  - ถ้าไม่ระบุ = ดูทุกปี
 * @param {string|null} status - 'pending'|'approved'|'rejected'|null
 */
async function getLeaveHistory(employeeId, year = null, status = null) {
  const conditions = ['lr.employee_id = $1'];
  const values = [employeeId];
  let idx = 2;

  if (year) {
    conditions.push(`EXTRACT(YEAR FROM lr.start_date) = $${idx++}`);
    values.push(year);
  }
  if (status) {
    conditions.push(`lr.status = $${idx++}`);
    values.push(status);
  }

  const result = await db.query(
    `SELECT lr.id, lr.status, lr.start_date, lr.end_date, lr.total_days,
            lr.reason, lr.reject_reason, lr.approved_at, lr.created_at,
            lt.name AS leave_type_name,
            approver.name AS approved_by_name
     FROM leave_requests lr
     JOIN leave_types lt ON lr.leave_type_id = lt.id
     LEFT JOIN employees approver ON lr.approved_by = approver.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY lr.created_at DESC`,
    values
  );
  return result.rows;
}

/**
 * ดึงประวัติการลาทั้งหมด (สำหรับ Admin)
 * รองรับ filter: year, month, departmentId, status, employeeId, branchId
 */
async function getAllLeaveHistory({ year, month, departmentId, status, employeeId, branchId } = {}) {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (year)         { conditions.push(`EXTRACT(YEAR FROM lr.start_date) = $${idx++}`);  values.push(year); }
  if (month)        { conditions.push(`EXTRACT(MONTH FROM lr.start_date) = $${idx++}`); values.push(month); }
  if (status)       { conditions.push(`lr.status = $${idx++}`);                          values.push(status); }
  if (employeeId)   { conditions.push(`lr.employee_id = $${idx++}`);                    values.push(employeeId); }
  if (departmentId) { conditions.push(`e.department_id = $${idx++}`);                   values.push(departmentId); }
  if (branchId)     { conditions.push(`e.branch_id = $${idx++}`);                       values.push(branchId); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await db.query(
    `SELECT lr.id, lr.status, lr.start_date, lr.end_date, lr.total_days,
            lr.is_half_day, lr.half_day_period,
            lr.reason, lr.reject_reason, lr.approved_at, lr.created_at,
            lt.name AS leave_type_name,
            e.name AS employee_name, e.employee_code,
            d.name AS department_name,
            b.name AS branch_name,
            approver.name AS approved_by_name
     FROM leave_requests lr
     JOIN leave_types lt ON lr.leave_type_id = lt.id
     JOIN employees e ON lr.employee_id = e.id
     LEFT JOIN departments d ON e.department_id = d.id
     LEFT JOIN branches b ON e.branch_id = b.id
     LEFT JOIN employees approver ON lr.approved_by = approver.id
     ${where}
     ORDER BY lr.created_at DESC
     LIMIT 500`,
    values
  );
  return result.rows;
}

/**
 * ยกเลิกคำขอลา (เฉพาะ status = pending เท่านั้น)
 */
async function cancelLeaveRequest(leaveId, employeeId) {
  const result = await db.query(
    `UPDATE leave_requests
     SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND employee_id = $2 AND status = 'pending'
     RETURNING id, status`,
    [leaveId, employeeId]
  );
  if (!result.rows[0]) throw new Error('ไม่พบคำขอลา หรือไม่สามารถยกเลิกได้ (อนุมัติแล้ว)');
  return result.rows[0];
}

module.exports = {
  createLeaveRequest, updateLeaveStatus, getPendingRequests,
  getLeaveCalendar, getLeaveHistory, getAllLeaveHistory, cancelLeaveRequest,
};
