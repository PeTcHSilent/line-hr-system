-- ══════════════════════════════════════════════════════════════
-- Migration v34: ปล่อยรหัสพนักงานคืนเมื่อพนักงานลาออก
--
-- ปัญหา: employee_code เป็น UNIQUE ทั้งตาราง
--   พนักงานที่กดเป็น "ออก" แล้ว (is_active = FALSE) ยังจองรหัสไว้
--   พอรับคนใหม่แล้วอยากใช้รหัสเดิม จะเจอ
--     duplicate key value violates unique constraint "employees_employee_code_key"
--   ซึ่งไม่มีทางแก้จากหน้าเว็บเลย ต้องเข้าฐานข้อมูลไปแก้มือ
--
-- วิธีแก้: เปลี่ยนเป็น partial unique index — บังคับไม่ซ้ำเฉพาะ
--   "คนที่ยังทำงานอยู่" เท่านั้น
--
-- ❗ ทำไมไม่เปลี่ยนรหัสคนเก่าเป็น TK1010-OUT-xxxx
--   เพราะรายงานย้อนหลัง (สลิปเงินเดือน ภ.ง.ด.1 ประวัติการลา) จะเพี้ยน
--   พนักงานที่เคยได้สลิปรหัส TK1010 ต้องยังเป็น TK1010 ตลอดไป
--   การเก็บรหัสจริงไว้คือการรักษาความถูกต้องของเอกสารที่ออกไปแล้ว
--
-- ❗ ผลข้างเคียงที่ต้องรู้: รายงานข้ามปีอาจมี TK1010 สองคน
--   จึงต้องดูคู่กับ "ชื่อ" เสมอ ไม่ใช้รหัสอย่างเดียวในการอ้างอิงคน
--   (โค้ดในระบบอ้างอิงด้วย employees.id อยู่แล้ว ไม่ได้ใช้รหัส จึงไม่กระทบ)
-- ══════════════════════════════════════════════════════════════

-- ── 1. ถอด UNIQUE เดิมออก ─────────────────────────────────────
-- ❗ ชื่อ constraint อาจต่างกันตามว่าตารางถูกสร้างมาอย่างไร
--   จึงหาจาก catalog แทนที่จะเดาชื่อ แล้ว DROP ทุกตัวที่เป็น
--   unique บนคอลัมน์ employee_code คอลัมน์เดียว
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY (con.conkey)
     WHERE rel.relname = 'employees'
       AND con.contype = 'u'
       AND array_length(con.conkey, 1) = 1
       AND att.attname = 'employee_code'
  LOOP
    EXECUTE format('ALTER TABLE employees DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'ถอด constraint % ออกแล้ว', c.conname;
  END LOOP;
END $$;

-- unique index ที่ไม่ได้มาจาก constraint (เผื่อเคยสร้างมือไว้)
DROP INDEX IF EXISTS employees_employee_code_key;
DROP INDEX IF EXISTS idx_employees_code_unique;

-- ── 2. partial unique — ห้ามซ้ำเฉพาะคนที่ยังทำงานอยู่ ─────────
-- ❗ UPPER() เพื่อกัน tk1010 กับ TK1010 เล็ดลอดเข้ามาเป็นคนละรหัส
--   ระบบค้นหาด้วย UPPER อยู่แล้วในบางจุด ถ้าปล่อยให้ต่างกันได้
--   จะเกิดสองคนที่ "รหัสเดียวกันในสายตาคน" แต่ฐานข้อมูลมองว่าต่าง
CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_code_active
  ON employees (UPPER(employee_code))
  WHERE is_active = TRUE;

COMMENT ON INDEX uq_employees_code_active IS
  'รหัสพนักงานห้ามซ้ำเฉพาะในกลุ่มที่ยังทำงานอยู่ — คนที่ออกแล้วคืนรหัสให้คนใหม่ใช้ได้';

-- ค้นหารหัสเร็วแม้คนออกแล้ว (ใช้ตอนดูประวัติย้อนหลัง)
CREATE INDEX IF NOT EXISTS idx_employees_code_all ON employees (UPPER(employee_code));

-- ── 3. ข้อมูลการลาออก ─────────────────────────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS resign_date   DATE,
  ADD COLUMN IF NOT EXISTS resign_reason TEXT,
  ADD COLUMN IF NOT EXISTS resigned_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resigned_by   VARCHAR(100);

COMMENT ON COLUMN employees.resign_date   IS 'วันสุดท้ายที่ทำงาน (ใช้คิดเงินเดือนงวดสุดท้าย)';
COMMENT ON COLUMN employees.resigned_at   IS 'เวลาที่กดปุ่ม "ออก" ในระบบ — คนละอย่างกับ resign_date';

-- ── 4. ตรวจว่ามีรหัสซ้ำในกลุ่มคนที่ยังทำงานอยู่หรือไม่ ────────
-- ❗ ถ้ามีข้อมูลซ้ำอยู่ก่อน index จะสร้างไม่ผ่านและ migration ล้ม
--   บล็อกนี้จึงรายงานให้เห็นก่อน ไม่ปล่อยให้ error ลอย ๆ ที่อ่านไม่รู้เรื่อง
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM (
    SELECT UPPER(employee_code) FROM employees WHERE is_active = TRUE
     GROUP BY UPPER(employee_code) HAVING COUNT(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE WARNING 'พบรหัสซ้ำในพนักงานที่ยังทำงานอยู่ % รหัส — ต้องแก้ก่อน', n;
  END IF;
END $$;
