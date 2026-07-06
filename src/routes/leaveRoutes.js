const express = require('express');
const router = express.Router();
const leaveService = require('../services/leaveService');
const employeeService = require('../services/employeeService');
const line = require('@line/bot-sdk');
const flexMessages = require('../utils/flexMessages');
const { requireAuth } = require('../middleware/authMiddleware');
const audit = require('../services/auditService');

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

// POST /api/leave - ส่งคำขอลา (จาก LIFF)
router.post('/', async (req, res) => {
  try {
    const lineUserId     = req.body.line_user_id     || req.body.lineUserId;
    const leaveTypeId    = req.body.leave_type_id    || req.body.leaveTypeId;
    const startDate      = req.body.start_date       || req.body.startDate;
    const endDate        = req.body.end_date         || req.body.endDate;
    const reason         = req.body.reason || '';
    const isHalfDay      = req.body.is_half_day === true || req.body.is_half_day === 'true';
    const halfDayPeriod  = req.body.half_day_period  || null;  // 'morning' | 'afternoon'

    if (!lineUserId)  return res.status(400).json({ error: 'ไม่พบ LINE User ID' });
    if (!leaveTypeId) return res.status(400).json({ error: 'กรุณาเลือกประเภทการลา' });
    if (!startDate || !endDate) return res.status(400).json({ error: 'กรุณาระบุวันที่' });

    const employee = await employeeService.findByLineId(lineUserId);
    if (!employee) return res.status(404).json({ error: 'ไม่พบข้อมูลพนักงาน กรุณาลงทะเบียนก่อน' });

    // สร้างคำขอลา (มี gender validation อยู่ใน service)
    const leave = await leaveService.createLeaveRequest({
      employeeId: employee.id,
      leaveTypeId,
      startDate,
      endDate,
      reason,
      employeeSex: employee.sex,
      isHalfDay,
      halfDayPeriod,
    });

    // แจ้งหัวหน้า + Admin ผ่าน LINE (ทุกครั้ง)
    const targets = [];

    // 1. หัวหน้าของพนักงาน (ถ้ามี)
    if (employee.manager_id) {
      const manager = await employeeService.findById(employee.manager_id);
      if (manager?.line_user_id) targets.push(manager.line_user_id);
    }

    // 2. Admin LINE ทุกคนที่ผูกไว้ (แจ้งเสมอ ไม่ว่าจะมีหัวหน้าหรือไม่)
    const db = require('../db');
    const adminRows = await db.query('SELECT line_user_id FROM admin_line_users');
    adminRows.rows.forEach(r => {
      if (r.line_user_id && !targets.includes(r.line_user_id)) targets.push(r.line_user_id);
    });

    // 3. fallback: ถ้ายังไม่มีใครเลย → หา HR/Admin จากตารางพนักงาน
    if (targets.length === 0) {
      const admins = await employeeService.findByRole(['hr', 'admin']);
      admins.forEach(a => { if (a.line_user_id) targets.push(a.line_user_id); });
    }
    const msg = flexMessages.leaveApprovalRequest(leave, employee);
    await Promise.all(targets.map(lineId =>
      client.pushMessage({ to: lineId, messages: [msg] }).catch(() => {})
    ));

    res.json({ success: true, id: leave.id, leave });
  } catch (err) {
    console.error('Leave POST error:', err);
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
// LEAVE TYPES (Admin)
// ============================================================

// GET /api/leave/types — ดึงทุกประเภทลา (ไม่ filter gender)
router.get('/types', async (req, res) => {
  try {
    const db = require('../db');
    const { rows } = await db.query(
      `SELECT id, name, max_days, gender_restriction, is_paid
       FROM leave_types ORDER BY id`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/leave/types — เพิ่มประเภทลา
router.post('/types', requireAuth, async (req, res) => {
  try {
    const db = require('../db');
    const { name, max_days, gender_restriction, is_paid } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'กรุณาระบุชื่อประเภทลา' });
    const { rows } = await db.query(
      `INSERT INTO leave_types (name, max_days, gender_restriction, is_paid)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name.trim(), max_days || null, gender_restriction || null, is_paid !== false]
    );
    res.status(201).json({ success: true, leave_type: rows[0] });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PUT /api/leave/types/:id — แก้ไขประเภทลา
router.put('/types/:id', requireAuth, async (req, res) => {
  try {
    const db = require('../db');
    const { name, max_days, gender_restriction, is_paid } = req.body;
    const { rows } = await db.query(
      `UPDATE leave_types SET name=$1, max_days=$2, gender_restriction=$3, is_paid=$4
       WHERE id=$5 RETURNING *`,
      [name, max_days || null, gender_restriction || null, is_paid !== false, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบประเภทลา' });
    res.json({ success: true, leave_type: rows[0] });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE /api/leave/types/:id — ลบประเภทลา (safe: ห้ามถ้ามีคำขอลาอ้างถึง)
router.delete('/types/:id', requireAuth, async (req, res) => {
  try {
    const db = require('../db');
    const check = await db.query(
      `SELECT COUNT(*) AS cnt FROM leave_requests WHERE leave_type_id=$1`, [req.params.id]
    );
    if (parseInt(check.rows[0].cnt) > 0)
      return res.status(400).json({ error: 'ไม่สามารถลบได้ เพราะมีคำขอลาที่อ้างถึงประเภทนี้' });
    await db.query('DELETE FROM leave_types WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ============================================================
// APPROVE / REJECT  (Admin)
// ============================================================

// PATCH /api/leave/:id/approve
router.patch('/:id/approve', requireAuth, async (req, res) => {
  try {
    const { approved_by_id } = req.body;  // employee id ของ admin/hr ที่อนุมัติ (optional)
    const result = await leaveService.updateLeaveStatus(
      parseInt(req.params.id), 'approved', approved_by_id || null
    );
    if (!result) return res.status(404).json({ error: 'ไม่พบคำขอลา' });

    // Audit log
    audit.log({
      actorName:   req.admin.display_name || req.admin.username,
      actorRole:   req.admin.role,
      action:      'approve_leave',
      targetType:  'leave',
      targetId:    result.id,
      description: `อนุมัติการลา: ${result.employee_name || ''} — ${result.leave_type_name || ''} (${result.start_date ? result.start_date.toISOString?.().slice(0,10) || result.start_date : ''})`,
      meta:        { employee_name: result.employee_name, leave_type: result.leave_type_name, start_date: result.start_date, days_taken: result.days_taken },
    });

    // แจ้งพนักงานผ่าน LINE
    if (result.employee_line_id) {
      const flexMessages = require('../utils/flexMessages');
      await client.pushMessage({
        to: result.employee_line_id,
        messages: [flexMessages.leaveStatusUpdate(result, 'approved')]
      }).catch(e => console.error('Push approved error:', e.message));
    }
    res.json({ success: true, leave: result, message: 'อนุมัติการลาสำเร็จ' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PATCH /api/leave/:id/reject
router.patch('/:id/reject', requireAuth, async (req, res) => {
  try {
    const { approved_by_id, reject_reason } = req.body;
    const result = await leaveService.updateLeaveStatus(
      parseInt(req.params.id), 'rejected', approved_by_id || null, reject_reason || 'ไม่อนุมัติโดย HR'
    );
    if (!result) return res.status(404).json({ error: 'ไม่พบคำขอลา' });

    // Audit log
    audit.log({
      actorName:   req.admin.display_name || req.admin.username,
      actorRole:   req.admin.role,
      action:      'reject_leave',
      targetType:  'leave',
      targetId:    result.id,
      description: `ไม่อนุมัติการลา: ${result.employee_name || ''} — ${result.leave_type_name || ''} เหตุผล: ${reject_reason || ''}`,
      meta:        { employee_name: result.employee_name, leave_type: result.leave_type_name, reject_reason },
    });

    if (result.employee_line_id) {
      const flexMessages = require('../utils/flexMessages');
      await client.pushMessage({
        to: result.employee_line_id,
        messages: [flexMessages.leaveStatusUpdate(result, 'rejected')]
      }).catch(e => console.error('Push rejected error:', e.message));
    }
    res.json({ success: true, leave: result, message: 'ปฏิเสธการลาสำเร็จ' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// GET /api/leave/calendar?year=2024&month=6
router.get('/calendar', async (req, res) => {
  const { year, month } = req.query;
  const data = await leaveService.getLeaveCalendar(year, month);
  res.json(data);
});

// GET /api/leave/history?line_user_id=xxx&year=2026&status=approved
// ประวัติการลาของพนักงานคนนั้น (LIFF ใช้)
router.get('/history', async (req, res) => {
  try {
    const { line_user_id, year, status } = req.query;
    if (!line_user_id) return res.status(400).json({ error: 'ต้องระบุ line_user_id' });

    const employee = await employeeService.findByLineId(line_user_id);
    if (!employee) return res.status(404).json({ error: 'ไม่พบข้อมูลพนักงาน' });

    const history = await leaveService.getLeaveHistory(
      employee.id,
      year ? parseInt(year) : null,
      status || null
    );
    res.json({ employee_name: employee.name, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leave/all?year=2026&month=6&department_id=1&status=pending
// ประวัติการลาทั้งหมด (Admin ใช้)
router.get('/all', async (req, res) => {
  try {
    const { year, month, department_id, status, employee_id, branch_id } = req.query;
    const data = await leaveService.getAllLeaveHistory({
      year:         year         ? parseInt(year)         : null,
      month:        month        ? parseInt(month)        : null,
      departmentId: department_id? parseInt(department_id): null,
      status:       status       || null,
      employeeId:   employee_id  ? parseInt(employee_id)  : null,
      branchId:     branch_id    ? parseInt(branch_id)    : null,
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/leave/:id/cancel — พนักงานยกเลิกใบลาที่ pending (LIFF ใช้)
router.patch('/:id/cancel', async (req, res) => {
  try {
    const { line_user_id } = req.body;
    if (!line_user_id) return res.status(400).json({ error: 'ต้องระบุ line_user_id' });
    const employee = await employeeService.findByLineId(line_user_id);
    if (!employee) return res.status(404).json({ error: 'ไม่พบพนักงาน' });
    const result = await leaveService.cancelLeaveRequest(req.params.id, employee.id);
    res.json({ success: true, ...result });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE /api/leave/:id — ยกเลิกคำขอลา (เฉพาะ pending)
router.delete('/:id', async (req, res) => {
  try {
    const { line_user_id } = req.body;
    if (!line_user_id) return res.status(400).json({ error: 'ต้องระบุ line_user_id' });

    const employee = await employeeService.findByLineId(line_user_id);
    if (!employee) return res.status(404).json({ error: 'ไม่พบข้อมูลพนักงาน' });

    const result = await leaveService.cancelLeaveRequest(req.params.id, employee.id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════
// Leave Carryover API
// ══════════════════════════════════════════════════════════════════

// helper: สร้าง table ถ้ายังไม่มี
async function ensureCarryoverTable() {
  const db = require('../db');
  await db.query(`
    CREATE TABLE IF NOT EXISTS leave_carryover_log (
      id              SERIAL PRIMARY KEY,
      employee_id     INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      from_year       INT NOT NULL,
      to_year         INT NOT NULL,
      carried_days    NUMERIC(5,1) NOT NULL DEFAULT 0,
      used_days       NUMERIC(5,1) NOT NULL DEFAULT 0,
      quota_days      INT NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_carryover_unique
      ON leave_carryover_log(employee_id, from_year, to_year)
  `);
}

// GET /api/leave/carryover/log?year=&employee_id=  — ดูประวัติ carryover (Admin)
router.get('/carryover/log', async (req, res) => {
  try {
    const db = require('../db');
    await ensureCarryoverTable();
    const { year, employee_id } = req.query;
    const { rows } = await db.query(
      `SELECT cl.*, e.name AS employee_name, e.employee_code, d.name AS department_name
       FROM leave_carryover_log cl
       JOIN employees e ON e.id = cl.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE ($1::int IS NULL OR cl.from_year = $1)
         AND ($2::int IS NULL OR cl.employee_id = $2)
       ORDER BY cl.from_year DESC, e.name`,
      [year ? parseInt(year) : null, employee_id ? parseInt(employee_id) : null]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/leave/carryover/run  — รัน carryover ปีที่แล้ว → ปีนี้ (Admin)
// body: { from_year?, max_carryover_days? }
router.post('/carryover/run', async (req, res) => {
  try {
    const db = require('../db');
    await ensureCarryoverTable();

    const currentYear   = new Date().getFullYear();
    const fromYear      = parseInt(req.body.from_year) || currentYear - 1;
    const toYear        = fromYear + 1;
    const maxCarry      = parseInt(req.body.max_carryover_days) || 5; // default ไม่เกิน 5 วัน

    // ดึงพนักงาน active ทุกคน
    const { rows: emps } = await db.query(
      `SELECT id, name, employee_code, annual_leave_quota FROM employees WHERE is_active = TRUE`
    );

    const results = [];

    for (const emp of emps) {
      const quota = parseInt(emp.annual_leave_quota || 10);

      // วันลาพักร้อนที่ใช้ไปใน fromYear (approved เท่านั้น)
      const usedRes = await db.query(
        `SELECT COALESCE(SUM(lr.total_days), 0) AS used_days
         FROM leave_requests lr
         JOIN leave_types lt ON lt.id = lr.leave_type_id
         WHERE lr.employee_id = $1
           AND lr.status = 'approved'
           AND lt.name ILIKE '%พักร้อน%'
           AND EXTRACT(YEAR FROM lr.start_date) = $2`,
        [emp.id, fromYear]
      );

      // รวม carryover จากปีก่อนหน้าที่ยังไม่ได้ใช้ (ถ้ามี)
      const prevCarryRes = await db.query(
        `SELECT COALESCE(SUM(carried_days), 0) AS prev_carry
         FROM leave_carryover_log
         WHERE employee_id = $1 AND to_year = $2`,
        [emp.id, fromYear]
      );

      const usedDays  = parseFloat(usedRes.rows[0].used_days || 0);
      const prevCarry = parseFloat(prevCarryRes.rows[0].prev_carry || 0);
      const totalQuota = quota + prevCarry;
      const remaining = Math.max(0, totalQuota - usedDays);
      const carriedDays = Math.min(remaining, maxCarry);

      // upsert
      await db.query(
        `INSERT INTO leave_carryover_log
           (employee_id, from_year, to_year, carried_days, used_days, quota_days)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (employee_id, from_year, to_year)
         DO UPDATE SET carried_days=$4, used_days=$5, quota_days=$6, created_at=NOW()`,
        [emp.id, fromYear, toYear, carriedDays, usedDays, quota]
      );

      results.push({
        employee_id: emp.id, name: emp.name, employee_code: emp.employee_code,
        quota_days: quota, used_days: usedDays, remaining, carried_days: carriedDays
      });
    }

    res.json({
      success: true,
      from_year: fromYear, to_year: toYear,
      max_carryover_days: maxCarry,
      processed: results.length,
      results
    });
  } catch (err) {
    console.error('carryover run error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leave/balance?line_user_id= (LIFF — รวม carryover)
router.get('/balance', async (req, res) => {
  try {
    const { line_user_id } = req.query;
    if (!line_user_id) return res.status(400).json({ error: 'ต้องระบุ line_user_id' });

    const employee = await employeeService.findByLineId(line_user_id);
    if (!employee) return res.status(404).json({ error: 'ไม่พบพนักงาน' });

    const db = require('../db');
    const currentYear = new Date().getFullYear();

    // วันลาพักร้อนที่ใช้ไปปีนี้
    const usedRes = await db.query(
      `SELECT COALESCE(SUM(lr.total_days), 0) AS used
       FROM leave_requests lr
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       WHERE lr.employee_id = $1
         AND lr.status = 'approved'
         AND lt.name ILIKE '%พักร้อน%'
         AND EXTRACT(YEAR FROM lr.start_date) = $2`,
      [employee.id, currentYear]
    );

    // carryover จากปีที่แล้ว
    const carryRes = await db.query(
      `SELECT COALESCE(SUM(carried_days), 0) AS carry
       FROM leave_carryover_log
       WHERE employee_id = $1 AND to_year = $2`,
      [employee.id, currentYear]
    );

    const quota    = parseInt(employee.annual_leave_quota || 10);
    const carryover = parseFloat(carryRes.rows[0].carry || 0);
    const used      = parseFloat(usedRes.rows[0].used || 0);
    const total     = quota + carryover;
    const remaining = Math.max(0, total - used);

    res.json({
      employee_id: employee.id,
      year: currentYear,
      annual_quota: quota,
      carryover_days: carryover,
      total_quota: total,
      used_days: used,
      remaining_days: remaining,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
