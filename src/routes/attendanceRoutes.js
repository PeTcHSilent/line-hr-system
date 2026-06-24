const express = require('express');
const router = express.Router();
const attendanceService = require('../services/attendanceService');
const employeeService   = require('../services/employeeService');
const { requireAuth }   = require('../middleware/authMiddleware');

// POST /api/attendance/checkin
router.post('/checkin', async (req, res) => {
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
router.post('/checkout', async (req, res) => {
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
router.get('/today', async (req, res) => {
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
router.get('/history', async (req, res) => {
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
