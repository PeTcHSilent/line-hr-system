const express = require('express');
const router  = express.Router();
const otService = require('../services/otService');
const employeeService = require('../services/employeeService');
const flexMessages = require('../utils/flexMessages');
const line = require('@line/bot-sdk');
const { requireAuth } = require('../middleware/authMiddleware');
const audit = require('../services/auditService');
const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
});

// helper: push แจ้งหัวหน้า/HR/Admin เมื่อมี OT ใหม่
async function notifyApprovers(ot, employee) {
  try {
    const db = require('../db');
    const targets = [];

    // 1. หัวหน้า (ถ้ามี)
    if (employee.manager_id) {
      const manager = await employeeService.findById(employee.manager_id);
      if (manager && manager.line_user_id) targets.push(manager.line_user_id);
    }

    // 2. Admin LINE ทุกคน (เสมอ — ไม่ขึ้นกับว่ามีหัวหน้าหรือไม่)
    const adminRows = await db.query('SELECT line_user_id FROM admin_line_users');
    adminRows.rows.forEach(r => {
      if (r.line_user_id && !targets.includes(r.line_user_id)) targets.push(r.line_user_id);
    });

    // 3. fallback: ถ้ายังไม่มีใครเลย → หา hr/admin จาก employees
    if (targets.length === 0) {
      const admins = await employeeService.findByRole(['hr', 'admin']);
      admins.forEach(a => { if (a.line_user_id) targets.push(a.line_user_id); });
    }

    const msg = flexMessages.otApprovalRequest(ot, employee);
    await Promise.all(targets.map(lineId =>
      client.pushMessage({ to: lineId, messages: [msg] }).catch(() => {})
    ));
  } catch (e) { console.error('notifyApprovers error:', e.message); }
}

// GET /api/ot
router.get('/', async (req, res) => {
  try {
    const { year, month, status, department_id, employee_id, branch_id } = req.query;
    const data = await otService.getAllOT({
      year:         year         ? parseInt(year)         : null,
      month:        month        ? parseInt(month)        : null,
      status:       status       || null,
      departmentId: department_id? parseInt(department_id): null,
      employeeId:   employee_id  ? parseInt(employee_id)  : null,
      branchId:     branch_id    ? parseInt(branch_id)    : null,
    });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/ot/summary
router.get('/summary', async (req, res) => {
  try {
    const { year, month } = req.query;
    const data = await otService.getOTSummary({
      year:  year  ? parseInt(year)  : null,
      month: month ? parseInt(month) : null,
    });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/ot/report?year=&month=&employee_id=  — สรุป OT รายบุคคล (Admin)
router.get('/report', async (req, res) => {
  try {
    const { year, month, employee_id } = req.query;
    const data = await otService.getOTReportPerEmployee({
      year:       year       ? parseInt(year)       : null,
      month:      month      ? parseInt(month)      : null,
      employeeId: employee_id? parseInt(employee_id): null,
    });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/ot/daily-records?year=&month=&employee_id=  — OT รายวัน พร้อมค่า OT ต่อ record
router.get('/daily-records', async (req, res) => {
  try {
    const { year, month, employee_id } = req.query;
    if (!employee_id) return res.status(400).json({ error: 'ต้องระบุ employee_id' });
    const data = await otService.getOTDailyRecords({
      year:       year  ? parseInt(year)  : null,
      month:      month ? parseInt(month) : null,
      employeeId: parseInt(employee_id),
    });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/ot/monthly-breakdown?year=&employee_id=  — OT ราย-เดือนสำหรับพนักงาน 1 คน
router.get('/monthly-breakdown', async (req, res) => {
  try {
    const { year, employee_id } = req.query;
    if (!employee_id) return res.status(400).json({ error: 'ต้องระบุ employee_id' });
    const data = await otService.getOTMonthlyBreakdown({
      year:       year ? parseInt(year) : null,
      employeeId: parseInt(employee_id),
    });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/ot/mine - OT of a specific employee (LIFF Profile)
router.get('/mine', async (req, res) => {
  try {
    const { line_user_id, year } = req.query;
    if (!line_user_id) return res.status(400).json({ error: 'ต้องระบุ line_user_id' });
    const emp = await employeeService.findByLineId(line_user_id);
    if (!emp) return res.status(404).json({ error: 'ไม่พบพนักงาน' });

    const db = require('../db');
    const y = year ? parseInt(year) : null;
    const result = await db.query(
      'SELECT id, ot_date, ot_type, start_time, end_time, total_hours, status, reason, created_at ' +
      'FROM ot_records ' +
      'WHERE employee_id = $1 ' +
      'AND ($2::int IS NULL OR EXTRACT(YEAR FROM ot_date) = $2) ' +
      'ORDER BY ot_date DESC LIMIT 20',
      [emp.id, y]
    );
    const rows = result.rows;
    const approved = rows.filter(r => r.status === 'approved');
    const totalHours = approved.reduce((s, r) => s + parseFloat(r.total_hours || 0), 0);
    res.json({
      employee_id: emp.id,
      records: rows,
      summary: {
        total: rows.length,
        approved: approved.length,
        pending: rows.filter(r => r.status === 'pending').length,
        rejected: rows.filter(r => r.status === 'rejected').length,
        total_approved_hours: Math.round(totalHours * 10) / 10,
      },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/ot
router.post('/', async (req, res) => {
  try {
    const { line_user_id, employee_id, ot_date, start_time, end_time, reason } = req.body;
    let empId = employee_id;
    if (!empId && line_user_id) {
      const emp = await employeeService.findByLineId(line_user_id);
      if (!emp) return res.status(404).json({ error: 'ไม่พบพนักงาน' });
      empId = emp.id;
    }
    if (!empId) return res.status(400).json({ error: 'ต้องระบุ employee_id หรือ line_user_id' });
    // ot_type ถูก detect อัตโนมัติใน otService.createOT()
    const created = await otService.createOT({ employeeId: empId, otDate: ot_date, startTime: start_time, endTime: end_time, reason });
    const emp = await employeeService.findById(empId);
    if (emp) notifyApprovers(created, emp);
    res.status(201).json({ success: true, ot: created, message: 'บันทึก OT สำเร็จ' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PATCH /api/ot/:id/approve
router.patch('/:id/approve', requireAuth, async (req, res) => {
  try {
    const ot = await otService.updateOTStatus(parseInt(req.params.id), 'approved', req.body.approved_by_id);
    if (ot && ot.employee_line_id) {
      client.pushMessage({ to: ot.employee_line_id, messages: [flexMessages.otStatusUpdate(ot, 'approved')] }).catch(() => {});
    }
    audit.log({
      actorName:   req.admin.display_name || req.admin.username,
      actorRole:   req.admin.role,
      action:      'approve_ot',
      targetType:  'ot',
      targetId:    ot?.id,
      description: `อนุมัติ OT: ${ot?.employee_name || ''} — ${ot?.total_hours || ''} ชม. (${ot?.ot_date || ''})`,
      meta:        { employee_name: ot?.employee_name, ot_date: ot?.ot_date, total_hours: ot?.total_hours },
    });
    res.json({ success: true, ot, message: 'อนุมัติ OT สำเร็จ' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PATCH /api/ot/:id/reject
router.patch('/:id/reject', requireAuth, async (req, res) => {
  try {
    const ot = await otService.updateOTStatus(parseInt(req.params.id), 'rejected', req.body.approved_by_id);
    if (ot && ot.employee_line_id) {
      client.pushMessage({ to: ot.employee_line_id, messages: [flexMessages.otStatusUpdate(ot, 'rejected')] }).catch(() => {});
    }
    audit.log({
      actorName:   req.admin.display_name || req.admin.username,
      actorRole:   req.admin.role,
      action:      'reject_ot',
      targetType:  'ot',
      targetId:    ot?.id,
      description: `ไม่อนุมัติ OT: ${ot?.employee_name || ''} — ${ot?.total_hours || ''} ชม. (${ot?.ot_date || ''})`,
      meta:        { employee_name: ot?.employee_name, ot_date: ot?.ot_date, total_hours: ot?.total_hours },
    });
    res.json({ success: true, ot, message: 'ปฏิเสธ OT สำเร็จ' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PATCH /api/ot/:id  — Admin แก้ไขรายละเอียด OT record
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { ot_date, start_time, end_time, total_hours, ot_type, reason } = req.body;
    const updated = await otService.updateOTRecord(parseInt(req.params.id), {
      otDate:     ot_date,
      startTime:  start_time,
      endTime:    end_time,
      totalHours: total_hours != null ? parseFloat(total_hours) : undefined,
      otType:     ot_type,
      reason,
    });
    res.json({ success: true, ot: updated, message: 'แก้ไข OT สำเร็จ' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE /api/ot/:id
router.delete('/:id', async (req, res) => {
  try {
    const employeeId = req.query.employee_id ? parseInt(req.query.employee_id) : null;
    if (!employeeId) return res.status(400).json({ error: 'ต้องระบุ employee_id' });
    const result = await otService.deleteOT(parseInt(req.params.id), employeeId);
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
