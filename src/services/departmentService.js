const db = require('../db');

/**
 * ดึงแผนกทั้งหมด พร้อมจำนวนพนักงาน
 * รองรับ include_inactive = true เพื่อดึงที่ถูก deactivate ด้วย
 */
async function getAll({ includeInactive = false } = {}) {
  try {
    // หลังรัน migration_v5 (มี description + is_active)
    const result = await db.query(
      `SELECT d.id, d.name, d.description, d.is_active, d.created_at,
              COUNT(e.id) FILTER (WHERE e.is_active = TRUE) AS employee_count
       FROM departments d
       LEFT JOIN employees e ON e.department_id = d.id
       ${includeInactive ? '' : 'WHERE d.is_active = TRUE'}
       GROUP BY d.id, d.name, d.description, d.is_active, d.created_at
       ORDER BY d.name`
    );
    return result.rows;
  } catch (err) {
    // Fallback: ก่อนรัน migration_v5 (ตารางยังไม่มี description/is_active)
    const result = await db.query(
      `SELECT d.id, d.name,
              NULL  AS description,
              TRUE  AS is_active,
              d.created_at,
              COUNT(e.id) AS employee_count
       FROM departments d
       LEFT JOIN employees e ON e.department_id = d.id
       GROUP BY d.id, d.name, d.created_at
       ORDER BY d.name`
    );
    return result.rows;
  }
}

/**
 * ดึงแผนกเดียว พร้อมรายชื่อพนักงาน
 */
async function getById(id) {
  let deptRes;
  try {
    deptRes = await db.query(
      `SELECT d.id, d.name, d.description, d.is_active, d.created_at,
              COUNT(e.id) FILTER (WHERE e.is_active = TRUE) AS employee_count
       FROM departments d
       LEFT JOIN employees e ON e.department_id = d.id
       WHERE d.id = $1
       GROUP BY d.id, d.name, d.description, d.is_active, d.created_at`,
      [id]
    );
  } catch (err) {
    deptRes = await db.query(
      `SELECT d.id, d.name, NULL AS description, TRUE AS is_active, d.created_at,
              COUNT(e.id) AS employee_count
       FROM departments d
       LEFT JOIN employees e ON e.department_id = d.id
       WHERE d.id = $1
       GROUP BY d.id, d.name, d.created_at`,
      [id]
    );
  }
  if (!deptRes.rows[0]) return null;

  const empRes = await db.query(
    `SELECT id, employee_code, name, role, email, phone_no, line_user_id
     FROM employees
     WHERE department_id = $1 AND is_active = TRUE
     ORDER BY employee_code`,
    [id]
  );

  return { ...deptRes.rows[0], employees: empRes.rows };
}

/**
 * สร้างแผนกใหม่
 */
async function create({ name, description }) {
  // ตรวจสอบซ้ำ
  const exist = await db.query(
    `SELECT id FROM departments WHERE LOWER(name) = LOWER($1) AND is_active = TRUE`,
    [name]
  );
  if (exist.rows[0]) throw new Error(`มีแผนก "${name}" อยู่แล้ว`);

  const result = await db.query(
    `INSERT INTO departments (name, description)
     VALUES ($1, $2)
     RETURNING *`,
    [name.trim(), description?.trim() || null]
  );
  return result.rows[0];
}

/**
 * แก้ไขข้อมูลแผนก
 */
async function update(id, { name, description }) {
  // ตรวจสอบซ้ำ (ยกเว้นตัวเอง)
  if (name) {
    const exist = await db.query(
      `SELECT id FROM departments WHERE LOWER(name) = LOWER($1) AND id != $2 AND is_active = TRUE`,
      [name, id]
    );
    if (exist.rows[0]) throw new Error(`มีแผนก "${name}" อยู่แล้ว`);
  }

  const setClauses = [];
  const values = [];
  let idx = 1;

  if (name !== undefined) { setClauses.push(`name = $${idx++}`); values.push(name.trim()); }
  if (description !== undefined) { setClauses.push(`description = $${idx++}`); values.push(description?.trim() || null); }

  if (!setClauses.length) throw new Error('ไม่มีข้อมูลที่ต้องการแก้ไข');

  values.push(id);
  const result = await db.query(
    `UPDATE departments SET ${setClauses.join(', ')}
     WHERE id = $${idx} AND is_active = TRUE
     RETURNING *`,
    values
  );
  if (!result.rows[0]) throw new Error('ไม่พบแผนก');
  return result.rows[0];
}

/**
 * ลบแผนก (soft delete)
 * - ถ้ายังมีพนักงาน active อยู่ → ปฏิเสธ
 */
async function remove(id) {
  // ตรวจสอบว่ามีพนักงานอยู่ไหม
  const empCheck = await db.query(
    `SELECT COUNT(*) AS cnt FROM employees WHERE department_id = $1 AND is_active = TRUE`,
    [id]
  );
  const cnt = parseInt(empCheck.rows[0].cnt);
  if (cnt > 0) {
    throw new Error(`ไม่สามารถลบได้ เพราะยังมีพนักงาน ${cnt} คนอยู่ในแผนกนี้`);
  }

  const result = await db.query(
    `UPDATE departments SET is_active = FALSE
     WHERE id = $1 AND is_active = TRUE
     RETURNING id, name`,
    [id]
  );
  if (!result.rows[0]) throw new Error('ไม่พบแผนก');
  return result.rows[0];
}

module.exports = { getAll, getById, create, update, remove };
