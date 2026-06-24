const db = require('../db');
const dayjs = require('dayjs');
const branchService = require('./branchService');

// ---- Office GPS Config (fallback จาก .env เมื่อพนักงานไม่ได้ผูกสาขา) ----
const OFFICE_LAT    = parseFloat(process.env.OFFICE_LAT    || '13.7563');
const OFFICE_LNG    = parseFloat(process.env.OFFICE_LNG    || '100.5018');
const OFFICE_RADIUS = parseFloat(process.env.OFFICE_RADIUS_METERS || '300');

// ดึง GPS ของสาขาที่พนักงานสังกัด หรือ fallback เป็น ENV
async function getOfficeGPS(employeeId) {
  try {
    const branch = await branchService.getBranchByEmployeeId(employeeId);
    if (branch && branch.lat != null && branch.lng != null) {
      return { lat: branch.lat, lng: branch.lng, radius: branch.radius_meters, branchName: branch.name };
    }
  } catch (e) { /* fallback */ }
  return { lat: OFFICE_LAT, lng: OFFICE_LNG, radius: OFFICE_RADIUS, branchName: null };
}

/**
 * คำนวณระยะทาง Haversine (เมตร)
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // รัศมีโลก (เมตร)
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * ดึงสถานะการ Check-in วันนี้ของพนักงาน
 */
async function getTodayStatus(employeeId) {
  const today = dayjs().format('YYYY-MM-DD');
  const result = await db.query(
    `SELECT a.*,
            e.name AS employee_name
     FROM attendance a
     JOIN employees e ON a.employee_id = e.id
     WHERE a.employee_id = $1 AND a.work_date = $2`,
    [employeeId, today]
  );
  const row = result.rows[0] || null;
  const gps = await getOfficeGPS(employeeId);
  return {
    date: today,
    has_checked_in:  !!row?.check_in,
    has_checked_out: !!row?.check_out,
    record: row,
    office: { lat: gps.lat, lng: gps.lng, radius: gps.radius, branch: gps.branchName },
  };
}

/**
 * เช็คอิน พร้อมตรวจสอบ GPS radius
 */
async function checkIn(employeeId, lat = null, lng = null, type = 'app') {
  const today = dayjs().format('YYYY-MM-DD');

  // ตรวจสอบว่าเช็คอินวันนี้แล้วยัง
  const existing = await db.query(
    'SELECT id, check_in FROM attendance WHERE employee_id = $1 AND work_date = $2',
    [employeeId, today]
  );
  if (existing.rows[0]?.check_in) {
    return {
      success: false,
      message: 'เช็คอินวันนี้ไปแล้ว',
      data: existing.rows[0],
    };
  }

  // คำนวณระยะห่าง GPS จากสาขาที่พนักงานสังกัด
  const gpsIn = await getOfficeGPS(employeeId);
  let distance = null;
  let withinRadius = null;
  if (lat != null && lng != null) {
    distance     = Math.round(haversineDistance(gpsIn.lat, gpsIn.lng, lat, lng));
    withinRadius = distance <= gpsIn.radius;
  }

  const result = await db.query(
    `INSERT INTO attendance
       (employee_id, work_date, check_in, check_in_lat, check_in_lng, check_in_type,
        check_in_distance, check_in_within_radius)
     VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7)
     ON CONFLICT (employee_id, work_date)
       DO UPDATE SET
         check_in = NOW(), check_in_lat = $3, check_in_lng = $4,
         check_in_distance = $6, check_in_within_radius = $7
     RETURNING *`,
    [employeeId, today, lat, lng, type, distance, withinRadius]
  );

  return {
    success: true,
    message: withinRadius === false
      ? `เช็คอินสำเร็จ (อยู่นอกรัศมีออฟฟิศ ${distance} ม.)`
      : 'เช็คอินสำเร็จ',
    distance,
    within_radius: withinRadius,
    data: result.rows[0],
  };
}

/**
 * เช็คเอาท์ พร้อมตรวจสอบ GPS radius
 */
async function checkOut(employeeId, lat = null, lng = null) {
  const today = dayjs().format('YYYY-MM-DD');

  const existing = await db.query(
    'SELECT id, check_in, check_out FROM attendance WHERE employee_id = $1 AND work_date = $2',
    [employeeId, today]
  );

  if (!existing.rows[0]?.check_in) {
    return { success: false, message: 'ยังไม่ได้เช็คอินวันนี้' };
  }
  if (existing.rows[0]?.check_out) {
    return { success: false, message: 'เช็คเอาท์วันนี้ไปแล้ว', data: existing.rows[0] };
  }

  // คำนวณระยะห่าง GPS จากสาขาที่พนักงานสังกัด
  const gpsOut = await getOfficeGPS(employeeId);
  let distance = null;
  let withinRadius = null;
  if (lat != null && lng != null) {
    distance     = Math.round(haversineDistance(gpsOut.lat, gpsOut.lng, lat, lng));
    withinRadius = distance <= gpsOut.radius;
  }

  const result = await db.query(
    `UPDATE attendance
     SET check_out = NOW(), check_out_lat = $1, check_out_lng = $2,
         check_out_distance = $3, check_out_within_radius = $4
     WHERE employee_id = $5 AND work_date = $6
     RETURNING *`,
    [lat, lng, distance, withinRadius, employeeId, today]
  );

  // คำนวณชั่วโมงทำงาน
  const row = result.rows[0];
  const hoursWorked = row.check_in && row.check_out
    ? ((new Date(row.check_out) - new Date(row.check_in)) / 3600000).toFixed(2)
    : null;

  return {
    success: true,
    message: 'เช็คเอาท์สำเร็จ',
    distance,
    within_radius: withinRadius,
    hours_worked: hoursWorked,
    data: row,
  };
}

/**
 * ดึงประวัติการ Check-in ของพนักงาน (ใช้ใน LIFF)
 * @param {number} employeeId
 * @param {number} days - จำนวนวันย้อนหลัง (default 14)
 */
async function getAttendanceHistory(employeeId, days = 14) {
  const result = await db.query(
    `SELECT work_date, check_in, check_out,
            check_in_within_radius, check_out_within_radius,
            check_in_distance, check_out_distance,
            ROUND(EXTRACT(EPOCH FROM (check_out - check_in))/3600, 2) AS hours_worked
     FROM attendance
     WHERE employee_id = $1
       AND work_date >= CURRENT_DATE - $2::int
     ORDER BY work_date DESC`,
    [employeeId, days]
  );
  return result.rows;
}

/**
 * ดึงข้อมูล Attendance ทั้งหมด (สำหรับ Admin)
 * รองรับ filter: date, departmentId, employeeId
 */
async function getAllAttendance({ date, departmentId, employeeId, month, year } = {}) {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (date)         { conditions.push(`a.work_date = $${idx++}`);                    values.push(date); }
  if (month)        { conditions.push(`EXTRACT(MONTH FROM a.work_date) = $${idx++}`); values.push(month); }
  if (year)         { conditions.push(`EXTRACT(YEAR FROM a.work_date) = $${idx++}`);  values.push(year); }
  if (employeeId)   { conditions.push(`a.employee_id = $${idx++}`);                  values.push(employeeId); }
  if (departmentId) { conditions.push(`e.department_id = $${idx++}`);                values.push(departmentId); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await db.query(
    `SELECT a.id, a.work_date, a.check_in, a.check_out,
            a.check_in_distance, a.check_out_distance,
            a.check_in_within_radius, a.check_out_within_radius,
            a.note,
            ROUND(EXTRACT(EPOCH FROM (a.check_out - a.check_in))/3600, 2) AS hours_worked,
            e.name AS employee_name, e.employee_code,
            d.name AS department_name
     FROM attendance a
     JOIN employees e ON a.employee_id = e.id
     LEFT JOIN departments d ON e.department_id = d.id
     ${where}
     ORDER BY a.work_date DESC, a.check_in DESC
     LIMIT 500`,
    values
  );
  return result.rows;
}

/**
 * รายงานการลงเวลา — แยก clock_in/clock_out เป็�า clock_in/clock_out เป็นแถวแยก
 * params: { startDate, endDate, departmentId, employeeId }
 */
async function getAttendanceReport({ startDate, endDate, departmentId, employeeId, branchId } = {}) {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (startDate)    { conditions.push(`a.work_date >= $${idx++}`);               values.push(startDate); }
  if (endDate)      { conditions.push(`a.work_date <= $${idx++}`);               values.push(endDate); }
  if (employeeId)   { conditions.push(`a.employee_id = $${idx++}`);              values.push(employeeId); }
  if (departmentId) { conditions.push(`e.department_id = $${idx++}`);            values.push(departmentId); }
  if (branchId)     { conditions.push(`e.branch_id = $${idx++}`);                values.push(branchId); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await db.query(
    `SELECT
        a.id,
        a.work_date,
        a.check_in,
        a.check_out,
        a.check_in_distance,
        a.check_out_distance,
        a.check_in_within_radius,
        a.check_out_within_radius,
        a.note,
        ROUND(EXTRACT(EPOCH FROM (COALESCE(a.check_out, NOW()) - a.check_in))/3600, 2) AS hours_worked,
        e.name        AS employee_name,
        e.employee_code,
        d.name        AS department_name
     FROM attendance a
     JOIN employees e ON a.employee_id = e.id
     LEFT JOIN departments d ON e.department_id = d.id
     ${where}
     ORDER BY a.work_date DESC, a.check_in DESC
     LIMIT 2000`,
    values
  );
  return result.rows;
}

module.exports = {
  checkIn,
  checkOut,
  getTodayStatus,
  getAttendanceHistory,
  getAllAttendance,
  getAttendanceReport,
};
