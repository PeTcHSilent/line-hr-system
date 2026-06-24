-- migration_v16.sql — Multi-branch support
-- สร้างตาราง branches และผูก branch_id กับ employees
-- รัน: psql -d hr_db -f migration_v16.sql

-- ตารางสาขา
CREATE TABLE IF NOT EXISTS branches (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(200) NOT NULL,
  address        TEXT,
  lat            DECIMAL(10,7),
  lng            DECIMAL(10,7),
  radius_meters  INT NOT NULL DEFAULT 300,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- เพิ่ม branch_id ให้ employees (1 คน → 1 สาขา)
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS branch_id INT REFERENCES branches(id) ON DELETE SET NULL;

-- สร้าง index เพื่อ query เร็ว
CREATE INDEX IF NOT EXISTS idx_employees_branch_id ON employees(branch_id);

-- สร้างสาขาหลักจากค่า ENV เดิม (ใส่ lat/lng ที่ใช้จริง)
-- Admin จะแก้ไขได้ผ่านหน้า Branch Management ในภายหลัง
INSERT INTO branches (name, address, lat, lng, radius_meters)
VALUES ('สำนักงานใหญ่', 'ที่อยู่สำนักงานใหญ่', 13.7341691, 100.5142900, 300)
ON CONFLICT DO NOTHING;
