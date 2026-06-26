const express = require('express');
const router = express.Router();
const employeeService = require('../services/employeeService');

// GET /api/employee/me?line_user_id=xxx — LIFF ใช้ดึงข้อมูลตัวเอง
router.get('/me', async (req, res) => {
  const lineUserId = req.query.line_user_id;
  if (!lineUserId) return res.status(400).json({ error: 'ต้องระบุ line_user_id' });

  const emp = await employeeService.findByLineId(lineUserId);
  if (!emp) return res.status(404).json({ error: 'ไม่พบข้อมูลพนักงาน' });

  res.json({
    id: emp.id,
    name: emp.name,
    sex: emp.sex,
    employee_code: emp.employee_code,
    department_name: emp.department_name,
    role: emp.role,
  });
});

// GET /api/employee/leave-types?line_user_id=xxx — ดึงประเภทลาที่พนักงานมีสิทธิ์
router.get('/leave-types', async (req, res) => {
  const lineUserId = req.query.line_user_id;
  if (!lineUserId) return res.status(400).json({ error: 'ต้องระบุ line_user_id' });

  const emp = await employeeService.findByLineId(lineUserId);
  if (!emp) return res.status(404).json({ error: 'ไม่พบข้อมูลพนักงาน' });

  const db = require('../db');
  const { rows } = await db.query(
    `SELECT id, name, max_days, gender_restriction
     FROM leave_types
     WHERE gender_restriction IS NULL OR gender_restriction = $1
     ORDER BY id`,
    [emp.sex || null]
  );
  res.json(rows);
});

// GET /api/employee — ดึงพนักงานทั้งหมด (admin)
router.get('/', async (req, res) => {
  try {
    const employees = await employeeService.getAllEmployees();
    res.json(employees);
  } catch (err) {
    console.error('[GET /api/employee/]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/employee — เพิ่มพนักงานใหม่
router.post('/', async (req, res) => {
  try {
    const { employee_code, name, sex, phone_no, email, department_id, role, manager_id, branch_id, hire_date } = req.body;

    if (!employee_code || !name) return res.status(400).json({ error: 'employee_code และ name จำเป็น' });
    if (sex && !['M', 'W'].includes(sex)) return res.status(400).json({ error: 'sex ต้องเป็น M หรือ W' });
    if (!employee_code.match(/^TK\d+$/i)) return res.status(400).json({ error: 'รูปแบบรหัสพนักงานต้องเป็น TK001' });

    const emp = await employeeService.createEmployee({
      employeeCode: employee_code.toUpperCase(),
      name,
      sex,
      phoneNo: phone_no,
      email,
      departmentId: department_id,
      role,
      managerId: manager_id,
      branchId: branch_id || null,
      hireDate: hire_date || null,
    });
    res.status(201).json(emp);
  } catch (err) {
    console.error('Employee POST error:', err);
    res.status(400).json({ error: err.message });
  }
});

// GET /api/employee/leave-balance?line_user_id=xxx — วันลาคงเหลือ (LIFF)
router.get('/leave-balance', async (req, res) => {
  const lineUserId = req.query.line_user_id;
  if (!lineUserId) return res.status(400).json({ error: 'ต้องระบุ line_user_id' });

  const emp = await employeeService.findByLineId(lineUserId);
  if (!emp) return res.status(404).json({ error: 'ไม่พบข้อมูลพนักงาน' });

  const balance = await employeeService.getLeaveBalance(emp.id, emp.sex);
  res.json(balance);
});

// GET /api/employee/:id/balance — วันลาคงเหลือรายคน (Admin)
router.get('/:id/balance', async (req, res) => {
  try {
    const emp = await employeeService.getById(parseInt(req.params.id));
    if (!emp) return res.status(404).json({ error: 'ไม่พบพนักงาน' });
    const balance = await employeeService.getLeaveBalance(emp.id, emp.sex);
    res.json({ employee_name: emp.name, employee_code: emp.employee_code, balance });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/employee/search?keyword=xxx&department_id=1&role=employee&branch_id=1
router.get('/search', async (req, res) => {
  try {
    const { keyword, department_id, role, branch_id } = req.query;
    const employees = await employeeService.searchEmployees({
      keyword,
      departmentId: department_id ? parseInt(department_id) : undefined,
      role,
      branchId: branch_id ? parseInt(branch_id) : undefined,
    });
    res.json(employees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/employee/:id/unlink-line — Admin ยกเลิกการผูก LINE
router.patch('/:id/unlink-line', async (req, res) => {
  try {
    const result = await employeeService.unlinkLineAccount(req.params.id);
    if (!result) return res.status(404).json({ error: 'ไม่พบพนักงาน' });
    res.json({ success: true, message: `ยกเลิกการผูก LINE ของ ${result.name} เรียบร้อยแล้ว`, employee: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/employee/:id/set-line — Admin ตั้ง LINE User ID โดยตรง
router.patch('/:id/set-line', async (req, res) => {
  try {
    const { line_user_id } = req.body;
    const result = await employeeService.adminSetLineId(req.params.id, line_user_id);
    res.json({ success: true, employee: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/employee/:id — ดึงพนักงานรายเดียว
router.get('/:id', async (req, res) => {
  try {
    const emp = await employeeService.getById(req.params.id);
    if (!emp) return res.status(404).json({ error: 'ไม่พบพนักงาน' });
    res.json(emp);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/employee/:id — แก้ไขข้อมูลพนักงาน
router.put('/:id', async (req, res) => {
  try {
    const {
      name, sex, phone_no, email, department_id, role, manager_id, salary, deduct_absent,
      bank_name, bank_branch, bank_account_no, bank_account_name,
      probation_start_date, probation_end_date, probation_status, branch_id, hire_date,
    } = req.body;
    if (sex && !['M', 'W'].includes(sex)) {
      return res.status(400).json({ error: 'sex ต้องเป็น M หรือ W' });
    }
    const VALID_PROB = ['on_probation', 'passed', 'failed', 'extended'];
    if (probation_status && !VALID_PROB.includes(probation_status)) {
      return res.status(400).json({ error: 'probation_status ไม่ถูกต้อง' });
    }
    const emp = await employeeService.updateEmployee(req.params.id, {
      name, sex, phone_no, email, department_id, role, manager_id,
      salary: salary !== undefined ? (parseFloat(salary) || 0) : undefined,
      deduct_absent: deduct_absent !== undefined ? Boolean(deduct_absent) : undefined,
      bank_name, bank_branch, bank_account_no, bank_account_name,
      probation_start_date: probation_start_date || undefined,
      probation_end_date: probation_end_date || undefined,
      probation_status: probation_status || undefined,
      branch_id: branch_id !== undefined ? (branch_id || null) : undefined,
      hire_date: hire_date !== undefined ? (hire_date || null) : undefined,
    });
    res.json(emp);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/employee/:id — ปิดใช้งานพนักงาน (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const result = await employeeService.deactivateEmployee(req.params.id);
    res.json({ success: true, deactivated: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
