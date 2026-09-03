-- ══════════════════════════════════════════════════════════════
-- Migration v28: ระบบหักเงินรายได้พนักงานรายเดือน (หลายรายการ/หมวดหมู่)
--
-- payroll_deductions: บันทึกรายการหักเงินย่อย ต่อพนักงาน ต่อเดือน
--   category: uniform | loan_repay | fine | equipment | advance | other
--   amount:   จำนวนเงินที่หัก (บาท)
--   note:     หมายเหตุ/รายละเอียดเพิ่มเติม (บังคับกรอกถ้า category = other)
--
-- payroll_records.other_deduction: ยอดรวมหักอื่นๆ ที่ snapshot ไว้ตอนคำนวณ payroll
--   (รวมกับ late_deduction/absent_deduction/social_security/provident_fund/tax_withholding
--    เป็น total_deduction เหมือนเดิม)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS payroll_deductions (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  year        INTEGER NOT NULL,
  month       INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  category    VARCHAR(30) NOT NULL DEFAULT 'other'
                CHECK (category IN ('uniform','loan_repay','fine','equipment','advance','other')),
  amount      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  note        TEXT,
  created_by  INTEGER REFERENCES employees(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_deductions_emp_ym
  ON payroll_deductions(employee_id, year, month);

COMMENT ON TABLE payroll_deductions IS
  'รายการหักเงินรายได้พนักงานต่อเดือน แบบหลายรายการแยกตามหมวดหมู่ (เพิ่มเติมจาก late/absent/SS/PF/tax ที่คำนวณอัตโนมัติ)';
COMMENT ON COLUMN payroll_deductions.category IS
  'uniform=ค่าเครื่องแบบ | loan_repay=คืนเงินยืม | fine=ค่าปรับ/ค่าเสียหาย | equipment=ค่าอุปกรณ์/ทรัพย์สินสูญหาย | advance=หักเงินเบิกล่วงหน้า | other=อื่นๆ';

ALTER TABLE payroll_records
  ADD COLUMN IF NOT EXISTS other_deduction NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN payroll_records.other_deduction IS
  'ยอดรวมรายการหักจาก payroll_deductions ณ ตอนคำนวณ payroll เดือนนี้ (snapshot)';
