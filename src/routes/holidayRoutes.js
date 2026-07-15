const express = require('express');
const router = express.Router();
const holidayService = require('../services/holidayService');
const audit   = require('../services/auditService');
const { requireAuth } = require('../middleware/authMiddleware');

// -----------------------------------------------
// GET /api/holidays?year=2026&type=company
// ดึงวันหยุดทั้งหมดของปีที่ระบุ (ค.ศ.)
// ?type=public|company — กรองตามประเภท (ถ้าไม่ระบุ = ทุกประเภท)
// ถ้าไม่ระบุ year → ใช้ปีปัจจุบัน
// -----------------------------------------------
router.get('/', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const type = ['public', 'company'].includes(req.query.type) ? req.query.type : undefined;
    const holidays = await holidayService.getHolidaysByYear(year, type);
    res.json({
      year,
      be_year: year + 543,
      total: holidays.length,
      holidays,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------
// GET /api/holidays/years
// ดึงรายชื่อปีที่มีข้อมูล
// -----------------------------------------------
router.get('/years', async (req, res) => {
  try {
    const years = await holidayService.getAvailableYears();
    res.json(years);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------
// POST /api/holidays
// เพิ่มวันหยุดใหม่ (admin)
// body: { date, name, year, is_substitute, holiday_type }
//   holiday_type: 'public' (ราชการ, default) | 'company' (บริษัทกำหนด)
// -----------------------------------------------
router.post('/', requireAuth, async (req, res) => {
  try {
    const { date, name, year, is_substitute, holiday_type } = req.body;
    if (!date || !name || !year) {
      return res.status(400).json({ error: 'กรุณาระบุ date, name, year' });
    }
    const holiday = await holidayService.addHoliday({
      date,
      name,
      year: parseInt(year),
      isSubstitute: is_substitute || false,
      holidayType: holiday_type || 'public',
    });
    audit.log({
      actorName:   req.admin.display_name || req.admin.username,
      actorRole:   req.admin.role,
      action:      'create_holiday',
      targetType:  'holiday',
      targetId:    holiday.id,
      description: 'เพิ่มวันหยุด: ' + holiday.name + ' (' + holiday.date + ') [' + (holiday.holiday_type || 'public') + ']',
      meta:        { date: holiday.date, name: holiday.name, year: holiday.year, holiday_type: holiday.holiday_type },
    });
    res.status(201).json(holiday);
  } catch (err) {
    // Unique constraint violation
    if (err.code === '23505') {
      return res.status(409).json({ error: 'วันที่ ' + req.body.date + ' มีวันหยุดอยู่แล้ว' });
    }
    res.status(400).json({ error: err.message });
  }
});

// -----------------------------------------------
// PUT /api/holidays/:id
// แก้ไขวันหยุด (admin)
// body: { date?, name?, is_substitute?, holiday_type? }
// -----------------------------------------------
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { date, name, is_substitute, holiday_type } = req.body;
    const holiday = await holidayService.updateHoliday(req.params.id, {
      date,
      name,
      isSubstitute: is_substitute,
      holidayType: holiday_type,
    });
    audit.log({
      actorName:   req.admin.display_name || req.admin.username,
      actorRole:   req.admin.role,
      action:      'update_holiday',
      targetType:  'holiday',
      targetId:    holiday.id,
      description: 'แก้ไขวันหยุด: ' + holiday.name + ' (' + holiday.date + ')',
      meta:        { date: holiday.date, name: holiday.name },
    });
    res.json(holiday);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'วันที่ ' + req.body.date + ' มีวันหยุดซ้ำ' });
    }
    res.status(400).json({ error: err.message });
  }
});

// -----------------------------------------------
// DELETE /api/holidays/:id
// ลบวันหยุด (admin)
// -----------------------------------------------
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const deleted = await holidayService.deleteHoliday(req.params.id);
    audit.log({
      actorName:   req.admin.display_name || req.admin.username,
      actorRole:   req.admin.role,
      action:      'delete_holiday',
      targetType:  'holiday',
      targetId:    parseInt(req.params.id),
      description: 'ลบวันหยุด: ' + (deleted && deleted.name || req.params.id),
      meta:        { holiday_id: parseInt(req.params.id), deleted_name: deleted && deleted.name },
    });
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// -----------------------------------------------
// POST /api/holidays/copy
// คัดลอกวันหยุดจากปีหนึ่งไปยังปีใหม่ (admin)
// body: { source_year: 2026, target_year: 2027 }
// -----------------------------------------------
router.post('/copy', requireAuth, async (req, res) => {
  try {
    const { source_year, target_year } = req.body;
    if (!source_year || !target_year) {
      return res.status(400).json({ error: 'กรุณาระบุ source_year และ target_year' });
    }
    const copied = await holidayService.copyHolidaysToYear(
      parseInt(source_year),
      parseInt(target_year)
    );
    audit.log({
      actorName:   req.admin.display_name || req.admin.username,
      actorRole:   req.admin.role,
      action:      'copy_holidays',
      targetType:  'holiday',
      targetId:    null,
      description: 'คัดลอกวันหยุด ' + source_year + ' -> ' + target_year + ' จำนวน ' + copied.length + ' วัน',
      meta:        { source_year, target_year, count: copied.length },
    });
    res.json({
      success: true,
      message: 'คัดลอกวันหยุดจาก พ.ศ. ' + (source_year + 543) + ' -> พ.ศ. ' + (target_year + 543) + ' จำนวน ' + copied.length + ' วัน',
      note: 'วันหยุดที่อิงปฏิทินจันทรคติ ควรแก้ไขวันที่ให้ถูกต้องด้วยตนเอง',
      copied,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
