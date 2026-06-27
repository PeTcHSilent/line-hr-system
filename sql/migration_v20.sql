-- ══════════════════════════════════════════════════════════════
-- Migration v20: citizen_id สำหรับ ภ.ง.ด.1 / ภ.ง.ด.1ก
-- รัน: psql $DATABASE_URL -f sql/migration_v20.sql
-- ══════════════════════════════════════════════════════════════

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS citizen_id   VARCHAR(13),   -- เลขบัตรประชาชน 13 หลัก
  ADD COLUMN IF NOT EXISTS name_prefix  VARCHAR(20),   -- คำนำหน้า: นาย, นาง, น.ส.
  ADD COLUMN IF NOT EXISTS tax_id       VARCHAR(13);   -- เลขประจำตัวผู้เสียภาษี (ถ้าต่างจาก citizen_id)

COMMENT ON COLUMN employees.citizen_id  IS 'เลขบัตรประชาชน 13 หลัก ใช้สำหรับ ภ.ง.ด.1/ภ.ง.ด.1ก';
COMMENT ON COLUMN employees.name_prefix IS 'คำนำหน้าชื่อ: นาย, นาง, น.ส., ดร., อื่นๆ';
COMMENT ON COLUMN employees.tax_id      IS 'เลขประจำตัวผู้เสียภาษี ถ้าว่างใช้ citizen_id แทน';
