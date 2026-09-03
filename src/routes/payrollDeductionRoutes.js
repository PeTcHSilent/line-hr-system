'use strict';
/**
 * payrollDeductionRoutes.js
 *
 * GET    /api/payroll-deduction/:employeeId?year=&month=   — รายการหักของพนักงาน 1 คน ในเดือนนั้น
 * POST   /api/payroll-deduction                             — เพิ่มรายการหัก
 * DELETE /api/payroll-deduction/:id                         — ลบรายการหัก
 */

const express = require('express');
const router  = express.Router();
const svc     = require('../services/payrollDeductionService');
const audit   = require('../services/auditService');
const { requireAuth } = require('../middleware/authMiddleware');

// ── GET /api/payroll-deduction/:employeeId?year=&month=
router.get('/:employeeId', requireAuth, async (req, res) => {
  try {
    const employeeId = parseInt(req.params.employeeId);
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const rows  = await svc.listByEmployeeMonth(employeeId, year, month);
    const total = await svc.getMonthlyTotal(employeeId, year, month);
    res.json({ items: rows, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/payroll-deduction
router.post('/', requireAuth, async (req, res) => {
  try {
    const { employee_id, year, month, category, amount, note } = req.body;
    const result = await svc.add({
      employeeId: parseInt(employee_id),
      year:  parseInt(year),
      month: parseInt(month),
      category,
      amount,
      note,
      createdBy: req.admin?.id || null,
    });
    audit.log({
      actorName:   req.admin.display_name || req.admin.username,
      actorRole:   req.admin.role,
      action:      'payroll_deduction_add',
      targetType:  'employee',
      targetId:    parseInt(employee_id),
      description: 'เพิ่มรายการหักเงิน employee #' + employee_id + ' หมวด ' + category + ' จำนวน ' + amount + ' บาท (' + month + '/' + year + ')',
      meta:        { employee_id, year, month, category, amount, note },
    });
    res.json({ success: true, item: result });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── DELETE /api/payroll-deduction/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const removed = await svc.remove(parseInt(req.params.id));
    audit.log({
      actorName:   req.admin.display_name || req.admin.username,
      actorRole:   req.admin.role,
      action:      'payroll_deduction_remove',
      targetType:  'employee',
      targetId:    removed.employee_id,
      description: 'ลบรายการหักเงิน #' + req.params.id + ' employee #' + removed.employee_id,
      meta:        { id: parseInt(req.params.id), employee_id: removed.employee_id, year: removed.year, month: removed.month },
    });
    res.json({ success: true, removed });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
