const express = require('express');
const router = express.Router();
const holidayService = require('../services/holidayService');

// -----------------------------------------------
// GET /api/holidays?year=2026
// ดึงวันหยุดทั้งหมดของปีที่ระบุ (ค.ศ.)
// ถ้าไม่ระบุ year → ใช้ปีปัจจุบัน
// -----------------------------------------------
router.get('/', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const holidays = await holidayService.getHolidaysByYear(year);
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
// body: { date, name, year, is_substitute }
// -----------------------------------------------
router.post('/', async (req, res) => {
  try {
    const { date, name, year, is_substitute } = req.body;
    if (!date || !name || !year) {
      return res.status(400).json({ error: 'กรุณาระบุ date, name, year' });
    }
    const holiday = await holidayService.addHoliday({
      date,
      name,
      year: parseInt(year),
      isSubstitute: is_substitute || false,
    });
    res.status(201).json(holiday);
  } catch (err) {
    // Unique constraint violation
    if (err.code === '23505') {
      return res.status(409).json({ error: `วันที่ ${req.body.date} มีวันหยุดอยู่แล้ว` });
    }
    res.status(400).json({ error: err.message });
  }
});

// -----------------------------------------------
// PUT /api/holidays/:id
// แก้ไขวันหยุด (admin)
// body: { date?, name?, is_substitute? }
// -----------------------------------------------
router.put('/:id', async (req, res) => {
  try {
    const { date, name, is_substitute } = req.body;
    const holiday = await holidayService.updateHoliday(req.params.id, {
      date,
      name,
      isSubstitute: is_substitute,
    });
    res.json(holiday);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `วันที่ ${req.body.date} มีวันหยุดซ้ำ` });
    }
    res.status(400).json({ error: err.message });
  }
});

// -----------------------------------------------
// DELETE /api/holidays/:id
// ลบวันหยุด (admin)
// -----------------------------------------------
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await holidayService.deleteHoliday(req.params.id);
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
router.post('/copy', async (req, res) => {
  try {
    const { source_year, target_year } = req.body;
    if (!source_year || !target_year) {
      return res.status(400).json({ error: 'กรุณาระบุ source_year และ target_year' });
    }
    const copied = await holidayService.copyHolidaysToYear(
      parseInt(source_year),
      parseInt(target_year)
    );
    res.json({
      success: true,
      message: `คัดลอกวันหยุดจาก พ.ศ. ${source_year + 543} → พ.ศ. ${target_year + 543} จำนวน ${copied.length} วัน`,
      note: 'วันหยุดที่อิงปฏิทินจันทรคติ (มาฆบูชา วิสาขบูชา ฯลฯ) ควรแก้ไขวันที่ให้ถูกต้องด้วยตนเอง',
      copied,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
