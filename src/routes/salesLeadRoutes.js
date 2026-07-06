'use strict';
const express = require('express');
const router  = express.Router();
const svc     = require('../services/salesBotService');
const { requireAuth } = require('../middleware/authMiddleware');

// GET /api/sales-leads?status=new&limit=50&offset=0
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, limit, offset } = req.query;
    const data = await svc.getLeads({
      status: status || undefined,
      limit:  parseInt(limit)  || 50,
      offset: parseInt(offset) || 0,
    });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/sales-leads/:id
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const result = await svc.updateLead(parseInt(req.params.id), req.body);
    if (!result) return res.status(404).json({ error: 'ไม่พบ lead' });
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE /api/sales-leads/conversation/:lineUserId  — รีเซ็ตประวัติสนทนา
router.delete('/conversation/:lineUserId', requireAuth, async (req, res) => {
  try {
    await svc.resetConversation(req.params.lineUserId);
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
