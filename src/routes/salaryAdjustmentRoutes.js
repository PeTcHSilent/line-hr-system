'use strict';
/**
 * salaryAdjustmentRoutes.js
 *
 * GET    /api/salary-adjustment              — ประวัติทั้งหมด (filter: employee_id, round_name, year)
 * GET    /api/salary-adjustment/rounds       — รายชื่อรอบที่มีอยู่
 * GET    /api/salary-adjustment/summary/:round — สรุปรอบ
 * POST   /api/salary-adjustment/one          — ขึ้นเงินเดือนรายคน
 * POST   /api/salary-adjustment/bulk         — ขึ้นเงินเดือน bulk
 * DELETE /api/salary-adjustment/:id/rollback — ยกเลิกรายการล่าสุด
 */

const express = require('express');
const router  = express.Router();
const svc     = require('../services/salaryAdjustmentService');
const { requireAuth } = require('../middleware/authMiddleware');

// ── GET /api/salary-adjustment
router.get('/', requireAuth, async (req, res) => {
  try {
    const { employee_id, round_name, year } = req.query;
    const rows = await svc.getAll({
      employeeId: employee_id ? parseInt(employee_id) : undefined,
      roundName:  round_name || undefined,
      year:       year       ? parseInt(year)        : undefined,
    });
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/salary-adjustment/rounds
router.get('/rounds', requireAuth, async (req, res) => {
  try {
    const rounds = await svc.getRounds();
    res.json(rounds);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/salary-adjustment/summary/:round
router.get('/summary/:round', requireAuth, async (req, res) => {
  try {
    const summary = await svc.getSummary(decodeURIComponent(req.params.round));
    res.json(summary);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/salary-adjustment/one
router.post('/one', requireAuth, async (req, res) => {
  try {
    const { employee_id, adjustment_type, adjustment_value, effective_date, reason, round_name } = req.body;
    if (!employee_id)      return res.status(400).json({ error: 'ต้องระบุ employee_id' });
    if (!adjustment_type)  return res.status(400).json({ error: 'ต้องระบุ adjustment_type' });
    if (adjustment_value === undefined) return res.status(400).json({ error: 'ต้องระบุ adjustment_value' });
    if (!effective_date)   return res.status(400).json({ error: 'ต้องระบุ effective_date' });

    const result = await svc.applyOne({
      employeeId:      parseInt(employee_id),
      adjustmentType:  adjustment_type,
      adjustmentValue: parseFloat(adjustment_value),
      effectiveDate:   effective_date,
      reason,
      roundName: round_name || null,
      appliedBy: req.admin?.id || null,
    });
    res.json({ success: true, result });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── POST /api/salary-adjustment/bulk
router.post('/bulk', requireAuth, async (req, res) => {
  try {
    const {
      adjustment_type, adjustment_value, effective_date,
      round_name, reason,
      department_id, branch_id, employee_ids,
    } = req.body;

    if (!adjustment_type)  return res.status(400).json({ error: 'ต้องระบุ adjustment_type' });
    if (adjustment_value === undefined) return res.status(400).json({ error: 'ต้องระบุ adjustment_value' });
    if (!effective_date)   return res.status(400).json({ error: 'ต้องระบุ effective_date' });

    const result = await svc.applyBulk({
      adjustmentType:  adjustment_type,
      adjustmentValue: parseFloat(adjustment_value),
      effectiveDate:   effective_date,
      roundName:       round_name || null,
      reason:          reason     || null,
      departmentId:    department_id ? parseInt(department_id) : null,
      branchId:        branch_id     ? parseInt(branch_id)     : null,
      employeeIds:     Array.isArray(employee_ids) ? employee_ids.map(Number) : undefined,
      appliedBy:       req.admin?.id || null,
    });
    res.json({ success: true, ...result });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── DELETE /api/salary-adjustment/:id/rollback
router.delete('/:id/rollback', requireAuth, async (req, res) => {
  try {
    const result = await svc.rollback(parseInt(req.params.id));
    res.json({ success: true, ...result });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
