-- ══════════════════════════════════════════════════════════════
-- Migration v26: เพิ่ม base_salary (เงินเดือนเริ่มต้น) ในตาราง employees
-- รัน: psql $DATABASE_URL -f sql/migration_v26.sql
-- ══════════════════════════════════════════════════════════════

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS base_salary NUMERIC(12,2) DEFAULT 0;

COMMENT ON COLUMN employees.base_salary IS 'เงินเดือนเริ่มต้น (ณ วันที่เข้าทำงาน)';

-- Backfill: พนักงานที่มีประวัติการปรับเงินเดือน
UPDATE employees e
SET base_salary = (
  SELECT sa.old_salary
  FROM salary_adjustments sa
  WHERE sa.employee_id = e.id
  ORDER BY sa.effective_date ASC, sa.id ASC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM salary_adjustments sa WHERE sa.employee_id = e.id
)
AND (e.base_salary = 0 OR e.base_salary IS NULL);

-- Backfill: พนักงานที่ยังไม่มีประวัติ
UPDATE employees e
SET base_salary = e.salary
WHERE (e.base_salary = 0 OR e.base_salary IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM salary_adjustments sa WHERE sa.employee_id = e.id
  );
