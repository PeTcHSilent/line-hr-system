-- ══════════════════════════════════════════════════════════════
-- Migration v35: โครงสร้างข้อมูลทดลองงานที่ขาดหาย
--
-- อาการ: หน้า "ทดลองงาน" ขึ้น
--   column "probation_start_date" of relation "employees" does not exist
--
-- สาเหตุ: คอลัมน์นี้กับตาราง probation_evaluations ไม่เคยมี migration สร้าง
--   มันถูกสร้างเป็น "ผลพลอยได้" ใน ensureTable() ของ probationEvalRoutes.js
--   ซึ่งทำงานเฉพาะตอนมีคนเรียก /api/probation-eval/* เท่านั้น
--
--   แต่ปุ่ม "กำหนดทดลองงาน" ในหน้าแอดมินยิงไปที่ PUT /api/employee/:id
--   ซึ่งไม่เคยเรียก ensureTable() → ฐานข้อมูลใหม่ที่ยังไม่มีใครเปิดหน้า
--   ประเมินผลเลย จะพังทันทีที่กดบันทึก
--
-- ❗ บทเรียน: การสร้างคอลัมน์ใน route เป็นการพึ่ง "ลำดับที่คนกดใช้งาน"
--   ซึ่งไม่มีใครควบคุมได้ โครงสร้างฐานข้อมูลต้องมาจาก migration เท่านั้น
--   (ensureTable ยังคงไว้ได้ เพราะ IF NOT EXISTS ไม่ทำอันตราย
--    แต่ไม่ใช่ที่พึ่งหลักอีกต่อไป)
--
-- v14 สร้าง probation_end_date กับ probation_status ไว้แล้ว
-- ไฟล์นี้เติมสองอย่างที่เหลือ
-- ══════════════════════════════════════════════════════════════

-- ── 1. วันเริ่มทดลองงาน ───────────────────────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS probation_start_date DATE;

COMMENT ON COLUMN employees.probation_start_date IS
  'วันเริ่มทดลองงาน — ถ้าไม่ระบุ หน้าจอจะ fallback ไปใช้ hire_date';

-- ❗ เติมย้อนหลังให้คนที่กำลังทดลองงานอยู่แต่ยังไม่มีวันเริ่ม
--   ไม่งั้นหน้าทดลองงานจะแสดงช่องว่างทั้งที่มีข้อมูลวันเริ่มงานอยู่แล้ว
--   ใช้ hire_date เพราะตามปกติทดลองงานเริ่มนับวันเดียวกับวันเริ่มงาน
UPDATE employees
   SET probation_start_date = hire_date
 WHERE probation_start_date IS NULL
   AND hire_date IS NOT NULL
   AND probation_status IN ('on_probation', 'extended');

-- ── 2. ตารางประวัติการประเมิน ─────────────────────────────────
-- โครงสร้างต้องตรงกับ ensureTable() ใน probationEvalRoutes.js เป๊ะ ๆ
-- ไม่งั้นฐานข้อมูลที่สร้างจากคนละทางจะมีสคีมาต่างกันแบบหาสาเหตุยาก
CREATE TABLE IF NOT EXISTS probation_evaluations (
  id           SERIAL PRIMARY KEY,
  employee_id  INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  eval_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  eval_score   SMALLINT CHECK (eval_score BETWEEN 1 AND 5),
  eval_result  VARCHAR(20) NOT NULL DEFAULT 'pending'
               CHECK (eval_result IN ('passed','failed','extended','pending')),
  eval_note    TEXT,
  eval_by      VARCHAR(100),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prob_eval_emp
  ON probation_evaluations (employee_id);

-- ค้นหา "ใครกำลังทดลองงานและใกล้ครบกำหนด" ให้เร็ว
CREATE INDEX IF NOT EXISTS idx_employees_probation
  ON employees (probation_status, probation_end_date)
  WHERE is_active = TRUE;

-- ── 3. ตรวจผล ─────────────────────────────────────────────────
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM information_schema.columns
   WHERE table_name='employees' AND column_name='probation_start_date';
  IF n = 1 THEN
    RAISE NOTICE 'probation_start_date พร้อมใช้งานแล้ว';
  ELSE
    RAISE EXCEPTION 'สร้าง probation_start_date ไม่สำเร็จ';
  END IF;
END $$;
