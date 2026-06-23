-- Migration v14: Bank Transfer, Probation Tracking, Leave Carryover, Expense Claims
-- Run: psql $DATABASE_URL -f sql/migration_v14.sql

-- =============================================
-- 1. Bank account fields for employees
-- =============================================
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS bank_name        VARCHAR(100),   -- ชื่อธนาคาร เช่น KBank, SCB, BBL
  ADD COLUMN IF NOT EXISTS bank_branch      VARCHAR(100),   -- สาขา
  ADD COLUMN IF NOT EXISTS bank_account_no  VARCHAR(20),    -- เลขบัญชี
  ADD COLUMN IF NOT EXISTS bank_account_name VARCHAR(150);  -- ชื่อบัญชี (อาจต่างจาก name)

-- =============================================
-- 2. Probation Tracking fields for employees
-- =============================================
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS probation_end_date  DATE,
  ADD COLUMN IF NOT EXISTS probation_status    VARCHAR(20) DEFAULT 'on_probation'
    CHECK (probation_status IN ('on_probation', 'passed', 'failed', 'extended'));

COMMENT ON COLUMN employees.probation_status IS 'on_probation|passed|failed|extended';

-- =============================================
-- 3. Leave Carryover Log
-- =============================================
CREATE TABLE IF NOT EXISTS leave_carryover_log (
  id              SERIAL PRIMARY KEY,
  employee_id     INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  from_year       INT NOT NULL,
  to_year         INT NOT NULL,
  carried_days    NUMERIC(5,1) NOT NULL DEFAULT 0,   -- จำนวนวันที่นำข้ามปี
  used_days       NUMERIC(5,1) NOT NULL DEFAULT 0,   -- วันลาพักร้อนที่ใช้ไปในปีนั้น
  quota_days      INT NOT NULL DEFAULT 0,             -- โควต้าต่อปีของพนักงาน
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_carryover_unique
  ON leave_carryover_log(employee_id, from_year, to_year);

COMMENT ON TABLE leave_carryover_log IS 'ประวัติการนำวันลาพักร้อนข้ามปี';

-- =============================================
-- 4. Expense Claims
-- =============================================
CREATE TABLE IF NOT EXISTS expense_claims (
  id              SERIAL PRIMARY KEY,
  employee_id     INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  claim_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  category        VARCHAR(50) NOT NULL DEFAULT 'other',
    -- travel | meal | accommodation | medical | communication | other
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  description     TEXT NOT NULL,
  receipt_url     TEXT,                        -- URL รูปใบเสร็จ (optional)
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
  approved_by     INT REFERENCES employees(id),
  approved_at     TIMESTAMPTZ,
  reject_reason   TEXT,
  payroll_year    INT,                         -- ถูกรวมใน payroll ปีใด
  payroll_month   INT,                         -- ถูกรวมใน payroll เดือนใด
  notes           TEXT,                        -- หมายเหตุ admin
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expense_employee ON expense_claims(employee_id);
CREATE INDEX IF NOT EXISTS idx_expense_status   ON expense_claims(status);
CREATE INDEX IF NOT EXISTS idx_expense_payroll  ON expense_claims(payroll_year, payroll_month);

COMMENT ON TABLE expense_claims IS 'คำขอเบิกค่าใช้จ่าย';
