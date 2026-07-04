const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const audit   = require('../services/auditService');

const JWT_SECRET  = process.env.JWT_SECRET  || 'hr-system-secret-change-me';
const ADMIN_USER  = process.env.ADMIN_USER  || 'admin';
const ADMIN_PASS  = process.env.ADMIN_PASS  || 'admin1234';

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'กรุณากรอก username และ password' });

    // ── ตรวจ Master Admin ─────────────────────────────────────
    if (username === ADMIN_USER) {
      let currentPass = ADMIN_PASS;
      try {
        const stored = await db.query("SELECT value FROM company_settings WHERE key = 'admin_password'");
        if (stored.rows[0]?.value) currentPass = stored.rows[0].value;
      } catch {}

      const isValid = currentPass.startsWith('$2')
        ? await bcrypt.compare(password, currentPass)
        : password === currentPass;

      if (!isValid)
        return res.status(401).json({ error: 'username หรือ password ไม่ถูกต้อง' });

      const token = jwt.sign(
        { username, role: 'admin', is_master: true },
        JWT_SECRET,
        { expiresIn: '8h' }
      );
      audit.log({
        actorName:  username,
        actorRole:  'admin',
        action:     'login',
        targetType: 'auth',
        targetId:   null,
        description: 'Admin เข้าสู่ระบบ: ' + username,
        meta:        { username, role: 'admin', ip: req.ip },
      });
      return res.json({ success: true, token, expiresIn: 28800, is_master: true });
    }

    // ── ตรวจ Sub-Admin ────────────────────────────────────────
    const customRoleSvc = require('../services/customRoleService');
    const subAdmin = await customRoleSvc.findSubAdminByCredentials(username, password);
    if (!subAdmin)
      return res.status(401).json({ error: 'username หรือ password ไม่ถูกต้อง' });

    const token = jwt.sign(
      {
        username:        subAdmin.username,
        role:            'sub_admin',
        is_master:       false,
        sub_admin_id:    subAdmin.id,
        display_name:    subAdmin.display_name || subAdmin.username,
        role_name:       subAdmin.role_name    || null,
        role_color:      subAdmin.role_color   || '#6c757d',
        permitted_menus: subAdmin.permitted_menus || [],
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    audit.log({
      actorName:  subAdmin.display_name || subAdmin.username,
      actorRole:  'sub_admin',
      action:     'login',
      targetType: 'auth',
      targetId:   subAdmin.id,
      description: 'Sub-Admin เข้าสู่ระบบ: ' + (subAdmin.display_name || subAdmin.username),
      meta:        { username: subAdmin.username, role_name: subAdmin.role_name, ip: req.ip },
    });
    return res.json({
      success: true, token, expiresIn: 28800,
      is_master: false,
      permitted_menus: subAdmin.permitted_menus || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/verify — ตรวจ token ยังใช้ได้ไหม
router.post('/verify', (req, res) => {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer '))
    return res.status(401).json({ valid: false });
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
    res.json({ valid: true, user: decoded });
  } catch {
    res.status(401).json({ valid: false });
  }
});

// POST /api/auth/change-password — เปลี่ยนรหัสผ่าน admin
router.post('/change-password', async (req, res) => {
  try {
    // ตรวจ JWT
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    try { jwt.verify(auth.slice(7), JWT_SECRET); } catch { return res.status(401).json({ error: 'Token ไม่ถูกต้อง' }); }

    const { old_password, new_password } = req.body;
    if (!old_password || !new_password) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
    if (new_password.length < 6) return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' });

    // ดึง password ปัจจุบัน (จาก DB settings หรือ env)
    const stored = await db.query("SELECT value FROM company_settings WHERE key = 'admin_password'");
    const currentHash = stored.rows[0]?.value || ADMIN_PASS;

    // ตรวจรหัสผ่านเดิม
    const isValid = currentHash.startsWith('$2')
      ? await bcrypt.compare(old_password, currentHash)
      : old_password === currentHash;
    if (!isValid) return res.status(401).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });

    // Hash รหัสผ่านใหม่ + บันทึกใน company_settings
    const newHash = await bcrypt.hash(new_password, 10);
    await db.query(
      `INSERT INTO company_settings (key, value, updated_at) VALUES ('admin_password', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [newHash]
    );
    res.json({ success: true, message: 'เปลี่ยนรหัสผ่านสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// POST /api/auth/line-link-code — สร้าง one-time code ผูก LINE (รองรับหลาย admin)
router.post('/line-link-code', async (req, res) => {
  try {
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    try { jwt.verify(auth.slice(7), JWT_SECRET); } catch { return res.status(401).json({ error: 'Token ไม่ถูกต้อง' }); }

    // สร้าง 6-digit code + expiry 10 นาที
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = Date.now() + 10 * 60 * 1000;
    await db.query(
      `INSERT INTO company_settings (key, value, updated_at) VALUES ('admin_link_code', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify({ code, expiry })]
    );
    res.json({ success: true, code, expires_in: 600 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// helper: สร้าง admin_line_users table + ย้ายข้อมูลเก่า ถ้ายังไม่มี
async function ensureAdminLineTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_line_users (
      id            SERIAL PRIMARY KEY,
      line_user_id  VARCHAR(100) NOT NULL UNIQUE,
      display_name  VARCHAR(200) NOT NULL DEFAULT 'Admin',
      linked_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  // ย้ายข้อมูลเก่าจาก company_settings (ถ้ายังอยู่)
  const old = await db.query("SELECT value FROM company_settings WHERE key = 'admin_line_user_id'");
  if (old.rows[0]?.value) {
    const oldName = await db.query("SELECT value FROM company_settings WHERE key = 'admin_line_display_name'");
    await db.query(
      `INSERT INTO admin_line_users (line_user_id, display_name, linked_at)
       VALUES ($1, $2, NOW()) ON CONFLICT (line_user_id) DO NOTHING`,
      [old.rows[0].value, oldName.rows[0]?.value || 'Admin']
    );
    await db.query("DELETE FROM company_settings WHERE key IN ('admin_line_user_id','admin_line_display_name')");
    console.log('[auth] migrated legacy admin_line_user_id →  admin_line_users');
  }
}

// GET /api/auth/line-status — ดึงรายการ admin LINE ทั้งหมดที่ผูกไว้
router.get('/line-status', async (req, res) => {
  try {
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    try { jwt.verify(auth.slice(7), JWT_SECRET); } catch { return res.status(401).json({ error: 'Token ไม่ถูกต้อง' }); }

    await ensureAdminLineTable();
    const r = await db.query(
      'SELECT id, line_user_id, display_name, linked_at FROM admin_line_users ORDER BY linked_at ASC'
    );
    res.json({ admins: r.rows, count: r.rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/auth/line-unlink — ยกเลิกการผูก LINE รายบุคคล
router.delete('/line-unlink', async (req, res) => {
  try {
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    try { jwt.verify(auth.slice(7), JWT_SECRET); } catch { return res.status(401).json({ error: 'Token ไม่ถูกต้อง' }); }

    const lineUserId = req.body?.line_user_id || req.query?.line_user_id;
    if (!lineUserId) return res.status(400).json({ error: 'กรุณาระบุ line_user_id ที่ต้องการยกเลิก' });

    await ensureAdminLineTable();
    const r = await db.query('DELETE FROM admin_line_users WHERE line_user_id = $1 RETURNING *', [lineUserId]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'ไม่พบข้อมูล LINE นี้' });

    await db.query("DELETE FROM company_settings WHERE key = 'admin_link_code'");
    res.json({ success: true, unlinked: r.rows[0].display_name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
