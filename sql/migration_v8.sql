-- migration_v8.sql: Company Work Schedule Settings
CREATE TABLE IF NOT EXISTS company_settings (
  key         VARCHAR(50) PRIMARY KEY,
  value       TEXT        NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO company_settings (key, value, description) VALUES
  ('work_days',    '1,2,3,4,5,6', 'วันทำงาน (0=อาทิตย์, 1=จันทร์, 2=อังคาร, 3=พุธ, 4=พฤหัสบดี, 5=ศุกร์, 6=เสาร์)'),
  ('work_start',   '09:00',       'เวลาเริ่มงาน'),
  ('work_end',     '18:00',       'เวลาเลิกงาน'),
  ('lunch_start',  '12:00',       'เวลาเริ่มพักกลางวัน'),
  ('lunch_end',    '13:00',       'เวลาเลิกพักกลางวัน'),
  ('company_name', 'ต่อกัน Insurance Broker', 'ชื่อบริษัท')
ON CONFLICT (key) DO NOTHING;
