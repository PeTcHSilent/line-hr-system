-- ══════════════════════════════════════════════════════════════
-- Migration v33: ปรับพนักงานปัจจุบันเป็น "พนักงานประจำ" + วันลาพักร้อน 5 วัน
-- ══════════════════════════════════════════════════════════════
-- นี่เป็น migration แก้ "ข้อมูล" ไม่ใช่แก้โครงสร้างตาราง
-- migrate.js จะจำว่ารันไปแล้ว จึงไม่ย้อนมาทับข้อมูลใหม่ในอนาคต
--
-- ❗ พนักงานที่เพิ่มเข้าระบบ "หลังจากนี้" จะยังเริ่มที่ on_probation ตามปกติ
--    (เป็นค่า default ของคอลัมน์) ไฟล์นี้มีผลกับคนที่มีอยู่ ณ ตอนรันเท่านั้น
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. พนักงานทุกคนที่ยังทำงานอยู่ → พนักงานประจำ ──────────────
-- ครอบคลุมทั้ง on_probation, extended และค่า NULL (พนักงานเก่าก่อนมีระบบนี้)
-- ไม่แตะคนที่ is_active = FALSE (ลาออกไปแล้ว) และไม่แตะคนที่ failed
-- เพราะสองกลุ่มนั้นการเปลี่ยนเป็น passed จะทำให้ประวัติเพี้ยน
UPDATE employees
SET    probation_status = 'passed',
       updated_at       = NOW()
WHERE  is_active = TRUE
  AND  (probation_status IS NULL OR probation_status IN ('on_probation', 'extended'));

-- ── 2. ลาพักร้อน เหลือ 5 วัน/ปี ───────────────────────────────
UPDATE leave_types
SET    max_days = 5
WHERE  name = 'ลาพักร้อน';

-- ❗ getLeaveBalance() ใช้ leave_quota_rules ก่อน ถ้ามีกฎที่ตรงกับอายุงาน
--    แล้วค่อย fallback มาที่ max_days
--    ถ้ามีกฎค้างอยู่แล้วไม่แก้ด้วย ตัวเลขที่พนักงานเห็นจะไม่ใช่ 5
--    (ตอนเขียนไฟล์นี้หน้า "โควตาลาตามอายุงาน" ยังว่าง — บรรทัดนี้กันไว้เผื่อ)
UPDATE leave_quota_rules
SET    quota_days = 5
WHERE  leave_type_id IN (SELECT id FROM leave_types WHERE name = 'ลาพักร้อน');

COMMIT;

-- ══════════════════════════════════════════════════════════════
-- ตรวจผลหลังรัน — คัดลอกไปรันใน pgAdmin ได้
-- ══════════════════════════════════════════════════════════════
-- SELECT probation_status, COUNT(*)
-- FROM   employees WHERE is_active = TRUE
-- GROUP  BY probation_status;
--
-- SELECT name, max_days, allowed_during_probation
-- FROM   leave_types ORDER BY id;
-- ══════════════════════════════════════════════════════════════
