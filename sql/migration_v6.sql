-- ============================================================
-- migration_v6.sql
-- 1. เพิ่ม salary ให้ employees
-- 2. สร้าง broadcast_log
-- ============================================================

-- 1. เพิ่มคอลัมน์ salary ใน employees
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS salary          NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ot_rate_type    VARCHAR(10)   DEFAULT 'daily'
  -- daily  = คำนวณจาก salary/30 × 1.5/3/ชั่วโมง
  -- hourly = ใส่อัตราต่อชั่วโมงตรงๆ
;

-- 2. ตาราง broadcast_log
CREATE TABLE IF NOT EXISTS broadcast_log (
  id           SERIAL PRIMARY KEY,
  title        VARCHAR(200)  NOT NULL DEFAULT 'ประกาศ',
  message      TEXT          NOT NULL,
  total_sent   INT           NOT NULL DEFAULT 0,
  total_failed INT           NOT NULL DEFAULT 0,
  sent_at      TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ตัวอย่างการคำนวณ OT Pay
-- OT วันทำงานปกติ  (เกิน 8 ชั่วโมง) = 1.5 × อัตราต่อชั่วโมง
-- OT วันหยุดในเวลา                    = 2.0 × อัตราต่อชั่วโมง
-- OT วันหยุดนอกเวลา                   = 3.0 × อัตราต่อชั่วโมง
-- อัตราต่อชั่วโมง = salary / 30 / 8
-- ============================================================
