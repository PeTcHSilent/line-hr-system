-- ══════════════════════════════════════════════════════════════
-- OPS: ย้ายรหัสพนักงาน  มุกธิดา แป้นแก้ว  TK1012 → TK1007
-- รันบน: ฐานข้อมูล HR (line-hr-system)   ลำดับที่ 1 จาก 2
-- ══════════════════════════════════════════════════════════════
-- เหตุผล: ต้องการปล่อย TK1012 และ TK1013 ให้พนักงานใหม่
--
-- ❗ นี่ไม่ใช่ migration — เป็นสคริปต์แก้ข้อมูลครั้งเดียว
--    จึงอยู่ใน sql/ops/ ไม่ใช่ sql/migration_vNN.sql
--    (ถ้าใส่เป็น migration ระบบจะพยายามรันซ้ำบนฐานใหม่ทุกครั้ง)
--
-- ❗ ทำไมแก้ได้โดยไม่พังอะไรในระบบ HR
--    ทุกตารางใน HR (ลงเวลา ลา เงินเดือน เอกสาร ทรัพย์สิน เบิกจ่าย)
--    อ้างอิงด้วย employees.id ไม่ใช่ employee_code
--    ตรวจแล้ว: ไม่มีคอลัมน์ employee_code ในตารางอื่นเลย
--
-- ❗ สิ่งที่ "ไม่" แก้ และตั้งใจไม่แก้
--    - audit_logs — เป็นบันทึกว่าตอนนั้นระบบเห็นอะไร ห้ามแก้ย้อนหลัง
--    - payroll_snapshots / comm_run_items ในระบบบัญชี
--      งวดที่ปิดแล้วถูกแช่แข็งไว้โดยตั้งใจ (ดู migration_v1 ของ line-accounting)
--
-- ❗ ผลข้างเคียงที่ต้องรับทราบ — เลือกไว้แล้วว่ายอมรับ
--    พนักงานใหม่จะใช้ TK1012 ซ้ำ ดังนั้นรายงานบัญชีย้อนหลัง
--    จะมี "TK1012" สองคน: งวดก่อนวันที่รันสคริปต์นี้ = มุกธิดา
--    งวดหลังจากนั้น = พนักงานใหม่  → ต้องดูคู่กับชื่อเสมอ
--    (ดูคำสั่งตรวจสอบท้ายไฟล์ — บันทึกผลเก็บไว้ก่อนรับคนใหม่)
--
-- ❗ ลำดับสำคัญ
--    1. รันไฟล์นี้บนฐาน HR
--    2. รัน line-sales-bot/sql/ops/rename_TK1012_to_TK1007.sql บนฐาน Sales
--    3. จึงค่อยเพิ่มพนักงานใหม่ TK1012 / TK1013
--    ถ้าเพิ่มคนใหม่ก่อน จะติด unique index uq_employees_code_active ทันที
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- ── ด่าน 0: กันรันผิดฐานข้อมูล ────────────────────────────────
-- ❗ อยู่นอก BEGIN โดยตั้งใจ จะได้เห็นข้อความนี้ชัด ๆ
--    ไม่ใช่ "relation employees does not exist" ที่อ่านไม่รู้ว่าผิดตรงไหน
DO $$ BEGIN
  IF to_regclass('public.employees') IS NULL THEN
    RAISE EXCEPTION E'\n\n  *** รันผิดฐานข้อมูล ***\n  ไฟล์นี้ต้องรันบนฐาน HR\n  ฐานที่เชื่อมอยู่ตอนนี้คือ "%" ซึ่งไม่มีตาราง employees\n  → เปิดแท็บของ TORKUN_HR_RAILWAY แล้วรันใหม่\n', current_database();
  END IF;
  IF to_regclass('public.admin_users') IS NOT NULL
     AND to_regclass('public.inbox_conversations') IS NOT NULL THEN
    RAISE EXCEPTION E'\n\n  *** รันผิดฐานข้อมูล ***\n  ฐาน "%" มีตารางของระบบ Sales อยู่ — นี่คือฐาน Sales ไม่ใช่ HR\n', current_database();
  END IF;
  RAISE NOTICE 'ฐานข้อมูลถูกต้อง: % (ระบบ HR)', current_database();
END $$;

-- ── ด่านตรวจก่อนแก้ ───────────────────────────────────────────
-- ❗ ไม่ใช้ UPDATE ... WHERE เฉย ๆ เพราะถ้าไม่เจอแถว มันจะ "สำเร็จ"
--    โดยไม่แก้อะไรเลย แล้วเราจะเข้าใจผิดว่าย้ายแล้ว
DO $$
DECLARE
  v_id   INT;
  v_name TEXT;
  n      INT;
BEGIN
  -- 1. ต้องมี TK1012 ที่ยังทำงานอยู่ จริง ๆ
  SELECT id, name INTO v_id, v_name
    FROM employees
   WHERE UPPER(employee_code) = 'TK1012' AND is_active = TRUE;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบพนักงานรหัส TK1012 ที่ยังทำงานอยู่ — ยกเลิกทั้งหมด';
  END IF;

  -- 2. กันแก้ผิดคน — ชื่อต้องตรง
  IF v_name NOT LIKE '%มุกธิดา%' THEN
    RAISE EXCEPTION 'TK1012 คือ "%" ไม่ใช่มุกธิดา — ยกเลิกทั้งหมด', v_name;
  END IF;

  -- 3. TK1007 ต้องว่าง (ในกลุ่มคนที่ยังทำงานอยู่)
  SELECT COUNT(*) INTO n
    FROM employees
   WHERE UPPER(employee_code) = 'TK1007' AND is_active = TRUE;

  IF n > 0 THEN
    RAISE EXCEPTION 'TK1007 มีคนใช้อยู่แล้ว — ยกเลิกทั้งหมด (เลือกรหัสอื่น)';
  END IF;

  -- 4. เตือนถ้าเคยมีคนเก่าใช้ TK1007 แล้วลาออกไป
  SELECT COUNT(*) INTO n
    FROM employees
   WHERE UPPER(employee_code) = 'TK1007' AND is_active = FALSE;

  IF n > 0 THEN
    RAISE WARNING 'เคยมีพนักงานที่ออกแล้ว % คน ใช้รหัส TK1007 — รายงานย้อนหลังจะมี TK1007 ซ้อนกัน', n;
  END IF;

  -- ── แก้จริง ────────────────────────────────────────────────
  UPDATE employees
     SET employee_code = 'TK1007', updated_at = NOW()
   WHERE id = v_id;

  RAISE NOTICE 'ย้ายรหัสสำเร็จ: % (id=%)  TK1012 → TK1007', v_name, v_id;
END $$;

COMMIT;

-- ══════════════════════════════════════════════════════════════
-- ตรวจสอบหลังรัน
-- ══════════════════════════════════════════════════════════════

-- 1. ต้องเห็นมุกธิดาเป็น TK1007 และไม่มี TK1012 ที่ active แล้ว
SELECT employee_code, name, is_active
  FROM employees
 WHERE UPPER(employee_code) IN ('TK1007','TK1012')
 ORDER BY employee_code, is_active DESC;

-- 2. ข้อมูลของเธอต้องอยู่ครบ (ผูกด้วย id ไม่ใช่รหัส จึงต้องไม่หายไปไหน)
SELECT e.employee_code, e.name,
       (SELECT COUNT(*) FROM attendance      a  WHERE a.employee_id  = e.id) AS วันที่ลงเวลา,
       (SELECT COUNT(*) FROM leave_requests  lr WHERE lr.employee_id = e.id) AS ใบลา
  FROM employees e
 WHERE UPPER(e.employee_code) = 'TK1007' AND e.is_active = TRUE;

-- 3. ❗ บันทึกผลนี้เก็บไว้ก่อนรับพนักงานใหม่ TK1012
--    หลังจากนี้ "TK1012" ในงวดเหล่านี้ = มุกธิดา ไม่ใช่คนใหม่
--    (รันบนฐาน line-accounting)
--    SELECT period_id, employee_code, employee_name, net_pay
--      FROM payroll_snapshots WHERE employee_code = 'TK1012' ORDER BY period_id;
--    SELECT run_id, employee_code, employee_name, final_amount
--      FROM comm_run_items    WHERE employee_code = 'TK1012' ORDER BY run_id;
