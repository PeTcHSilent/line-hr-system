const express = require('express');
const router  = express.Router();
const deptSvc = require('../services/departmentService');

// GET /api/department?include_inactive=1
router.get('/', async (req, res) => {
  try {
    const includeInactive = req.query.include_inactive === '1';
    const data = await deptSvc.getAll({ includeInactive });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/department/:id  — รายละเอียด + รายชื่อพนักงาน
router.get('/:id', async (req, res) => {
  try {
    const dept = await deptSvc.getById(parseInt(req.params.id));
    if (!dept) return res.status(404).json({ error: 'ไม่พบแผนก' });
    res.json(dept);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/department  — สร้างแผนกใหม่
router.post('/', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'กรุณาระบุชื่อแผนก' });
    const dept = await deptSvc.create({ name, description });
    res.status(201).json({ success: true, department: dept, message: `สร้างแผนก "${dept.name}" สำเร็จ` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/department/:id  — แก้ไขแผนก
router.put('/:id', async (req, res) => {
  try {
    const { name, description } = req.body;
    const dept = await deptSvc.update(parseInt(req.params.id), { name, description });
    res.json({ success: true, department: dept, message: 'แก้ไขแผนกสำเร็จ' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/department/:id  — ลบแผนก (safe: ปฏิเสธถ้ามีพนักงาน)
router.delete('/:id', async (req, res) => {
  try {
    const result = await deptSvc.remove(parseInt(req.params.id));
    res.json({ success: true, message: `ลบแผนก "${result.name}" สำเร็จ` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
