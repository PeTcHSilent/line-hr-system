-- ============================================================
-- Migration V4 - Attendance GPS Enhancement
-- วิธีใช้: เปิด pgAdmin → เลือก hr_db → Query Tool → วาง SQL นี้ → Run
-- ============================================================

-- เพิ่มคอลัมน์ GPS distance และ status ในตาราง attendance
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS check_in_distance  NUMERIC(10,2),  -- ระยะห่างจากออฟฟิศ (เมตร) ตอน check-in
  ADD COLUMN IF NOT EXISTS check_out_distance NUMERIC(10,2),  -- ระยะห่างจากออฟฟิศ (เมตร) ตอน check-out
  ADD COLUMN IF NOT EXISTS check_in_within_radius  BOOLEAN DEFAULT NULL,  -- อยู่ในรัศมีหรือไม่ (check-in)
  ADD COLUMN IF NOT EXISTS check_out_within_radius BOOLEAN DEFAULT NULL,  -- อยู่ในรัศมีหรือไม่ (check-out)
  ADD COLUMN IF NOT EXISTS note TEXT;  -- หมายเหตุ (admin ใส่ได้)

-- สร้าง index สำหรับ work_date (ใช้บ่อยใน admin)
CREATE INDEX IF NOT EXISTS idx_attendance_work_date ON attendance(work_date);
CREATE INDEX IF NOT EXISTS idx_attendance_employee_work_date ON attendance(employee_id, work_date);

-- ตรวจสอบโครงสร้างหลังแก้ไข
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'attendance'
-- ORDER BY ordinal_position;
