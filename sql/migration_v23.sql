-- ══════════════════════════════════════════════════════════════
-- Migration v23: อัปเดตรหัสพนักงาน TK000 → TK0000 (4 หลัก)
-- รัน: psql $DATABASE_URL -f sql/migration_v23.sql
-- ══════════════════════════════════════════════════════════════

-- แสดงรายการก่อน UPDATE (ตรวจสอบ)
SELECT employee_code,
       'TK' || LPAD(SUBSTRING(employee_code FROM 3), 4, '0') AS new_code
FROM employees
WHERE employee_code ~ '^TK[0-9]{3}$'
ORDER BY employee_code;

-- อัปเดตรหัสพนักงานที่มี 3 หลัก → 4 หลัก
-- ตัวอย่าง: TK001 → TK0001, TK012 → TK0012, TK099 → TK0099
UPDATE employees
SET employee_code = 'TK' || LPAD(SUBSTRING(employee_code FROM 3), 4, '0')
WHERE employee_code ~ '^TK[0-9]{3}$';

-- ยืนยันผลลัพธ์
SELECT id, employee_code, name
FROM employees
WHERE employee_code ~ '^TK[0-9]{4}$'
ORDER BY employee_code;
