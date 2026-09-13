'use strict';
/**
 * assetRoutes.js
 *
 * GET    /api/asset?category=&status=       — รายการทรัพย์สิน (พร้อมผู้ถือครองปัจจุบัน)
 * GET    /api/asset/:id                     — รายละเอียด + ประวัติเบิก/คืน
 * POST   /api/asset                         — เพิ่มทรัพย์สิน
 * PUT    /api/asset/:id                     — แก้ไขทรัพย์สิน
 * DELETE /api/asset/:id                     — ลบทรัพย์สิน (ต้องไม่มีเบิกใช้งานอยู่)
 * POST   /api/asset/:id/assign              — เบิกให้พนักงาน
 * POST   /api/asset/assignment/:id/return   — คืนทรัพย์สิน
 * GET    /api/asset/employee/:employeeId    — ประวัติเบิก/คืนของพนักงานคนหนึ่ง
 */

const express = require('express');
const router  = express.Router();
const svc     = require('../services/assetService');
const audit   = require('../services/auditService');
const { requireAuth } = require('../middleware/authMiddleware');

// ── GET /api/asset
router.get('/', requireAuth, async (req, res) => {
  try {
    const { category, status } = req.query;
    const rows = await svc.listAssets({ category: category || undefined, status: status || undefined });
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/asset/employee/:employeeId  (ต้องอยู่ก่อน /:id เพื่อไม่ชนกัน)
router.get('/employee/:employeeId', requireAuth, async (req, res) => {
  try {
    const rows = await svc.listAssignmentsByEmployee(parseInt(req.params.employeeId));
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/asset/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const row = await svc.getAssetById(parseInt(req.params.id));
    if (!row) return res.status(404).json({ error: 'ไม่พบทรัพย์สิน' });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/asset
router.post('/', requireAuth, async (req, res) => {
  try {
    const { asset_code, asset_name, category, serial_number, purchase_date, purchase_price, note } = req.body;
    const result = await svc.createAsset({
      assetCode: asset_code, assetName: asset_name, category,
      serialNumber: serial_number, purchaseDate: purchase_date, purchasePrice: purchase_price, note,
    });
    audit.log({
      actorName: req.admin.display_name || req.admin.username, actorRole: req.admin.role,
      action: 'asset_add', targetType: 'asset', targetId: result.id,
      description: `เพิ่มทรัพย์สิน ${asset_code} — ${asset_name}`,
      meta: { asset_code, asset_name, category },
    });
    res.json({ success: true, item: result });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── PUT /api/asset/:id
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { asset_name, category, serial_number, purchase_date, purchase_price, note, status } = req.body;
    const result = await svc.updateAsset(parseInt(req.params.id), {
      assetName: asset_name, category, serialNumber: serial_number,
      purchaseDate: purchase_date, purchasePrice: purchase_price, note, status,
    });
    audit.log({
      actorName: req.admin.display_name || req.admin.username, actorRole: req.admin.role,
      action: 'asset_update', targetType: 'asset', targetId: result.id,
      description: `แก้ไขทรัพย์สิน #${req.params.id}`,
      meta: { id: parseInt(req.params.id) },
    });
    res.json({ success: true, item: result });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── DELETE /api/asset/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const removed = await svc.removeAsset(parseInt(req.params.id));
    audit.log({
      actorName: req.admin.display_name || req.admin.username, actorRole: req.admin.role,
      action: 'asset_remove', targetType: 'asset', targetId: removed.id,
      description: `ลบทรัพย์สิน ${removed.asset_code}`,
      meta: { id: parseInt(req.params.id) },
    });
    res.json({ success: true, removed });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── POST /api/asset/:id/assign
router.post('/:id/assign', requireAuth, async (req, res) => {
  try {
    const { employee_id, assigned_date, note } = req.body;
    const result = await svc.assign({
      assetId: parseInt(req.params.id), employeeId: parseInt(employee_id),
      assignedDate: assigned_date, note, assignedBy: req.admin?.id || null,
    });
    audit.log({
      actorName: req.admin.display_name || req.admin.username, actorRole: req.admin.role,
      action: 'asset_assign', targetType: 'employee', targetId: parseInt(employee_id),
      description: `เบิกทรัพย์สิน #${req.params.id} ให้ employee #${employee_id}`,
      meta: { asset_id: parseInt(req.params.id), employee_id },
    });
    res.json({ success: true, item: result });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── POST /api/asset/assignment/:id/return
router.post('/assignment/:id/return', requireAuth, async (req, res) => {
  try {
    const { returned_date, return_condition, note } = req.body;
    const result = await svc.returnAsset({
      assignmentId: parseInt(req.params.id), returnedDate: returned_date,
      returnCondition: return_condition, note,
    });
    audit.log({
      actorName: req.admin.display_name || req.admin.username, actorRole: req.admin.role,
      action: 'asset_return', targetType: 'asset', targetId: result.asset.id,
      description: `คืนทรัพย์สิน ${result.asset.asset_code} สภาพ: ${return_condition}`,
      meta: { assignment_id: parseInt(req.params.id), return_condition },
    });
    res.json({ success: true, ...result });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
