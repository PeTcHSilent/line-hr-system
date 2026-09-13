-- ══════════════════════════════════════════════════════════════════════════
-- เคลียร์ข้อมูลทดลองใช้งานทั้งหมดก่อน 1 กันยายน 2569 (2026-09-01)
-- เพื่อเริ่มใช้งานจริงเดือน ก.ย. 2569 ด้วยฐานข้อมูลที่สะอาด
--
-- ⚠️  สคริปต์นี้ "ลบข้อมูลถาวร" — ไม่ใช่ migration และจะไม่ถูกรันอัตโนมัติ
--     โดย GitHub Actions ต้องรันเองด้วยมือเท่านั้น
--
-- วิธีใช้:
--   1) รัน PART 1 ก่อน เพื่อดูว่าจะลบอะไรไปบ้าง (ไม่ลบจริง)
--   2) ถ้าตัวเลขถูกต้อง ค่อยรัน PART 2
--   3) PART 2 ครอบด้วย BEGIN/COMMIT — ถ้าตัวเลขผิดให้พิมพ์ ROLLBACK; แทน COMMIT;
--
-- สิ่งที่ "ไม่ถูกลบ" (ข้อมูลตั้งต้นยังอยู่ครบ):
--   employees, departments, branches, shifts, holidays, leave_types,
--   leave_quota, company_settings, admin_line_users, custom_roles,
--   ip_whitelist, employee_documents, company_assets
--
-- หมายเหตุสำคัญ:
--   • การลบ salary_adjustments ไม่ได้ย้อนเงินเดือนใน employees.salary
--     เงินเดือนปัจจุบันของพนักงานยังเป็นค่าล่าสุดเหมือนเดิม (ลบแค่ประวัติ)
--   • leave_requests ใช้เงื่อนไข start_date — ถ้ามีใบลาคร่อมเดือน
--     (เช่น 28 ส.ค. – 2 ก.ย.) จะถูกลบด้วย เพราะเริ่มก่อน ก.ย.
-- ══════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════
-- PART 1 — พรีวิว: นับจำนวนแถวที่จะถูกลบ (ปลอดภัย ไม่ลบอะไร)
-- ══════════════════════════════════════════════════════════════════════════

SELECT 'attendance'          AS table_name, COUNT(*) AS rows_to_delete FROM attendance          WHERE work_date      < DATE '2026-09-01'
UNION ALL
SELECT 'attendance_warnings',  COUNT(*) FROM attendance_warnings  WHERE warning_date  < DATE '2026-09-01'
UNION ALL
SELECT 'leave_requests',       COUNT(*) FROM leave_requests       WHERE start_date    < DATE '2026-09-01'
UNION ALL
SELECT 'ot_records',           COUNT(*) FROM ot_records           WHERE ot_date       < DATE '2026-09-01'
UNION ALL
SELECT 'expense_claims',       COUNT(*) FROM expense_claims       WHERE claim_date    < DATE '2026-09-01'
UNION ALL
SELECT 'payroll_deductions',   COUNT(*) FROM payroll_deductions   WHERE (year < 2026) OR (year = 2026 AND month < 9)
UNION ALL
SELECT 'payroll_records',      COUNT(*) FROM payroll_records      WHERE (year < 2026) OR (year = 2026 AND month < 9)
UNION ALL
SELECT 'salary_adjustments',   COUNT(*) FROM salary_adjustments   WHERE effective_date < DATE '2026-09-01'
UNION ALL
SELECT 'audit_logs',           COUNT(*) FROM audit_logs           WHERE created_at    < TIMESTAMPTZ '2026-09-01 00:00:00+07'
ORDER BY table_name;


-- ══════════════════════════════════════════════════════════════════════════
-- PART 2 — ลบจริง (รันหลังตรวจตัวเลขจาก PART 1 แล้วเท่านั้น)
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── ธุรกรรมหลัก: ลา / OT / เวลาเข้าออก / สาย-ขาด ──────────────────────
DELETE FROM attendance_warnings WHERE warning_date < DATE '2026-09-01';
DELETE FROM attendance          WHERE work_date    < DATE '2026-09-01';
DELETE FROM leave_requests      WHERE start_date   < DATE '2026-09-01';
DELETE FROM ot_records          WHERE ot_date      < DATE '2026-09-01';

-- ── เบิกค่าใช้จ่าย ────────────────────────────────────────────────────
DELETE FROM expense_claims      WHERE claim_date   < DATE '2026-09-01';

-- ── Payroll + รายการหักเงิน ───────────────────────────────────────────
DELETE FROM payroll_deductions  WHERE (year < 2026) OR (year = 2026 AND month < 9);
DELETE FROM payroll_records     WHERE (year < 2026) OR (year = 2026 AND month < 9);

-- ── ประวัติปรับเงินเดือน (ไม่กระทบ employees.salary ปัจจุบัน) ──────────
DELETE FROM salary_adjustments  WHERE effective_date < DATE '2026-09-01';

-- ── Audit log ─────────────────────────────────────────────────────────
DELETE FROM audit_logs          WHERE created_at   < TIMESTAMPTZ '2026-09-01 00:00:00+07';

-- ตรวจผลก่อน commit — ทุกค่าควรเป็น 0
SELECT 'attendance'          AS table_name, COUNT(*) AS rows_left FROM attendance          WHERE work_date      < DATE '2026-09-01'
UNION ALL
SELECT 'attendance_warnings',  COUNT(*) FROM attendance_warnings  WHERE warning_date  < DATE '2026-09-01'
UNION ALL
SELECT 'leave_requests',       COUNT(*) FROM leave_requests       WHERE start_date    < DATE '2026-09-01'
UNION ALL
SELECT 'ot_records',           COUNT(*) FROM ot_records           WHERE ot_date       < DATE '2026-09-01'
UNION ALL
SELECT 'expense_claims',       COUNT(*) FROM expense_claims       WHERE claim_date    < DATE '2026-09-01'
UNION ALL
SELECT 'payroll_deductions',   COUNT(*) FROM payroll_deductions   WHERE (year < 2026) OR (year = 2026 AND month < 9)
UNION ALL
SELECT 'payroll_records',      COUNT(*) FROM payroll_records      WHERE (year < 2026) OR (year = 2026 AND month < 9)
UNION ALL
SELECT 'salary_adjustments',   COUNT(*) FROM salary_adjustments   WHERE effective_date < DATE '2026-09-01'
UNION ALL
SELECT 'audit_logs',           COUNT(*) FROM audit_logs           WHERE created_at    < TIMESTAMPTZ '2026-09-01 00:00:00+07'
ORDER BY table_name;

-- ถ้าผลลัพธ์ข้างบนเป็น 0 ทั้งหมด → COMMIT
-- ถ้าผิดปกติ → พิมพ์ ROLLBACK; แทน
COMMIT;
