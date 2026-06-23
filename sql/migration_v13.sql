-- migration_v13.sql — Multi-admin LINE users table
-- รองรับการผูก LINE ได้มากกว่า 1 Admin
-- รัน: psql -d hr_db -f migration_v13.sql

-- ตาราง admin LINE ที่ผูกไว้
CREATE TABLE IF NOT EXISTS admin_line_users (
  id            SERIAL PRIMARY KEY,
  line_user_id  VARCHAR(100) NOT NULL UNIQUE,
  display_name  VARCHAR(200) NOT NULL DEFAULT 'Admin',
  linked_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ย้ายข้อมูลเดิมจาก company_settings → admin_line_users (ถ้ามี)
INSERT INTO admin_line_users (line_user_id, display_name, linked_at)
SELECT
  cs1.value                           AS line_user_id,
  COALESCE(cs2.value, 'Admin')        AS display_name,
  NOW()                               AS linked_at
FROM company_settings cs1
LEFT JOIN company_settings cs2 ON cs2.key = 'admin_line_display_name'
WHERE cs1.key = 'admin_line_user_id'
  AND cs1.value IS NOT NULL
  AND cs1.value <> ''
ON CONFLICT (line_user_id) DO NOTHING;

-- ลบ key เก่าออก (ย้ายไปอยู่ใน table แล้ว)
DELETE FROM company_settings WHERE key IN ('admin_line_user_id','admin_line_display_name');
