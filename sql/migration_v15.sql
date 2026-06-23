-- ══════════════════════════════════════════════════════
-- Migration v15: Shift Management + Leave Seniority Quota
-- + Admin LINE Users table (ensure exists)
-- ══════════════════════════════════════════════════════

-- 1. ตาราง admin_line_users (ถ้ายังไม่มี)
CREATE TABLE IF NOT EXISTS admin_line_users (
  id           SERIAL PRIMARY KEY,
  line_user_id VARCHAR(50) NOT NULL UNIQUE,
  name         VARCHAR(100),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. ตาราง shifts — กะการทำงาน
CREATE TABLE IF NOT EXISTS shifts (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(50) NOT NULL,          -- เช้า / บ่าย / ดึก
  start_time     TIME NOT NULL,                 -- 08:00
  end_time       TIME NOT NULL,                 -- 17:00
  break_minutes  INT NOT NULL DEFAULT 60,       -- พักกลางวัน นาที
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. ตาราง employee_shifts — กำหนดกะให้พนักงานรายวัน / ค่าเริ่มต้น
CREATE TABLE IF NOT EXISTS employee_shifts (
  id           SERIAL PRIMARY KEY,
  employee_id  INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_id     INT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,  -- เริ่มใช้วันที่
  end_date       DATE,                                 -- NULL = ใช้ไปเรื่อยๆ
  day_of_week    SMALLINT[],                           -- NULL = ทุกวัน, [1,2,3,4,5] = จ-ศ
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, effective_date)
);

-- 4. ตาราง leave_quota_rules — โควต้าลาตามอายุงาน
CREATE TABLE IF NOT EXISTS leave_quota_rules (
  id              SERIAL PRIMARY KEY,
  leave_type_id   INT NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  min_years       NUMERIC(4,1) NOT NULL DEFAULT 0,   -- อายุงานขั้นต่ำ (ปี)
  max_years       NUMERIC(4,1),                       -- NULL = ไม่จำกัด
  quota_days      INT NOT NULL,                       -- จำนวนวันลา
  description     VARCHAR(100),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (leave_type_id, min_years)
);

-- seed กะเริ่มต้น
INSERT INTO shifts (name, start_time, end_time, break_minutes)
VALUES
  ('กะเช้า',  '08:00', '17:00', 60),
  ('กะบ่าย', '13:00', '22:00', 60),
  ('กะดึก',  '22:00', '07:00', 60)
ON CONFLICT DO NOTHING;
