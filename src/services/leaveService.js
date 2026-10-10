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

  // ── ยังทดลองงาน = ยังไม่ได้สวัสดิการวันลาของบริษัท ──────────
  // ประเภทไหนใช้ได้/ไม่ได้ ดูจาก leave_types.allowed_during_probation
  // (ตั้งจากหน้าเว็บได้ ไม่ได้ fix ชื่อไว้ในโค้ด — ดู migration v32)
  if (leaveType.allowed_during_probation === false) {
    const emp = await db.query(
      'SELECT name, probation_status, probation_end_date FROM employees WHERE id = $1',
      [employeeId]
    );
    const e = emp.rows[0];

    // นับเป็นทดลองงานเฉพาะ on_probation กับ extended
    // passed = ผ่านแล้ว | failed = ไม่ผ่าน (ปกติจะถูกปิด is_active ไปแล้ว)
    // ถ้า probation_status เป็น NULL แปลว่าเป็นพนักงานเก่าก่อนมีระบบนี้ → ถือว่าผ่านแล้ว
    if (e && ['on_probation', 'extended'].includes(e.probation_status)) {
      const until = e.probation_end_date
        ? ` (ถึง ${fmtDate(e.probation_end_date)})`
        : '';
      const alt = await db.query(
        `SELECT name FROM leave_types
         WHERE allowed_during_probation = TRUE AND COALESCE(is_paid, FALSE) = FALSE
         ORDER BY id LIMIT 1`
      );
      const altName = alt.rows[0]?.name || 'ลาไม่รับเงิน';

      throw new Error(
        `ยังอยู่ระหว่างทดลองงาน${until} จึงยังไม่ได้สิทธิ์ "${leaveType.name}"\n` +
        `กรุณาเลือก "${altName}" แทน หรือสอบถามฝ่ายบุคคล`
      );
    }
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

  // ── กันลาซ้อนวันเดิม ──────────────────────────────────────────
  // เดิมยื่นลาป่วย 12–14 แล้วยื่นลากิจ 13 ทับได้ ระบบไม่เตือน
  // → ยอดวันลารวมเกินจริง รายงานเพี้ยน และหัวหน้าเห็นสองใบงงว่าตกลงลาอะไร
  // กรณีนี้ไม่มีเหตุผลที่ถูกต้องเลย จึงบล็อกตรงๆ
  const overlap = await findOverlappingLeave(employeeId, startDate, endDate);
  if (overlap) {
    const span = overlap.start_date === overlap.end_date
      ? fmtDate(overlap.start_date)
      : `${fmtDate(overlap.start_date)} – ${fmtDate(overlap.end_date)}`;
    const statusTh = overlap.status === 'approved' ? 'อนุมัติแล้ว' : 'รออนุมัติ';
    throw new Error(
      `ช่วงวันที่เลือกทับกับใบลาเดิม: ${overlap.leave_type_name} ${span} (${statusTh})\n` +
      'กรุณาเลือกวันใหม่ หรือยกเลิกใบลาเดิมก่อน'
    );
  }

  const result = await db.query(
    `INSERT INTO leave_requests
       (employee_id, leave_type_id, start_date, end_date, total_days, reason, is_half_day, half_day_period)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *, (SELECT name FROM leave_types WHERE id = $2) AS leave_type_name`,
    [employeeId, leaveTypeId, startDate, endDate, totalDays, reason, isHalfDay, halfDayPeriod || null]
  );

  const leave = result.rows[0];

  // ── ตรวจสิทธิ์คงเหลือ ─────────────────────────────────────────
  // ❗ ตั้งใจไม่บล็อก เพราะมีกรณีที่เกินสิทธิ์แล้วยังต้องลาจริงๆ
  //    (ลาป่วยยาวเกินโควตา ฯลฯ) ถ้าบล็อกจะกลายเป็นว่าพนักงานป่วยแล้วยื่นใบลาไม่ได้
  //    แทนที่จะห้าม → แนบข้อมูลไปกับใบลา ให้คนอนุมัติเห็นตอนตัดสินใจ
  //    และส่งกลับให้หน้า LIFF แสดงเตือนตอนยื่นด้วย
  try {
    leave.quota_info = await checkQuota(employeeId, leaveTypeId, employeeSex, totalDays, leave.id);
  } catch (e) {
    console.warn('[leaveService] คำนวณสิทธิ์คงเหลือไม่สำเร็จ:', e.message);
    leave.quota_info = null;
  }

  return leave;
}

/** จัดวันที่เป็น d/m/yy แบบไทย สำหรับข้อความแจ้งเตือน */
function fmtDate(d) {
  const dt = dayjs(d);
  return `${dt.date()}/${dt.month() + 1}/${String((dt.year() + 543) % 100).padStart(2, '0')}`;
}

/**
 * หาใบลาที่ช่วงวันทับกับที่ขอใหม่ (นับเฉพาะ pending / approved)
 * เงื่อนไขทับซ้อนมาตรฐาน: start_a <= end_b AND end_a >= start_b
 */
async function findOverlappingLeave(employeeId, startDate, endDate, excludeId = null) {
  const r = await db.query(
    `SELECT lr.id, lr.start_date, lr.end_date, lr.status,
            lt.name AS leave_type_name
     FROM leave_requests lr
     JOIN leave_types lt ON lt.id = lr.leave_type_id
     WHERE lr.employee_id = $1
       AND lr.status IN ('pending', 'approved')
       AND lr.start_date <= $3::date
       AND lr.end_date   >= $2::date
       AND ($4::int IS NULL OR lr.id <> $4)
     ORDER BY lr.start_date
     LIMIT 1`,
    [employeeId, startDate, endDate, excludeId]
  );
  return r.rows[0] || null;
}

/**
 * คำนวณว่าการลาครั้งนี้ทำให้เกินสิทธิ์หรือไม่
 * @returns {Promise<object|null>} null ถ้าประเภทนั้นไม่ได้กำหนดโควตาไว้
 */
async function checkQuota(employeeId, leaveTypeId, employeeSex, requestedDays, excludeId = null) {
  // ใช้ตัวคำนวณเดิมของระบบ เพื่อให้ผลตรงกับหน้า "เช็คยอดวันลา" เป๊ะ
  // (รวมกฎโควตาตามอายุงานใน leave_quota_rules ด้วย)
  const employeeService = require('./employeeService');
  const balances = await employeeService.getLeaveBalance(employeeId, employeeSex);
  const row = balances.find(b => Number(b.id) === Number(leaveTypeId));

  // ไม่กำหนดโควตา (เช่น ลาไม่รับเงิน) → ไม่มีอะไรให้เกิน
  if (!row || row.effective_quota == null) return null;

  const quota = Number(row.effective_quota);
  // used/pending ที่ดึงมารวมใบที่เพิ่งสร้างไปแล้ว — หักออกก่อนเพื่อไม่ให้นับซ้ำ
  const usedBefore = Number(row.used_days) + Number(row.pending_days) - Number(requestedDays);
  const remainingBefore = quota - Math.max(usedBefore, 0);
  const over = Number(requestedDays) - remainingBefore;

  return {
    leave_type_name: row.name,
    quota,
    remaining_before: Math.max(remainingBefore, 0),
    requested: Number(requestedDays),
    over_days: over > 0 ? Math.round(over * 10) / 10 : 0,
    is_over: over > 0,
  };
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
       (SELECT line_user_id FROM employees WHERE id = employee_id) AS employee_line_id,
       (SELECT name FROM leave_types WHERE id = leave_type_id) AS leave_type_name`,
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
