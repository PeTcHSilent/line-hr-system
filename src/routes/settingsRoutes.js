const express = require('express');
const router  = express.Router();
const settingsService = require('../services/settingsService');
const audit   = require('../services/auditService');
const { requireAuth } = require('../middleware/authMiddleware');

// ── key ที่ห้ามส่งออกจาก API ไม่ว่ากรณีใด ────────────────────────
// company_settings เก็บ bcrypt hash ของรหัสผ่าน admin และ one-time code
// ผูก LINE ไว้ปนกับ setting ทั่วไป — getAll() เดิมคืนออกมาหมดทุก row
// ❗ อย่าใส่ pattern กว้างเกิน เช่น /_code$/ จะไปตัด setting ปกติอย่าง
//    branch_code / company_code ทิ้งโดยไม่ตั้งใจ
const SECRET_KEYS = ['admin_password', 'admin_link_code'];
const SECRET_PATTERN = /(password|passwd|secret|_token|api_key|apikey|private_key)/i;

function stripSecrets(rows) {
  return rows.filter(r =>
    !SECRET_KEYS.includes(r.key) && !SECRET_PATTERN.test(r.key)
  );
}

// GET /api/settings  — ดึงทั้งหมด (admin only, ตัด key ที่เป็นความลับออก)
router.get('/', requireAuth, async (req, res) => {
  try {
    res.json(stripSecrets(await settingsService.getAll()));
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
    audit.log({
      actorName:   req.admin.display_name || req.admin.username,
      actorRole:   req.admin.role,
      action:      'update_settings',
      targetType:  'settings',
      targetId:    null,
      description: 'แก้ไขการตั้งค่าระบบ: ' + Object.keys(updates).join(', '),
      meta:        updates,
    });
    res.json(stripSecrets(await settingsService.getAll()));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
