/**
 * auditRoutes.js
 * GET /api/audit-logs — ดึง Audit Log สำหรับ Admin
 */
const express = require('express');
const router = express.Router();
const auditService = require('../services/auditService');
const { requireAuth } = require('../middleware/authMiddleware');

// GET /api/audit-logs?limit=100&offset=0&target_type=leave&action=approve_leave&start_date=2026-06-01&end_date=2026-06-30
router.get('/', requireAuth, async (req, res) => {
  try {
    const { limit = 100, offset = 0, target_type, action, start_date, end_date, actor_name } = req.query;
    const result = await auditService.getLogs({
      limit,
      offset,
      targetType:  target_type  || null,
      action:      action       || null,
      actorName:   actor_name   || null,
      startDate:   start_date   || null,
      endDate:     end_date     || null,
    });
    res.json(result);
  } catch (e) {
    console.error('auditRoutes GET error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
