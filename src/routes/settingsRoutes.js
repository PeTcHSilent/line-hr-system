const express = require('express');
const router  = express.Router();
const settingsService = require('../services/settingsService');
const { requireAuth } = require('../middleware/authMiddleware');

// GET /api/settings  — ดึงทั้งหมด
router.get('/', async (req, res) => {
  try {
    res.json(await settingsService.getAll());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/settings/work-schedule  — ดึง schedule (ใช้ใน LIFF)
router.get('/work-schedule', async (req, res) => {
  try {
    res.json(await settingsService.getWorkSchedule());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/settings/check-ot-type?date=YYYY-MM-DD
// ใช้ใน LIFF ot.html เพื่อแสดง label อัตโนมัติ
router.get('/check-ot-type', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'ต้องระบุ date' });
    const otType    = await settingsService.getOTType(date);
    const rates     = await settingsService.getOTRates();
    const multiplier = rates[otType] ?? 1.5;
    res.json({ date, ot_type: otType, multiplier, rates });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/settings  — อัปเดต (admin only)
router.put('/', requireAuth, async (req, res) => {
  try {
    const updates = req.body; // { key: value, ... }
    for (const [key, value] of Object.entries(updates)) {
      await settingsService.set(key, value);
    }
    res.json(await settingsService.getAll());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
