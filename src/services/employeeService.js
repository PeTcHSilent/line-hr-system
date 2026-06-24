const db = require('../db');

/**
 * ค้นหาพนักงานจาก LINE User ID
 */
async function findByLineId(lineUserId) {
  const result = await db.query(
    `SELECT e.*, d.name AS department_name
     FROM employees e
     LEFT JOIN departments d ON e.department_id = d.id
     WHERE e.line_user_id = $1 AND e.is_active = TRUE`,
    [lineUserId]
  );
  return result.rows[0] || null;
}

/**
 * ค้นหาพนักงานจากรหัส employee_code
 */
async function findByCode(employeeCode) {
  const result = await db.query(
    `SELECT e.*, d.name AS department_name
     FROM employees e
     LEFT JOIN departments d ON e.department_id = d.id
     WHERE e.employee_code = $1 AND e.is_active = TRUE`,
    [employeeCode]
  );
  return result.rows[0] || null;
}

/**
 * ผูก LINE User ID กับรหัสพนักงาน (ลงทะเบียนครั้งแรก)
 * Returns: { employee, alreadyLinked: true } ถ้า line_user_id นี้ถูกผูกอยู่แล้ว
 *          { employee, alreadyLinked: false } ถ้าผูกสำเร็จ
 *          null ถ้าไม่พบรหัสพนักงาน
 */
async function linkLineAccount(employeeCode, lineUserId) {
  // ตรวจว่า LINE account นี้ถูกผูกกับพนักงานคนอื่นอยู่แล้วหรือไม่
  const existingLink = await db.query(
    `SELECT id, employee_code, name FROM employees WHERE line_user_id = $1 AND is_active = TRUE`,
    [lineUserId]
  );
  if (existingLink.rows[0]) {
    const linked = existingLink.rows[0];
    // ถ้า link กับรหัสเดิมอยู่แล้ว (re-register ซ้ำ)
    if (linked.employee_code.toUpperCase() === employeeCode.toUpperCase()) {
      return { employee: linked, alreadyLinked: true, sameEmployee: true };
    }
    // LINE นี้ผูกกับคนอื่นอยู่
    return { employee: null, alreadyLinked: true, sameEmployee: false, linkedTo: linked };
  }

  // ตรวจว่ารหัสพนักงานนี้มีคนผูกอยู่แล้วหรือไม่
  const empCheck = await db.query(
    `SELECT id, employee_code, name, line_user_id FROM employees
     WHERE employee_code = $1 AND is_active = TRUE`,
    [employeeCode]
  );
  if (!empCheck.rows[0]) return null; // ไม่พบรหัสพนักงาน

  if (empCheck.rows[0].line_user_id) {
    // รหัสนี้ถูก link กับ LINE อื่นอยู่แล้ว — ต้องให้ Admin ยกเลิกก่อน
    return { employee: empCheck.rows[0], codeAlreadyLinked: true };
  }

  // ผูกได้ปกติ
  const result = await db.query(
    `UPDATE employees SET line_user_id = $1, updated_at = NOW()
     WHERE employee_code = $2 AND is_active = TRUE
     RETURNING *`,
    [lineUserId, employeeCode]
  );
  return { employee: result.rows[0] || null, alreadyLinked: false };
}

/**
 * ยกเลิกการผูก LINE (Admin ใช้)
 */
async function unlinkLineAccount(employeeId) {
  const result = await db.query(
    `UPDATE employees SET line_user_id = NULL, updated_at = NOW()
     WHERE id = $1 AND is_active = TRUE
     RETURNING id, employee_code, name`,
    [employeeId]
  );
  return result.rows[0] || null;
}

/**
 * ตั้ง LINE User ID โดย Admin (override โดยไม่ต้องให้พนักงาน chat)
 */
async function adminSetLineId(employeeId, lineUserId) {
  // ตรวจว่า LINE ID นี้ถูก link กับคนอื่นอยู่แล้วหรือไม่
  if (lineUserId) {
    const conflict = await db.query(
      `SELECT id, employee_code, name FROM employees
       WHERE line_user_id = $1 AND id != $2 AND is_active = TRUE`,
      [lineUserId, employeeId]
    );
    if (conflict.rows[0]) {
      throw new Error(`LINE ID นี้ถูกผูกกับพนักงาน ${conflict.rows[0].name} (${conflict.rows[0].employee_code}) อยู่แล้ว`);
    }
  }
  const result = await db.query(
    `UPDATE employees SET line_user_id = $1, updated_at = NOW()
     WHERE id = $2 AND is_active = TRUE
     RETURNING id, employee_code, name, line_user_id`,
    [lineUserId || null, employeeId]
  );
  if (!result.rows[0]) throw new Error('ไม่พบพนักงาน');
  return result.rows[0];
}

/**
 * ดึงวันลาคงเหลือของพนักงาน (กรองตามเพศด้วย)
 * sex: 'M' หรือ 'W'
 */
async function getLeaveBalance(employeeId, sex) {
  const year = new Date().getFullYear();
  const result = await db.query(
    `SELECT lt.id, lt.name, lt.max_days, lt.gender_restriction,
            COALESCE(SUM(lr.total_days) FILTER (WHERE lr.status = 'approved'), 0) AS used_days
     FROM leave_types lt
     LEFT JOIN leave_requests lr
       ON lr.leave_type_id = lt.id
       AND lr.employee_id = $1
       AND EXTRACT(YEAR FROM lr.start_date) = $2
     WHERE lt.gender_restriction IS NULL
        OR lt.gender_restriction = $3
     GROUP BY lt.id, lt.name, lt.max_days, lt.gender_restriction
     ORDER BY lt.id`,
    [employeeId, year, sex || null]
  );
  return result.rows;
}

/**
 * ดึงพนักงานรายเดียวจาก id
 */
async function getById(id) {
  const result = await db.query(
    `SELECT e.*, d.name AS department_name,
            m.name AS manager_name,
            b.name AS branch_name
     FROM employees e
     LEFT JOIN departments d ON e.department_id = d.id
     LEFT JOIN employees m ON e.manager_id = m.id
     LEFT JOIN branches b ON e.branch_id = b.id
     WHERE e.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

/**
 * แก้ไขข้อมูลพนักงาน
 */
async function updateEmployee(id, fields) {
  const allowed = ['name', 'sex', 'phone_no', 'email', 'department_id', 'role', 'manager_id', 'salary', 'deduct_absent',
    'bank_name', 'bank_branch', 'bank_account_no', 'bank_account_name',
    'probation_start_date', 'probation_end_date', 'probation_status', 'branch_id', 'hire_date'];
  const setClauses = [];
  const values = [];
  let idx = 1;

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      setClauses.push(`${key} = $${idx++}`);
      values.push(fields[key]);
    }
  }
  if (setClauses.length === 0) throw new Error('ไม่มีข้อมูลที่ต้องการแก้ไข');
  setClauses.push(`updated_at = NOW()`);
  values.push(id);

  const result = await db.query(
    `UPDATE employees SET ${setClauses.join(', ')}
     WHERE id = $${idx} AND is_active = TRUE
     RETURNING *`,
    values
  );
  if (!result.rows[0]) throw new Error('ไม่พบพนักงาน');
  return result.rows[0];
}

/**
 * ปิดใช้งานพนักงาน (soft delete)
 */
async function deactivateEmployee(id) {
  const result = await db.query(
    `UPDATE employees SET is_active = FALSE, updated_at = NOW()
     WHERE id = $1 AND is_active = TRUE
     RETURNING id, employee_code, name`,
    [id]
  );
  if (!result.rows[0]) throw new Error('ไม่พบพนักงาน');
  return result.rows[0];
}

/**
 * ค้นหาพนักงานด้วย keyword (ชื่อ / รหัส) + filter แผนก / สาขา
 */
async function searchEmployees({ keyword, departmentId, role, branchId } = {}) {
  const conditions = ['e.is_active = TRUE'];
  const values = [];
  let idx = 1;

  if (keyword) {
    conditions.push(`(e.name ILIKE $${idx} OR e.employee_code ILIKE $${idx})`);
    values.push(`%${keyword}%`);
    idx++;
  }
  if (departmentId) {
    conditions.push(`e.department_id = $${idx++}`);
    values.push(departmentId);
  }
  if (role) {
    conditions.push(`e.role = $${idx++}`);
    values.push(role);
  }
  if (branchId) {
    conditions.push(`e.branch_id = $${idx++}`);
    values.push(branchId);
  }

  const result = await db.query(
    `SELECT e.id, e.employee_code, e.name, e.sex, e.phone_no, e.email,
            e.role, e.department_id, e.manager_id, e.line_user_id,
            e.branch_id, e.created_at,
            d.name AS department_name,
            m.name AS manager_name,
            b.name AS branch_name
     FROM employees e
     LEFT JOIN departments d ON e.department_id = d.id
     LEFT JOIN employees m ON e.manager_id = m.id
     LEFT JOIN branches b ON e.branch_id = b.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY e.employee_code`,
    values
  );
  return result.rows;
}

/**
 * เพิ่มพนักงานใหม่
 */
async function createEmployee({ employeeCode, name, sex, phoneNo, email, departmentId, role, managerId, branchId, hireDate }) {
  const result = await db.query(
    `INSERT INTO employees
       (employee_code, name, sex, phone_no, email, department_id, role, manager_id, branch_id, hire_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [employeeCode, name, sex, phoneNo, email, departmentId, role || 'employee', managerId || null, branchId || null, hireDate || null]
  );
  return result.rows[0];
}

/**
 * ดึงพนักงานทั้งหมด
 */
async function getAllEmployees() {
  const result = await db.query(
    `SELECT e.*, d.name AS department_name, b.name AS branch_name
     FROM employees e
     LEFT JOIN departments d ON e.department_id = d.id
     LEFT JOIN branches b ON e.branch_id = b.id
     WHERE e.is_active = TRUE
     ORDER BY e.employee_code`
  );
  return result.rows;
}

/**
 * หาพนักงานตาม role (สำหรับ push notification หาหัวหน้า/HR/Admin)
 */
async function findByRole(roles) {
  const roleList = Array.isArray(roles) ? roles : [roles];
  const result = await db.query(
    `SELECT e.*, d.name AS department_name
     FROM employees e
     LEFT JOIN departments d ON e.department_id = d.id
     WHERE e.role = ANY($1::text[]) AND e.is_active = TRUE AND e.line_user_id IS NOT NULL`,
    [roleList]
  );
  return result.rows;
}

module.exports = {
  findByLineId, findByCode, linkLineAccount, unlinkLineAccount, adminSetLineId,
  getLeaveBalance,
  createEmployee, getAllEmployees,
  getById, findById: getById, findByRole,
  updateEmployee, deactivateEmployee, searchEmployees,
};
