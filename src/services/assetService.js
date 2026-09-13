'use strict';
/**
 * assetService.js
 *
 * ทะเบียนทรัพย์สิน/อุปกรณ์บริษัท + ประวัติการเบิก-คืนของพนักงาน
 *
 * การเชื่อมโยงกับฟังก์ชันอื่น:
 *  - company_assets            → ทะเบียนทรัพย์สิน (laptop, มือถือ, เครื่องแบบ ฯลฯ)
 *  - asset_assignments         → ประวัติเบิก/คืน ต่อพนักงาน (active = returned_date IS NULL)
 *  - payrollDeductionService   → ถ้าคืนแบบ damaged/lost แนะนำให้เปิดหักเงินหมวด 'equipment' ต่อ (ทำที่ฝั่ง UI)
 */

const db = require('../db');

const CATEGORIES = ['laptop', 'phone', 'uniform', 'vehicle', 'furniture', 'other'];
const CONDITIONS = ['normal', 'damaged', 'lost'];

// ─── ทะเบียนทรัพย์สิน ──────────────────────────────────────────────────────

async function listAssets({ category, status } = {}) {
  const conditions = [];
  const values = [];
  let idx = 1;
  if (category) { conditions.push(`a.category = $${idx++}`); values.push(category); }
  if (status)   { conditions.push(`a.status = $${idx++}`);   values.push(status); }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const { rows } = await db.query(
    `SELECT a.*,
            aa.employee_id AS current_employee_id,
            e.name AS current_employee_name,
            aa.assigned_date AS current_assigned_date
     FROM company_assets a
     LEFT JOIN asset_assignments aa ON aa.asset_id = a.id AND aa.returned_date IS NULL
     LEFT JOIN employees e ON e.id = aa.employee_id
     ${where}
     ORDER BY a.created_at DESC`,
    values
  );
  return rows;
}

async function getAssetById(id) {
  const { rows } = await db.query('SELECT * FROM company_assets WHERE id = $1', [id]);
  if (!rows[0]) return null;
  const history = await db.query(
    `SELECT aa.*, e.name AS employee_name, ab.name AS assigned_by_name
     FROM asset_assignments aa
     JOIN employees e ON e.id = aa.employee_id
     LEFT JOIN employees ab ON ab.id = aa.assigned_by
     WHERE aa.asset_id = $1
     ORDER BY aa.assigned_date DESC`,
    [id]
  );
  return { ...rows[0], history: history.rows };
}

async function createAsset({ assetCode, assetName, category, serialNumber, purchaseDate, purchasePrice, note }) {
  if (!assetCode || !assetName) throw new Error('ต้องระบุรหัสและชื่อทรัพย์สิน');
  if (!CATEGORIES.includes(category)) throw new Error('หมวดหมู่ไม่ถูกต้อง');

  const dup = await db.query('SELECT id FROM company_assets WHERE asset_code = $1', [assetCode]);
  if (dup.rows[0]) throw new Error('รหัสทรัพย์สินนี้มีอยู่แล้ว');

  const { rows } = await db.query(
    `INSERT INTO company_assets (asset_code, asset_name, category, serial_number, purchase_date, purchase_price, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [assetCode, assetName, category, serialNumber || null, purchaseDate || null, purchasePrice || null, note || null]
  );
  return rows[0];
}

async function updateAsset(id, { assetName, category, serialNumber, purchaseDate, purchasePrice, note, status }) {
  if (category && !CATEGORIES.includes(category)) throw new Error('หมวดหมู่ไม่ถูกต้อง');
  const { rows } = await db.query(
    `UPDATE company_assets SET
       asset_name=COALESCE($2,asset_name), category=COALESCE($3,category),
       serial_number=$4, purchase_date=$5, purchase_price=$6, note=$7,
       status=COALESCE($8,status), updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [id, assetName || null, category || null, serialNumber || null, purchaseDate || null, purchasePrice || null, note || null, status || null]
  );
  if (!rows[0]) throw new Error('ไม่พบทรัพย์สิน');
  return rows[0];
}

async function removeAsset(id) {
  const active = await db.query('SELECT id FROM asset_assignments WHERE asset_id = $1 AND returned_date IS NULL', [id]);
  if (active.rows[0]) throw new Error('ไม่สามารถลบได้ — ทรัพย์สินนี้ยังถูกเบิกใช้งานอยู่ กรุณาคืนก่อน');
  const { rows } = await db.query('DELETE FROM company_assets WHERE id = $1 RETURNING *', [id]);
  if (!rows[0]) throw new Error('ไม่พบทรัพย์สิน');
  return rows[0];
}

// ─── เบิก/คืน ──────────────────────────────────────────────────────────────

async function assign({ assetId, employeeId, assignedDate, note, assignedBy }) {
  const assetRes = await db.query('SELECT * FROM company_assets WHERE id = $1', [assetId]);
  const asset = assetRes.rows[0];
  if (!asset) throw new Error('ไม่พบทรัพย์สิน');
  if (asset.status === 'assigned') throw new Error('ทรัพย์สินนี้ถูกเบิกใช้งานอยู่แล้ว');
  if (asset.status === 'retired')  throw new Error('ทรัพย์สินนี้ถูกปลดระวางแล้ว');

  const empRes = await db.query('SELECT id, name FROM employees WHERE id = $1', [employeeId]);
  if (!empRes.rows[0]) throw new Error('ไม่พบพนักงาน');

  const { rows } = await db.query(
    `INSERT INTO asset_assignments (asset_id, employee_id, assigned_date, note, assigned_by)
     VALUES ($1,$2,COALESCE($3,CURRENT_DATE),$4,$5) RETURNING *`,
    [assetId, employeeId, assignedDate || null, note || null, assignedBy || null]
  );
  await db.query(`UPDATE company_assets SET status='assigned', updated_at=NOW() WHERE id=$1`, [assetId]);

  return { ...rows[0], employee_name: empRes.rows[0].name, asset_name: asset.asset_name };
}

async function returnAsset({ assignmentId, returnedDate, returnCondition, note }) {
  if (!CONDITIONS.includes(returnCondition)) throw new Error('สภาพการคืนไม่ถูกต้อง');

  const asgRes = await db.query('SELECT * FROM asset_assignments WHERE id = $1', [assignmentId]);
  const asg = asgRes.rows[0];
  if (!asg) throw new Error('ไม่พบรายการเบิก');
  if (asg.returned_date) throw new Error('รายการนี้ถูกคืนไปแล้ว');

  await db.query(
    `UPDATE asset_assignments SET returned_date=COALESCE($2,CURRENT_DATE), return_condition=$3, note=$4
     WHERE id=$1`,
    [assignmentId, returnedDate || null, returnCondition, note || asg.note]
  );

  // อัปเดตสถานะทรัพย์สินตามสภาพที่คืน
  const newStatus = returnCondition === 'normal' ? 'available'
                   : returnCondition === 'damaged' ? 'maintenance'
                   : 'lost'; // lost
  await db.query(`UPDATE company_assets SET status=$2, updated_at=NOW() WHERE id=$1`, [asg.asset_id, newStatus]);

  const assetRes = await db.query('SELECT * FROM company_assets WHERE id = $1', [asg.asset_id]);
  return { assignment: { ...asg, returned_date: returnedDate || new Date(), return_condition: returnCondition }, asset: assetRes.rows[0] };
}

async function listAssignmentsByEmployee(employeeId) {
  const { rows } = await db.query(
    `SELECT aa.*, a.asset_code, a.asset_name, a.category
     FROM asset_assignments aa
     JOIN company_assets a ON a.id = aa.asset_id
     WHERE aa.employee_id = $1
     ORDER BY aa.assigned_date DESC`,
    [employeeId]
  );
  return rows;
}

module.exports = {
  CATEGORIES, CONDITIONS,
  listAssets, getAssetById, createAsset, updateAsset, removeAsset,
  assign, returnAsset, listAssignmentsByEmployee,
};
