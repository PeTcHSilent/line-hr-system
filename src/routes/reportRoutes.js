const express = require('express');
const router  = express.Router();
const reportService = require('../services/reportService');

// GET /api/report/monthly?year=2026&month=6&department_id=1
router.get('/monthly', async (req, res) => {
  try {
    const { year, month, department_id } = req.query;
    const data = await reportService.getMonthlySummary({
      year:         year         ? parseInt(year)         : null,
      month:        month        ? parseInt(month)        : null,
      departmentId: department_id? parseInt(department_id): null,
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/report/calendar?year=2026&month=6
router.get('/calendar', async (req, res) => {
  try {
    const { year, month } = req.query;
    const data = await reportService.getCalendarData({
      year:  year  ? parseInt(year)  : null,
      month: month ? parseInt(month) : null,
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
