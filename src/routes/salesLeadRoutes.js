'use strict';
const express = require('express');
const router  = express.Router();
const svc     = require('../services/salesBotService');
const db      = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

// ─────────────────────────────────────────────────────────────────
//  Sales Leads
// ─────────────────────────────────────────────────────────────────

// GET /api/sales-leads?status=new&lead_type=renewal&limit=50&offset=0
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, lead_type, limit, offset } = req.query;
    const data = await svc.getLeads({
      status:    status    || undefined,
      lead_type: lead_type || undefined,
      limit:     parseInt(limit)  || 50,
      offset:    parseInt(offset) || 0,
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

// ─────────────────────────────────────────────────────────────────
//  Sales Staff — จัดการกลุ่มพนักงาน (งานใหม่ / ต่ออายุ)
// ─────────────────────────────────────────────────────────────────

// GET /api/sales-leads/staff
// ดูรายชื่อพนักงานทั้งหมดพร้อม job_type
router.get('/staff', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, line_user_id, display_name,
              COALESCE(job_type, 'both') AS job_type,
              linked_at
       FROM admin_line_users
       ORDER BY display_name`
    );
    res.json({ staff: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/sales-leads/staff/:id
// เปลี่ยน job_type ของพนักงาน
router.patch('/staff/:id', requireAuth, async (req, res) => {
  try {
    const { job_type } = req.body;
    if (!['new_business', 'renewal', 'both'].includes(job_type)) {
      return res.status(400).json({ error: 'job_type ต้องเป็น new_business, renewal, หรือ both' });
    }
    const { rows } = await db.query(
      `UPDATE admin_line_users
       SET job_type = $1
       WHERE id = $2
       RETURNING id, line_user_id, display_name, job_type`,
      [job_type, parseInt(req.params.id)]
    );
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบพนักงาน' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
