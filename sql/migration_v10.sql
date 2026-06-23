-- ============================================================
-- Migration v10: Payroll improvements
--   1. เพิ่ม bonus column (เงินพิเศษ/โบนัส รายบุคคล)
--   2. เพิ่ม late_deduction column (หักสาย = late_days × salary/30)
-- วิธีใช้: psql -d hr_db -f sql/migration_v10.sql
-- ============================================================

ALTER TABLE payroll_records
  ADD COLUMN IF NOT EXISTS bonus          NUMERIC(12,2) DEFAULT 0;

ALTER TABLE payroll_records
  ADD COLUMN IF NOT EXISTS late_deduction NUMERIC(12,2) DEFAULT 0;

UPDATE payroll_records SET bonus = 0          WHERE bonus          IS NULL;
UPDATE payroll_records SET late_deduction = 0 WHERE late_deduction IS NULL;

DO $$ BEGIN
  RAISE NOTICE 'migration_v10 completed — bonus + late_deduction columns added';
END $$;
