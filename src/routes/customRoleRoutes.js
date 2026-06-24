const express = require('express');
const router  = express.Router();
const svc     = require('../services/customRoleService');
const { requireAuth } = require('../middleware/authMiddleware');

// ════════════════════════════════════════
// Custom Roles
// ════════════════════════════════════════

// GET /api/custom-roles
router.get('/', requireAuth, async (req, res) => {
  try { res.json(await svc.getAllRoles()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/custom-roles/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const role = await svc.getRoleById(req.params.id);
    if (!role) return res.status(404).json({ error: 'ไม่พบ Role' });
    res.json(role);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/custom-roles
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, color, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'กรุณาระบุชื่อ Role' });
    res.status(201).json(await svc.createRole({ name: name.trim(), color, description }));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PUT /api/custom-roles/:id
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { name, color, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'กรุณาระบุชื่อ Role' });
    res.json(await svc.updateRole(req.params.id, { name: name.trim(), color, description }));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE /api/custom-roles/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try { res.json(await svc.deleteRole(req.params.id)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// PUT /api/custom-roles/:id/permissions  — set menu permissions (replace all)
router.put('/:id/permissions', requireAuth, async (req, res) => {
  try {
    const { menus } = req.body;
    if (!Array.isArray(menus)) return res.status(400).json({ error: 'menus ต้องเป็น array' });
    res.json(await svc.setPermissions(req.params.id, menus));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ════════════════════════════════════════
// Sub-Admins
// ════════════════════════════════════════

// GET /api/custom-roles/sub-admins
router.get('/sub-admins/list', requireAuth, async (req, res) => {
  try { res.json(await svc.getAllSubAdmins()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/custom-roles/sub-admins
router.post('/sub-admins', requireAuth, async (req, res) => {
  try {
    const { username, password, display_name, custom_role_id } = req.body;
    if (!username?.trim()) return res.status(400).json({ error: 'กรุณาระบุ username' });
    if (!password || password.length < 6)
      return res.status(400).json({ error: 'password ต้องมีอย่างน้อย 6 ตัวอักษร' });
    const sa = await svc.createSubAdmin({
      username: username.trim().toLowerCase(),
      password,
      displayName: display_name?.trim() || null,
      customRoleId: custom_role_id || null,
    });
    res.status(201).json(sa);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'username นี้มีอยู่แล้ว' });
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/custom-roles/sub-admins/:id
router.put('/sub-admins/:id', requireAuth, async (req, res) => {
  try {
    const { display_name, custom_role_id, is_active } = req.body;
    res.json(await svc.updateSubAdmin(req.params.id, {
      displayName:   display_name,
      customRoleId:  custom_role_id,
      isActive:      is_active,
    }));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PATCH /api/custom-roles/sub-admins/:id/password
router.patch('/sub-admins/:id/password', requireAuth, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6)
      return res.status(400).json({ error: 'password ต้องมีอย่างน้อย 6 ตัวอักษร' });
    res.json(await svc.changeSubAdminPassword(req.params.id, password));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE /api/custom-roles/sub-admins/:id
router.delete('/sub-admins/:id', requireAuth, async (req, res) => {
  try { res.json(await svc.deleteSubAdmin(req.params.id)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
