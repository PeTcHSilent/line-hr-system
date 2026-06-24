const db = require('../db');

async function getAll({ activeOnly = false } = {}) {
  const where = activeOnly ? 'WHERE is_active = TRUE' : '';
  const result = await db.query(
    `SELECT id, name, address, lat, lng, radius_meters, is_active, created_at
     FROM branches ${where} ORDER BY name`,
  );
  return result.rows;
}

async function getById(id) {
  const result = await db.query(
    'SELECT * FROM branches WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

async function create({ name, address, lat, lng, radius_meters = 300 }) {
  if (!name) throw new Error('ต้องระบุชื่อสาขา');
  const result = await db.query(
    `INSERT INTO branches (name, address, lat, lng, radius_meters)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, address || null, lat || null, lng || null, radius_meters]
  );
  return result.rows[0];
}

async function update(id, { name, address, lat, lng, radius_meters, is_active }) {
  const fields = [];
  const values = [];
  let idx = 1;
  if (name         !== undefined) { fields.push(`name = $${idx++}`);          values.push(name); }
  if (address      !== undefined) { fields.push(`address = $${idx++}`);       values.push(address); }
  if (lat          !== undefined) { fields.push(`lat = $${idx++}`);           values.push(lat); }
  if (lng          !== undefined) { fields.push(`lng = $${idx++}`);           values.push(lng); }
  if (radius_meters!== undefined) { fields.push(`radius_meters = $${idx++}`); values.push(radius_meters); }
  if (is_active    !== undefined) { fields.push(`is_active = $${idx++}`);     values.push(is_active); }
  if (!fields.length) throw new Error('ไม่มีข้อมูลที่ต้องการอัปเดต');
  fields.push(`updated_at = NOW()`);
  values.push(id);
  const result = await db.query(
    `UPDATE branches SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  if (!result.rows[0]) throw new Error('ไม่พบสาขา');
  return result.rows[0];
}

async function remove(id) {
  // ตรวจว่ามีพนักงานอยู่ในสาขานี้หรือไม่
  const empCheck = await db.query(
    'SELECT COUNT(*) FROM employees WHERE branch_id = $1 AND is_active = TRUE',
    [id]
  );
  if (parseInt(empCheck.rows[0].count) > 0) {
    throw new Error('ไม่สามารถลบสาขาที่มีพนักงานอยู่ กรุณาย้ายพนักงานก่อน');
  }
  await db.query('DELETE FROM branches WHERE id = $1', [id]);
  return { success: true };
}

// ดึง GPS coords ของสาขาที่พนักงานสังกัด (ใช้ใน attendanceService)
async function getBranchByEmployeeId(employeeId) {
  const result = await db.query(
    `SELECT b.id, b.lat, b.lng, b.radius_meters, b.name
     FROM branches b
     JOIN employees e ON e.branch_id = b.id
     WHERE e.id = $1`,
    [employeeId]
  );
  return result.rows[0] || null;
}

module.exports = { getAll, getById, create, update, remove, getBranchByEmployeeId };
