const express = require('express');
const router = express.Router();
const attendanceService = require('../services/attendanceService');
const employeeService   = require('../services/employeeService');
const { requireAuth }   = require('../middleware/authMiddleware');
const { resolveLineUser } = require('../services/lineVerifyService');
const db    = require('../db');
const audit = require('../services/auditService');

// ══════════════════════════════════════════════════════════════
//  แก้เวลาเข้า-ออกย้อนหลัง (HR เท่านั้น)
// ══════════════════════════════════════════════════════════════
// ที่มา: พนักงานลืมเช็คอิน/เช็คเอาท์เป็นเรื่องที่เกิดทุกสัปดาห์
//        แต่ระบบไม่มีหน้าให้ HR แก้ ต้องไปแก้ในฐานข้อมูลตรงๆ
//        ซึ่งเสี่ยงและไม่มีร่องรอยว่าใครแก้อะไรเมื่อไหร่
//
// จุดที่ต้องระวัง:
//   - ตาราง attendance มี UNIQUE(employee_id, work_date) → ใช้ upsert
//   - check_in_type มี CHECK constraint รับแค่ 'app' | 'qr' | 'manual'
//   - ต้องบันทึก audit log ทุกครั้ง เพราะเป็นข้อมูลที่กระทบการคำนวณเงินเดือน

/**
 * PUT /api/attendance/manual
 * body: { employee_id, work_date, check_in, check_out, note }
 *   check_in / check_out = 'HH:MM' (ตามเวลาไทย) | '' เพื่อล้างค่า | ไม่ส่ง = ไม่แตะ
 */
router.put('/manual', requireAuth, async (req, res) => {
  try {
    const { employee_id, work_date, check_in, check_out, note } = req.body;

    if (!employee_id || !work_date) {
      return res.status(400).json({ error: 'ต้องระบุ employee_id และ work_date' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(work_date)) {
      return res.status(400).json({ error: 'รูปแบบวันที่ต้องเป็น YYYY-MM-DD' });
    }

    const emp = await employeeService.getById(employee_id);
    if (!emp) return res.status(404).json({ error: 'ไม่พบพนักงาน' });

    // '' = ล้างค่า, undefined/null = ไม่แตะของเดิม
    const toTimestamp = (v) => {
      if (v === undefined || v === null) return undefined;
      if (v === '') return null;
      if (!/^\d{2}:\d{2}$/.test(v)) throw new Error(`รูปแบบเวลาต้องเป็น HH:MM (ได้รับ "${v}")`);
      return `${work_date} ${v}:00`;
    };

    let inTs, outTs;
    try {
      inTs  = toTimestamp(check_in);
      outTs = toTimestamp(check_out);
    } catch (e) { return res.status(400).json({ error: e.message }); }

    if (inTs === undefined && outTs === undefined && note === undefined) {
      return res.status(400).json({ error: 'ไม่มีข้อมูลที่จะแก้ไข' });
    }
    // เช็คเอาท์ก่อนเช็คอินไม่สมเหตุสมผล — กันไว้ตั้งแต่ตรงนี้
    if (inTs && outTs && outTs < inTs) {
      return res.status(400).json({ error: 'เวลาเช็คเอาท์ต้องอยู่หลังเวลาเช็คอิน' });
    }

    const before = await db.query(
      'SELECT check_in, check_out, note FROM attendance WHERE employee_id=$1 AND work_date=$2',
      [employee_id, work_date]
    );
    const prev = before.rows[0] || null;

    // ถ้ามีแถวอยู่แล้ว + ส่งมาแค่ฝั่งเดียว ต้องไม่ไปล้างอีกฝั่งทิ้ง
    // COALESCE ใช้ไม่ได้เพราะ null มีความหมายว่า "ล้างค่า" → ใช้ธง keep แทน
    // ❗ เรื่องโซนเวลา — จุดที่พลาดง่ายที่สุดของฟีเจอร์นี้
    //    คอลัมน์ check_in เป็น TIMESTAMP (ไม่เก็บ timezone)
    //    ค่าที่เช็คอินปกติเขียนด้วย NOW() → ได้เวลาตาม timezone ของ "เซิร์ฟเวอร์ DB"
    //    (บน Railway คือ UTC) แต่ HR กรอกเวลาเป็น "เวลาไทย"
    //    ถ้าเขียนลงตรงๆ จะเพี้ยนไป 7 ชั่วโมง — กรอก 18:05 กลายเป็นแสดงผล 01:05
    //
    //    แปลงด้วย SQL แทนการคำนวณใน JS:
    //      $x::timestamp AT TIME ZONE 'Asia/Bangkok'          → instant จริง (timestamptz)
    //      ... AT TIME ZONE current_setting('TimeZone')       → naive ตาม tz ของ DB
    //    ผลลัพธ์จึงตรงกับที่ NOW() เขียน ไม่ว่า DB จะตั้ง timezone อะไรไว้
    const TO_DB_TS = (n) =>
      `CASE WHEN $${n}::text IS NULL THEN NULL ELSE ` +
      `(($${n}::timestamp AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE current_setting('TimeZone')) END`;

    const r = await db.query(
      `INSERT INTO attendance (employee_id, work_date, check_in, check_out, check_in_type, note)
       VALUES ($1, $2, ${TO_DB_TS(3)}, ${TO_DB_TS(4)}, 'manual', $5)
       ON CONFLICT (employee_id, work_date) DO UPDATE SET
         check_in      = CASE WHEN $6 THEN attendance.check_in  ELSE EXCLUDED.check_in  END,
         check_out     = CASE WHEN $7 THEN attendance.check_out ELSE EXCLUDED.check_out END,
         check_in_type = 'manual',
         note          = CASE WHEN $8 THEN attendance.note ELSE EXCLUDED.note END
       RETURNING *`,
      [
        employee_id, work_date,
        inTs  === undefined ? null : inTs,
        outTs === undefined ? null : outTs,
        note  === undefined ? null : note,
        inTs  === undefined,   // $6 = คงค่า check_in เดิม
        outTs === undefined,   // $7 = คงค่า check_out เดิม
        note  === undefined,   // $8 = คงค่า note เดิม
      ]
    );

    const fmt = v => v ? new Date(v).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '—';
    audit.log({
      actorName:   req.admin.display_name || req.admin.username,
      actorRole:   req.admin.role,
      action:      prev ? 'edit_attendance' : 'create_attendance',
      targetType:  'attendance',
      targetId:    r.rows[0].id,
      description:
        `${prev ? 'แก้ไข' : 'เพิ่ม'}เวลาเข้า-ออกย้อนหลัง: ${emp.name} วันที่ ${work_date} ` +
        `(เข้า ${fmt(prev?.check_in)} → ${fmt(r.rows[0].check_in)}, ` +
        `ออก ${fmt(prev?.check_out)} → ${fmt(r.rows[0].check_out)})`,
      meta: {
        employee_id, employee_name: emp.name, work_date,
        before: prev ? { check_in: prev.check_in, check_out: prev.check_out, note: prev.note } : null,
        after:  { check_in: r.rows[0].check_in, check_out: r.rows[0].check_out, note: r.rows[0].note },
      },
    });

    res.json({ success: true, record: r.rows[0], created: !prev });
  } catch (err) {
    console.error('Attendance manual edit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/attendance/checkin
router.post('/checkin', resolveLineUser, async (req, res) => {
  try {
    const { line_user_id, lineUserId, lat, lng } = req.body;
    const uid = line_user_id || lineUserId;
    if (!uid) return res.status(400).json({ error: 'ต้องระบุ line_user_id' });

    const employee = await employeeService.findByLineId(uid);
    if (!employee) return res.status(404).json({ error: 'ไม่พบพนักงาน กรุณาลงทะเบียนก่อน' });

    const result = await attendanceService.checkIn(
      employee.id,
      lat  != null ? parseFloat(lat)  : null,
      lng  != null ? parseFloat(lng)  : null,
      'app'
    );
    res.json(result);
  } catch (err) {
    console.error('CheckIn error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/attendance/checkout
router.post('/checkout', resolveLineUser, async (req, res) => {
  try {
    const { line_user_id, lineUserId, lat, lng } = req.body;
    const uid = line_user_id || lineUserId;
    if (!uid) return res.status(400).json({ error: 'ต้องระบุ line_user_id' });

    const employee = await employeeService.findByLineId(uid);
    if (!employee) return res.status(404).json({ error: 'ไม่พบพนักงาน' });

    const result = await attendanceService.checkOut(
      employee.id,
      lat != null ? parseFloat(lat) : null,
      lng != null ? parseFloat(lng) : null
    );
    res.json(result);
  } catch (err) {
    console.error('CheckOut error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attendance/today?line_user_id=xxx
// สถานะวันนี้ — LIFF ใช้ตอนเปิดหน้า
router.get('/today', resolveLineUser, async (req, res) => {
  try {
    const uid = req.query.line_user_id || req.query.lineUserId;
    if (!uid) return res.status(400).json({ error: 'ต้องระบุ line_user_id' });

    const employee = await employeeService.findByLineId(uid);
    if (!employee) return res.status(404).json({ error: 'ไม่พบพนักงาน' });

    const status = await attendanceService.getTodayStatus(employee.id);
    res.json({ employee_name: employee.name, ...status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attendance/history?line_user_id=xxx&days=14
// ประวัติ LIFF (พนักงาน)
router.get('/history', resolveLineUser, async (req, res) => {
  try {
    const uid  = req.query.line_user_id || req.query.lineUserId;
    const days = parseInt(req.query.days || 14);
    if (!uid) return res.status(400).json({ error: 'ต้องระบุ line_user_id' });

    const employee = await employeeService.findByLineId(uid);
    if (!employee) return res.status(404).json({ error: 'ไม่พบพนักงาน' });

    const history = await attendanceService.getAttendanceHistory(employee.id, days);
    res.json({ employee_name: employee.name, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attendance/all?date=2026-06-08&month=6&year=2026&department_id=1&employee_id=2
// ประวัติทั้งหมด — Admin ใช้
router.get('/all', requireAuth, async (req, res) => {
  try {
    const { date, month, year, department_id, employee_id, branch_id } = req.query;
    const data = await attendanceService.getAllAttendance({
      date:         date         || null,
      month:        month        ? parseInt(month)        : null,
      year:         year         ? parseInt(year)         : null,
      departmentId: department_id? parseInt(department_id): null,
      employeeId:   employee_id  ? parseInt(employee_id)  : null,
      branchId:     branch_id    ? parseInt(branch_id)    : null,
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attendance/report?start_date=&end_date=&department_id=&employee_id=
// รายงานการลงเวลา — Admin ใช้
router.get('/report', requireAuth, async (req, res) => {
  try {
    const { start_date, end_date, department_id, employee_id, branch_id } = req.query;
    const data = await attendanceService.getAttendanceReport({
      startDate:    start_date    || null,
      endDate:      end_date      || null,
      departmentId: department_id ? parseInt(department_id) : null,
      employeeId:   employee_id   ? parseInt(employee_id)   : null,
      branchId:     branch_id     ? parseInt(branch_id)     : null,
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attendance/warnings?year=&month=&type=  — ดึง attendance warnings (admin)
router.get('/warnings', requireAuth, async (req, res) => {
  try {
    const lateAbsentService = require('../services/lateAbsentService');
    const { year, month, type, employee_id } = req.query;
    const data = await lateAbsentService.getWarnings({
      year:       year       ? parseInt(year)       : new Date().getFullYear(),
      month:      month      ? parseInt(month)      : new Date().getMonth() + 1,
      type:       type       || null,
      employeeId: employee_id ? parseInt(employee_id) : null,
    });
    res.json(data);
  } catch (err) {
    console.error('attendance warnings error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
