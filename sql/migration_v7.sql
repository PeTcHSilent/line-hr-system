-- ============================================================
-- migration_v7.sql
-- เพิ่ม ot_type ใน ot_records
-- weekday  = OT วันทำงานปกติ × 1.5
-- holiday  = OT วันหยุด × 3.0
-- ============================================================
ALTER TABLE ot_records
  ADD COLUMN IF NOT EXISTS ot_type VARCHAR(10) NOT NULL DEFAULT 'weekday'
    CHECK (ot_type IN ('weekday', 'holiday'));
