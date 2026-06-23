-- migration_v11.sql — เพิ่ม half-day leave
-- รัน: psql -d hr_db -f sql/migration_v11.sql

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS is_half_day   BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS half_day_period VARCHAR(10) DEFAULT NULL
    CHECK (half_day_period IN ('morning', 'afternoon'));

-- ตรวจสอบ
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'leave_requests'
  AND column_name IN ('is_half_day', 'half_day_period');
