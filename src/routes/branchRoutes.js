const express = require('express');
const router  = express.Router();
const branchService = require('../services/branchService');
const { requireAuth } = require('../middleware/authMiddleware');

// GET /api/branch — ดึงสาขาทั้งหมด (ไม่ต้อง auth สำหรับ dropdown ใน LIFF/checkin)
router.get('/', async (req, res) => {
  try {
    const activeOnly = req.query.active === 'true';
    const data = await branchService.getAll({ activeOnly });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/branch/:id
router.get('/:id', async (req, res) => {
  try {
    const data = await branchService.getById(parseInt(req.params.id));
    if (!data) return res.status(404).json({ error: 'ไม่พบสาขา' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/branch
router.post('/', requireAuth, async (req, res) => {
  try {
    const branch = await branchService.create(req.body);
    res.status(201).json({ success: true, branch });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PUT /api/branch/:id
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const branch = await branchService.update(parseInt(req.params.id), req.body);
    res.json({ success: true, branch });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE /api/branch/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await branchService.remove(parseInt(req.params.id));
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
