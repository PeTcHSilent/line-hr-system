-- ══════════════════════════════════════════════════════════════
-- Migration v27: เพิ่ม holiday_type ในตาราง holidays
--   'public'  = วันหยุดนักขัตฤกษ์ทั่วไป (กำหนดโดยราชการ)
--   'company' = วันหยุดเพิ่มเติมที่บริษัทกำหนด
--
-- ระบบ cron จะข้ามการแจ้งเตือนเช็คอิน/เช็คเอาท์ทั้งสองประเภท
-- ══════════════════════════════════════════════════════════════

ALTER TABLE holidays
  ADD COLUMN IF NOT EXISTS holiday_type VARCHAR(20) NOT NULL DEFAULT 'public'
    CHECK (holiday_type IN ('public', 'company'));

COMMENT ON COLUMN holidays.holiday_type IS
  '''public'' = วันหยุดนักขัตฤกษ์ราชการ | ''company'' = วันหยุดเพิ่มเติมที่บริษัทกำหนด';

-- ทุกแถวที่มีอยู่แล้วเป็น public holidays
UPDATE holidays SET holiday_type = 'public' WHERE holiday_type IS NULL OR holiday_type = 'public';

-- Index ช่วย filter ตาม type ได้เร็ว
CREATE INDEX IF NOT EXISTS idx_holidays_type ON holidays(holiday_type);
