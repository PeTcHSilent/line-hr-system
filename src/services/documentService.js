'use strict';
/**
 * documentService.js
 *
 * เอกสาร/ใบอนุญาตของพนักงานที่มีวันหมดอายุ (ใบอนุญาตนายหน้าประกัน, บัตร ปชช., ใบขับขี่ ฯลฯ)
 *
 * การเชื่อมโยงกับฟังก์ชันอื่น:
 *  - employee_documents        → เก็บรายการเอกสารต่อพนักงาน
 *  - src/jobs/reminderCron.js  → แจ้งเตือน admin ทุกวัน เมื่อใกล้หมดอายุ/หมดอายุแล้ว
 */

const db = require('../db');

const DOC_TYPES = ['broker_license', 'id_card', 'driver_license', 'passport', 'work_permit', 'contract', 'other'];

// ─── รายการเอกสารทั้งหมด (filter: employeeId, docType, status) ───────────
// status: 'expiring' (หมดอายุใน 30 วัน) | 'expired' (หมดอายุแล้ว) | undefined = ทั้งหมด

async function list({ employeeId, docType, status } = {}) {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (employeeId) { conditions.push(`ed.employee_id = $${idx++}`); values.push(employeeId); }
  if (docType)     { conditions.push(`ed.doc_type = $${idx++}`);    values.push(docType); }
  if (status === 'expired')  conditions.push(`ed.expiry_date < CURRENT_DATE`);
  if (status === 'expiring') conditions.push(`ed.expiry_date >= CURRENT_DATE AND ed.expiry_date <= CURRENT_DATE + INTERVAL '30 days'`);

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const { rows } = await db.query(
    `SELECT ed.*, e.name AS employee_name, e.employee_code,
            d.name AS department_name,
            (ed.expiry_date - CURRENT_DATE) AS days_left
     FROM employee_documents ed
     JOIN employees e ON e.id = ed.employee_id
     LEFT JOIN departments d ON d.id = e.department_id
     ${where}
     ORDER BY ed.expiry_date ASC`,
    values
  );
  return rows;
}

// ─── เอกสารที่ใกล้หมดอายุ/หมดอายุแล้ว (ใช้ใน cron) ─────────────────────────

async function getExpiringSoon(daysAhead = 30) {
  const { rows } = await db.query(
    `SELECT ed.*, e.name AS employee_name, e.employee_code, e.line_user_id,
            (ed.expiry_date - CURRENT_DATE) AS days_left
     FROM employee_documents ed
     JOIN employees e ON e.id = ed.employee_id
     WHERE e.is_active = TRUE
       AND ed.expiry_date <= CURRENT_DATE + ($1 || ' days')::INTERVAL
     ORDER BY ed.expiry_date ASC`,
    [daysAhead]
  );
  return rows;
}

async function getById(id) {
  const { rows } = await db.query(
    `SELECT ed.*, e.name AS employee_name FROM employee_documents ed
     JOIN employees e ON e.id = ed.employee_id WHERE ed.id = $1`,
    [id]
  );
  return rows[0];
}

// ─── เพิ่มเอกสาร ────────────────────────────────────────────────────────

async function create({ employeeId, docType, docNumber, issueDate, expiryDate, note, createdBy }) {
  if (!employeeId) throw new Error('ต้องระบุ employee_id');
  if (!DOC_TYPES.includes(docType)) throw new Error('ประเภทเอกสารไม่ถูกต้อง');
  if (!expiryDate) throw new Error('ต้องระบุวันหมดอายุ');

  const empRes = await db.query('SELECT id FROM employees WHERE id = $1', [employeeId]);
  if (!empRes.rows[0]) throw new Error('ไม่พบพนักงาน');

  const { rows } = await db.query(
    `INSERT INTO employee_documents (employee_id, doc_type, doc_number, issue_date, expiry_date, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [employeeId, docType, docNumber || null, issueDate || null, expiryDate, note || null, createdBy || null]
  );
  return rows[0];
}

// ─── แก้ไขเอกสาร ────────────────────────────────────────────────────────

async function update(id, { docType, docNumber, issueDate, expiryDate, note }) {
  const existing = await getById(id);
  if (!existing) throw new Error('ไม่พบเอกสาร');
  if (docType && !DOC_TYPES.includes(docType)) throw new Error('ประเภทเอกสารไม่ถูกต้อง');

  const { rows } = await db.query(
    `UPDATE employee_documents SET
       doc_type=COALESCE($2,doc_type), doc_number=$3, issue_date=$4, expiry_date=COALESCE($5,expiry_date),
       note=$6, updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [id, docType || null, docNumber || null, issueDate || null, expiryDate || null, note || null]
  );
  return rows[0];
}

// ─── ลบเอกสาร ───────────────────────────────────────────────────────────

async function remove(id) {
  const { rows } = await db.query('DELETE FROM employee_documents WHERE id = $1 RETURNING *', [id]);
  if (!rows[0]) throw new Error('ไม่พบเอกสาร');
  return rows[0];
}

module.exports = { DOC_TYPES, list, getExpiringSoon, getById, create, update, remove };
