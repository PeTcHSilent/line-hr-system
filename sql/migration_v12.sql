-- Migration v12: เพิ่ม fields สำหรับฟอร์มบัญชีคำนวณค่าจ้าง
ALTER TABLE payroll_records
  ADD COLUMN IF NOT EXISTS weekday_ot_hours   NUMERIC(8,2)   DEFAULT 0,
  ADD COLUMN IF NOT EXISTS holiday_ot_hours   NUMERIC(8,2)   DEFAULT 0,
  ADD COLUMN IF NOT EXISTS special_allowance  NUMERIC(12,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS special_allowance_note TEXT,
  ADD COLUMN IF NOT EXISTS absent_deduction   NUMERIC(12,2)  DEFAULT 0;

-- เพิ่ม flag หักเงินรายวันเมื่อขาดงาน ในตาราง employees
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS deduct_absent BOOLEAN DEFAULT TRUE;

COMMENT ON COLUMN employees.deduct_absent IS 'TRUE = หักเงินรายวันเมื่อขาดงาน (salary/30 × จำนวนวันขาด)';
