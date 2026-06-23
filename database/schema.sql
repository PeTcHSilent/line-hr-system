-- ============================================================
-- LINE HR System - Database Schema (PostgreSQL)
-- ============================================================

-- ตารางแผนก
CREATE TABLE departments (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ตารางพนักงาน
CREATE TABLE employees (
  id              SERIAL PRIMARY KEY,
  line_user_id    VARCHAR(100) UNIQUE,          -- LINE User ID (จาก webhook)
  employee_code   VARCHAR(20) UNIQUE NOT NULL,  -- รหัสพนักงาน
  name            VARCHAR(100) NOT NULL,
  email           VARCHAR(150),
  phone           VARCHAR(20),
  department_id   INT REFERENCES departments(id),
  manager_id      INT REFERENCES employees(id), -- หัวหน้า
  role            VARCHAR(20) DEFAULT 'employee' CHECK (role IN ('employee', 'manager', 'hr', 'admin')),
  annual_leave_quota INT DEFAULT 10,            -- วันลาพักร้อนต่อปี (วัน)
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- ประเภทการลา
CREATE TABLE leave_types (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(50) NOT NULL,             -- ลาพักร้อน, ลาป่วย, ลากิจ, ลาคลอด
  max_days    INT,                              -- NULL = ไม่จำกัด
  is_paid     BOOLEAN DEFAULT TRUE
);

-- คำขอลา
CREATE TABLE leave_requests (
  id              SERIAL PRIMARY KEY,
  employee_id     INT NOT NULL REFERENCES employees(id),
  leave_type_id   INT NOT NULL REFERENCES leave_types(id),
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  total_days      NUMERIC(4,1) NOT NULL,
  reason          TEXT,
  status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by     INT REFERENCES employees(id),
  approved_at     TIMESTAMP,
  reject_reason   TEXT,
  line_message_id VARCHAR(200),                -- เก็บ message ID สำหรับ update Flex Message
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- บันทึกการเช็คอิน/เช็คเอาท์
CREATE TABLE attendance (
  id              SERIAL PRIMARY KEY,
  employee_id     INT NOT NULL REFERENCES employees(id),
  work_date       DATE NOT NULL,
  check_in        TIMESTAMP,
  check_out       TIMESTAMP,
  check_in_lat    NUMERIC(10,7),              -- GPS latitude
  check_in_lng    NUMERIC(10,7),
  check_out_lat   NUMERIC(10,7),
  check_out_lng   NUMERIC(10,7),
  check_in_type   VARCHAR(20) DEFAULT 'app' CHECK (check_in_type IN ('app', 'qr', 'manual')),
  note            TEXT,
  created_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE(employee_id, work_date)
);

-- บันทึก OT
CREATE TABLE ot_records (
  id              SERIAL PRIMARY KEY,
  employee_id     INT NOT NULL REFERENCES employees(id),
  ot_date         DATE NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  total_hours     NUMERIC(4,2) NOT NULL,
  reason          TEXT NOT NULL,
  status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by     INT REFERENCES employees(id),
  approved_at     TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- ประกาศ / ข่าวสาร
CREATE TABLE announcements (
  id              SERIAL PRIMARY KEY,
  title           VARCHAR(200) NOT NULL,
  body            TEXT NOT NULL,
  target_dept_id  INT REFERENCES departments(id), -- NULL = ทุกแผนก
  created_by      INT REFERENCES employees(id),
  is_pinned       BOOLEAN DEFAULT FALSE,
  published_at    TIMESTAMP DEFAULT NOW(),
  expires_at      TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- =====================
-- ข้อมูลเริ่มต้น
-- =====================
INSERT INTO departments (name) VALUES
  ('IT'), ('HR'), ('Finance'), ('Operations'), ('Marketing');

INSERT INTO leave_types (name, max_days, is_paid) VALUES
  ('ลาพักร้อน',  10, TRUE),
  ('ลาป่วย',     30, TRUE),
  ('ลากิจ',       3, TRUE),
  ('ลาคลอด',     90, TRUE),
  ('ลาไม่รับเงิน', NULL, FALSE);

-- =====================
-- Index สำหรับ Query
-- =====================
CREATE INDEX idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX idx_leave_requests_status   ON leave_requests(status);
CREATE INDEX idx_attendance_employee     ON attendance(employee_id);
CREATE INDEX idx_attendance_date         ON attendance(work_date);
CREATE INDEX idx_ot_records_employee     ON ot_records(employee_id);
CREATE INDEX idx_employees_line          ON employees(line_user_id);
