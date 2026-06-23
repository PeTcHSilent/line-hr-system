-- migration_v9.sql
-- Payroll records, attendance warnings, and new company settings

-- ===== payroll_records =====
CREATE TABLE IF NOT EXISTS payroll_records (
  id              SERIAL PRIMARY KEY,
  employee_id     INT NOT NULL REFERENCES employees(id),
  year            INT NOT NULL,
  month           INT NOT NULL,
  salary          NUMERIC(12,2) DEFAULT 0,
  ot_pay          NUMERIC(12,2) DEFAULT 0,
  ot_hours        NUMERIC(6,2)  DEFAULT 0,
  gross_income    NUMERIC(12,2) DEFAULT 0,
  social_security NUMERIC(12,2) DEFAULT 0,
  provident_fund  NUMERIC(12,2) DEFAULT 0,
  tax_withholding NUMERIC(12,2) DEFAULT 0,
  total_deduction NUMERIC(12,2) DEFAULT 0,
  net_income      NUMERIC(12,2) DEFAULT 0,
  late_days       INT DEFAULT 0,
  absent_days     INT DEFAULT 0,
  status          VARCHAR(20) DEFAULT 'draft',  -- draft | confirmed | paid
  paid_at         TIMESTAMPTZ,
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_payroll_employee_month UNIQUE(employee_id, year, month)
);

-- ===== attendance_warnings =====
CREATE TABLE IF NOT EXISTS attendance_warnings (
  id              SERIAL PRIMARY KEY,
  employee_id     INT NOT NULL REFERENCES employees(id),
  warning_date    DATE NOT NULL,
  warning_type    VARCHAR(20) NOT NULL,  -- 'late' | 'absent'
  minutes_late    INT DEFAULT 0,
  notified_line   BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_warning_per_day UNIQUE(employee_id, warning_date, warning_type)
);

-- ===== new company_settings keys =====
INSERT INTO company_settings (key, value, description) VALUES
  ('tax_rate',               '5',     'อัตราภาษีหัก ณ ที่จ่าย (%)'),
  ('social_security_rate',   '5',     'อัตราประกันสังคม (%)'),
  ('social_security_max',    '750',   'ประกันสังคมสูงสุดต่อเดือน (บาท)'),
  ('provident_fund_enabled', 'false', 'เปิดใช้กองทุนสำรองเลี้ยงชีพ (true/false)'),
  ('provident_fund_rate',    '5',     'อัตรากองทุนสำรองเลี้ยงชีพ (%)'),
  ('late_grace_minutes',     '15',    'นาทีผ่อนผันการมาสาย'),
  ('late_warning_enabled',   'true',  'แจ้งเตือน LINE เมื่อพนักงานมาสาย/ขาด')
ON CONFLICT (key) DO NOTHING;

-- ===== fix reminderCron holiday column (holiday_date → date) =====
-- (no SQL change needed — this is a code fix in reminderCron.js)
