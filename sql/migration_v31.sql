-- ══════════════════════════════════════════════════════════════
-- Migration v31: รับประกันว่าคอลัมน์ภาษี (ภ.ง.ด.1 / ภ.ง.ด.1ก) มีจริง
-- ══════════════════════════════════════════════════════════════
-- ที่มา: sql/migration_v20.sql เพิ่มคอลัมน์ชุดนี้ไว้
--   แต่ database/migration_v20.sql (ไฟล์ stub ที่เป็นคอมเมนต์เปล่า)
--   มีชื่อซ้ำกัน และ migrate.js ตัด duplicate ด้วย "ชื่อไฟล์"
--   โดยเอา database/ ขึ้นก่อน → ตัวจริงใน sql/ ไม่เคยถูกรันผ่าน runner
--
--   ถ้าคอลัมน์มีอยู่แล้ว (เคยรันมือผ่าน psql) คำสั่งนี้ไม่ทำอะไร
--   เพราะใช้ ADD COLUMN IF NOT EXISTS — รันซ้ำได้ปลอดภัย
-- ══════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS citizen_id   VARCHAR(13),
  ADD COLUMN IF NOT EXISTS name_prefix  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS tax_id       VARCHAR(13);

COMMENT ON COLUMN employees.citizen_id  IS 'เลขบัตรประชาชน 13 หลัก ใช้สำหรับ ภ.ง.ด.1/ภ.ง.ด.1ก';
COMMENT ON COLUMN employees.name_prefix IS 'คำนำหน้าชื่อ: นาย, นาง, น.ส., ดร., อื่นๆ';
COMMENT ON COLUMN employees.tax_id      IS 'เลขประจำตัวผู้เสียภาษี (ถ้าต่างจาก citizen_id)';

COMMIT;
