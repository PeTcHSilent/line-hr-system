'use strict';
/**
 * documentRoutes.js
 *
 * GET    /api/document?employee_id=&doc_type=&status=(expiring|expired)
 * GET    /api/document/:id
 * POST   /api/document
 * PUT    /api/document/:id
 * DELETE /api/document/:id
 */

const express = require('express');
const router  = express.Router();
const svc     = require('../services/documentService');
const audit   = require('../services/auditService');
const { requireAuth } = require('../middleware/authMiddleware');

// ── GET /api/document
router.get('/', requireAuth, async (req, res) => {
  try {
    const { employee_id, doc_type, status } = req.query;
    const rows = await svc.list({
      employeeId: employee_id ? parseInt(employee_id) : undefined,
      docType: doc_type || undefined,
      status: status || undefined,
    });
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/document/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const row = await svc.getById(parseInt(req.params.id));
    if (!row) return res.status(404).json({ error: 'ไม่พบเอกสาร' });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/document
router.post('/', requireAuth, async (req, res) => {
  try {
    const { employee_id, doc_type, doc_number, issue_date, expiry_date, note } = req.body;
    const result = await svc.create({
      employeeId: parseInt(employee_id),
      docType: doc_type, docNumber: doc_number, issueDate: issue_date, expiryDate: expiry_date,
      note, createdBy: req.admin?.id || null,
    });
    audit.log({
      actorName: req.admin.display_name || req.admin.username, actorRole: req.admin.role,
      action: 'document_add', targetType: 'employee', targetId: parseInt(employee_id),
      description: `เพิ่มเอกสาร ${doc_type} employee #${employee_id} หมดอายุ ${expiry_date}`,
      meta: { employee_id, doc_type, doc_number, expiry_date },
    });
    res.json({ success: true, item: result });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── PUT /api/document/:id
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { doc_type, doc_number, issue_date, expiry_date, note } = req.body;
    const result = await svc.update(parseInt(req.params.id), {
      docType: doc_type, docNumber: doc_number, issueDate: issue_date, expiryDate: expiry_date, note,
    });
    audit.log({
      actorName: req.admin.display_name || req.admin.username, actorRole: req.admin.role,
      action: 'document_update', targetType: 'employee', targetId: result.employee_id,
      description: `แก้ไขเอกสาร #${req.params.id}`,
      meta: { id: parseInt(req.params.id), doc_type, doc_number, expiry_date },
    });
    res.json({ success: true, item: result });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── DELETE /api/document/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const removed = await svc.remove(parseInt(req.params.id));
    audit.log({
      actorName: req.admin.display_name || req.admin.username, actorRole: req.admin.role,
      action: 'document_remove', targetType: 'employee', targetId: removed.employee_id,
      description: `ลบเอกสาร #${req.params.id}`,
      meta: { id: parseInt(req.params.id) },
    });
    res.json({ success: true, removed });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
