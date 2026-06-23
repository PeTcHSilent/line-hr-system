-- ============================================================
-- Migration V2 - อัปเดต Schema ให้รองรับข้อกำหนดใหม่
-- วิธีใช้: เปิด pgAdmin → เลือก hr_db → Query Tool → วาง SQL นี้ → Run
-- ============================================================

-- -----------------------------------------------
-- 1. เพิ่มคอลัมน์ใหม่ในตาราง employees
-- -----------------------------------------------
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS sex       VARCHAR(1) CHECK (sex IN ('M', 'W')),
  ADD COLUMN IF NOT EXISTS phone_no  VARCHAR(20);

-- ถ้าเดิมมี phone อยู่แล้ว ให้ copy ข้อมูลมาก่อน แล้วลบ (ถ้าไม่มี column phone ข้ามได้)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='employees' AND column_name='phone'
  ) THEN
    UPDATE employees SET phone_no = phone WHERE phone_no IS NULL;
    ALTER TABLE employees DROP COLUMN IF EXISTS phone;
  END IF;
END $$;

-- -----------------------------------------------
-- 2. เพิ่ม gender_restriction ใน leave_types
-- -----------------------------------------------
ALTER TABLE leave_types
  ADD COLUMN IF NOT EXISTS gender_restriction VARCHAR(1)
    CHECK (gender_restriction IN ('M', 'W'));

-- -----------------------------------------------
-- 3. อัปเดต departments (1=Admin, 2=Sales, 3=Account, 4=HR)
-- -----------------------------------------------
-- รีเซ็ต department_id ของพนักงานที่มีอยู่ก่อน (ป้องกัน FK error)
UPDATE employees SET department_id = NULL;

DELETE FROM departments;

INSERT INTO departments (id, name) VALUES
  (1, 'Admin'),
  (2, 'Sales'),
  (3, 'Account'),
  (4, 'HR');

SELECT setval('departments_id_seq', 4, true);

-- -----------------------------------------------
-- 4. อัปเดต leave_types (6 ประเภทใหม่)
-- -----------------------------------------------
-- ล้างคำขอลาเดิม (test data) ก่อน
DELETE FROM leave_requests;
DELETE FROM leave_types;

INSERT INTO leave_types (id, name, max_days, is_paid, gender_restriction) VALUES
  (1, 'ลาป่วย',      30,  TRUE,  NULL),
  (2, 'ลากิจ',       10,  TRUE,  NULL),
  (3, 'ลาพักผ่อน',   20,  TRUE,  NULL),
  (4, 'ลาคลอด',     120,  TRUE,  'W'),
  (5, 'ลาบวช',       30,  TRUE,  'M');


SELECT setval('leave_types_id_seq', 5, true);

-- -----------------------------------------------
-- 5. อัปเดต role constraint ให้รองรับ admin/employee ชัดเจน
-- -----------------------------------------------
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;
ALTER TABLE employees ADD CONSTRAINT employees_role_check
  CHECK (role IN ('employee', 'admin', 'manager', 'hr'));

-- -----------------------------------------------
-- 6. ตรวจสอบผลลัพธ์
-- -----------------------------------------------
SELECT 'departments' AS tbl, COUNT(*) FROM departments
UNION ALL
SELECT 'leave_types', COUNT(*) FROM leave_types
UNION ALL
SELECT 'employees', COUNT(*) FROM employees;

SELECT id, name, max_days, gender_restriction FROM leave_types ORDER BY id;
SELECT id, name FROM departments ORDER BY id;
