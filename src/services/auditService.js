/**
 * auditService.js
 * บันทึก Audit Log สำหรับทุก action ที่ Admin/Sub-Admin กระทำ
 * ไม่เคย throw error — logging ไม่ควรรบกวน main flow
 */
const db = require('../db');

/**
 * บันทึก action ลง audit_logs
 * @param {object} params
 * @param {string} params.actorName   - ชื่อ Admin ที่ทำรายการ
 * @param {string} params.actorRole   - role ของ Admin (admin / sub_admin)
 * @param {string} params.action      - action key เช่น 'approve_leave', 'reject_ot'
 * @param {string} params.targetType  - ประเภทเป้าหมาย: 'leave' | 'ot' | 'expense' | 'employee'
 * @param {number} params.targetId    - ID ของ record ที่ถูกกระทำ
 * @param {string} params.description - ข้อความอธิบาย (human-readable)
 * @param {object} params.meta        - ข้อมูลเพิ่มเติม (employee_name, leave_type, ...)
 */
async function log({ actorName, actorRole, action, targetType, targetId, description, meta = {} }) {
  try {
    await db.query(
      `INSERT INTO audit_logs (actor_name, actor_role, action, target_type, target_id, description, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        actorName  || 'system',
        actorRole  || null,
        action,
        targetType,
        targetId   || null,
        description || null,
        JSON.stringify(meta),
      ]
    );
  } catch (e) {
    console.error('[AuditService] log error:', e.message);
  }
}

/**
 * ดึง audit logs พร้อม filter
 */
async function getLogs({ limit = 100, offset = 0, targetType, action, startDate, endDate, actorName } = {}) {
  const conditions = [];
  const params = [];
  let pi = 1;

  if (targetType) { conditions.push(`target_type = $${pi++}`); params.push(targetType); }
  if (action)     { conditions.push(`action = $${pi++}`); params.push(action); }
  if (actorName)  { conditions.push(`actor_name ILIKE $${pi++}`); params.push(`%${actorName}%`); }
  if (startDate)  { conditions.push(`created_at >= $${pi++}`); params.push(startDate); }
  if (endDate)    { conditions.push(`created_at < $${pi++}`); params.push(endDate + ' 23:59:59+00'); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(parseInt(limit), parseInt(offset));

  const { rows } = await db.query(
    `SELECT * FROM audit_logs ${where}
     ORDER BY created_at DESC
     LIMIT $${pi++} OFFSET $${pi++}`,
    params
  );

  // count total (สำหรับ pagination)
  const countParams = params.slice(0, params.length - 2);
  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) AS total FROM audit_logs ${where}`,
    countParams
  );

  return { logs: rows, total: parseInt(countRows[0].total) };
}

module.exports = { log, getLogs };
