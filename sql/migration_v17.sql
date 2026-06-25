-- migration_v17.sql — Configurable OT rates + weekend_ot_hours column
-- รัน: psql -d hr_db -f sql/migration_v17.sql

-- 1. เพิ่ม column weekend_ot_hours ใน payroll_records (เก็บชั่วโมง OT วันหยุดสัปดาห์)
ALTER TABLE payroll_records
  ADD COLUMN IF NOT EXISTS weekend_ot_hours NUMERIC(8,2) NOT NULL DEFAULT 0;

-- 2. เพิ่ม OT rate settings ใน company_settings
--    (ค่าเริ่มต้น: วันธรรมดา ×1.5, วันหยุดสัปดาห์ ×1.5, วันหยุดนักขัตฤกษ์ ×3.0)
INSERT INTO company_settings (key, value, description, updated_at)
VALUES
  ('ot_rate_weekday', '1.0',  'ตัวคูณ OT วันธรรมดา',           NOW()),
  ('ot_rate_weekend', '1.0',  'ตัวคูณ OT วันหยุดสัปดาห์',       NOW()),
  ('ot_rate_holiday', '1.0',  'ตัวคูณ OT วันหยุดนักขัตฤกษ์',    NOW())
ON CONFLICT (key) DO NOTHING;
