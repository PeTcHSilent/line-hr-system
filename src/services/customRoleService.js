const db = require('../db');

// ── Auto-create tables ───────────────────────────────────────────
async function ensureTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS custom_roles (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(100) NOT NULL,
      color       VARCHAR(20)  DEFAULT '#6c757d',
      description TEXT,
      created_at  TIMESTAMPTZ  DEFAULT NOW(),
      updated_at  TIMESTAMPTZ  DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS custom_role_permissions (
      role_id  INTEGER NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
      menu_key VARCHAR(100) NOT NULL,
      PRIMARY KEY (role_id, menu_key)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS sub_admins (
      id             SERIAL PRIMARY KEY,
      username       VARCHAR(100) NOT NULL UNIQUE,
      password_hash  VARCHAR(200) NOT NULL,
      display_name   VARCHAR(100),
      custom_role_id INTEGER REFERENCES custom_roles(id) ON DELETE SET NULL,
      is_active      BOOLEAN      DEFAULT TRUE,
      created_at     TIMESTAMPTZ  DEFAULT NOW(),
      updated_at     TIMESTAMPTZ  DEFAULT NOW()
    )
  `);
}

// ── Custom Roles ─────────────────────────────────────────────────
async function getAllRoles() {
  await ensureTables();
  const { rows } = await db.query(`
    SELECT r.*,
           COALESCE(
             array_agg(p.menu_key ORDER BY p.menu_key) FILTER (WHERE p.menu_key IS NOT NULL),
             '{}'
           ) AS permissions
    FROM custom_roles r
    LEFT JOIN custom_role_permissions p ON p.role_id = r.id
    GROUP BY r.id
    ORDER BY r.created_at
  `);
  return rows;
}

async function getRoleById(id) {
  await ensureTables();
  const { rows } = await db.query(`
    SELECT r.*,
           COALESCE(
             array_agg(p.menu_key ORDER BY p.menu_key) FILTER (WHERE p.menu_key IS NOT NULL),
             '{}'
           ) AS permissions
    FROM custom_roles r
    LEFT JOIN custom_role_permissions p ON p.role_id = r.id
    WHERE r.id = $1
    GROUP BY r.id
  `, [id]);
  return rows[0] || null;
}

async function createRole({ name, color, description }) {
  await ensureTables();
  const { rows } = await db.query(
    `INSERT INTO custom_roles (name, color, description)
     VALUES ($1, $2, $3) RETURNING *`,
    [name, color || '#6c757d', description || null]
  );
  return rows[0];
}

async function updateRole(id, { name, color, description }) {
  await ensureTables();
  const { rows } = await db.query(
    `UPDATE custom_roles
     SET name=$2, color=$3, description=$4, updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [id, name, color || '#6c757d', description || null]
  );
  if (!rows[0]) throw new Error('ไม่พบ Role');
  return rows[0];
}

async function deleteRole(id) {
  await ensureTables();
  const { rowCount } = await db.query('DELETE FROM custom_roles WHERE id=$1', [id]);
  if (!rowCount) throw new Error('ไม่พบ Role');
  return { success: true };
}

// ── Permissions ─────────────────────────────────────────────────
async function setPermissions(roleId, menuKeys) {
  await ensureTables();
  await db.query('DELETE FROM custom_role_permissions WHERE role_id=$1', [roleId]);
  if (menuKeys && menuKeys.length > 0) {
    const placeholders = menuKeys.map((_, i) => `($1, $${i + 2})`).join(', ');
    await db.query(
      `INSERT INTO custom_role_permissions (role_id, menu_key) VALUES ${placeholders}`,
      [roleId, ...menuKeys]
    );
  }
  return { success: true };
}

// ── Sub-Admins ──────────────────────────────────────────────────
async function getAllSubAdmins() {
  await ensureTables();
  const { rows } = await db.query(`
    SELECT sa.id, sa.username, sa.display_name, sa.is_active, sa.created_at,
           cr.id AS role_id, cr.name AS role_name, cr.color AS role_color
    FROM sub_admins sa
    LEFT JOIN custom_roles cr ON cr.id = sa.custom_role_id
    ORDER BY sa.created_at
  `);
  return rows;
}

async function createSubAdmin({ username, password, displayName, customRoleId }) {
  await ensureTables();
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await db.query(
    `INSERT INTO sub_admins (username, password_hash, display_name, custom_role_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username, display_name, is_active, created_at`,
    [username, hash, displayName || null, customRoleId || null]
  );
  return rows[0];
}

async function updateSubAdmin(id, { displayName, customRoleId, isActive }) {
  await ensureTables();
  const sets = [];
  const vals = [id];
  let idx = 2;
  if (displayName  !== undefined) { sets.push(`display_name=$${idx++}`);    vals.push(displayName); }
  if (customRoleId !== undefined) { sets.push(`custom_role_id=$${idx++}`);  vals.push(customRoleId || null); }
  if (isActive     !== undefined) { sets.push(`is_active=$${idx++}`);       vals.push(isActive); }
  if (sets.length === 0) throw new Error('ไม่มีข้อมูลที่ต้องแก้ไข');
  sets.push('updated_at=NOW()');
  const { rows } = await db.query(
    `UPDATE sub_admins SET ${sets.join(', ')} WHERE id=$1
     RETURNING id, username, display_name, is_active`,
    vals
  );
  if (!rows[0]) throw new Error('ไม่พบ Sub-Admin');
  return rows[0];
}

async function changeSubAdminPassword(id, newPassword) {
  await ensureTables();
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash(newPassword, 10);
  const { rowCount } = await db.query(
    'UPDATE sub_admins SET password_hash=$2, updated_at=NOW() WHERE id=$1',
    [id, hash]
  );
  if (!rowCount) throw new Error('ไม่พบ Sub-Admin');
  return { success: true };
}

async function deleteSubAdmin(id) {
  await ensureTables();
  const { rowCount } = await db.query('DELETE FROM sub_admins WHERE id=$1', [id]);
  if (!rowCount) throw new Error('ไม่พบ Sub-Admin');
  return { success: true };
}

/**
 * ตรวจ credentials ของ sub-admin
 * Returns sub-admin row พร้อม permitted_menus[] หรือ null ถ้า credential ผิด
 */
async function findSubAdminByCredentials(username, password) {
  await ensureTables();
  const { rows } = await db.query(`
    SELECT sa.*,
           cr.name  AS role_name,
           cr.color AS role_color,
           COALESCE(
             array_agg(p.menu_key ORDER BY p.menu_key) FILTER (WHERE p.menu_key IS NOT NULL),
             '{}'
           ) AS permitted_menus
    FROM sub_admins sa
    LEFT JOIN custom_roles cr ON cr.id = sa.custom_role_id
    LEFT JOIN custom_role_permissions p ON p.role_id = sa.custom_role_id
    WHERE sa.username = $1 AND sa.is_active = TRUE
    GROUP BY sa.id, cr.name, cr.color
  `, [username]);
  if (!rows[0]) return null;
  const bcrypt = require('bcryptjs');
  const valid = await bcrypt.compare(password, rows[0].password_hash);
  if (!valid) return null;
  return rows[0];
}

module.exports = {
  ensureTables,
  getAllRoles, getRoleById, createRole, updateRole, deleteRole,
  setPermissions,
  getAllSubAdmins, createSubAdmin, updateSubAdmin,
  changeSubAdminPassword, deleteSubAdmin,
  findSubAdminByCredentials,
};
