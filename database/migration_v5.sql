-- ============================================================
-- Migration v5: Department Management + OT Records
-- ============================================================

-- ---- Part 1: departments ----
ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS description VARCHAR(255),
  ADD COLUMN IF NOT EXISTS is_active   BOOLEAN DEFAULT TRUE;

UPDATE departments SET is_active = TRUE WHERE is_active IS NULL;

CREATE INDEX IF NOT EXISTS idx_departments_active ON departments(is_active);

-- ---- Part 2: ot_records ----
CREATE TABLE IF NOT EXISTS ot_records (
  id            SERIAL PRIMARY KEY,
  employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  ot_date       DATE NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  total_hours   NUMERIC(5,2),
  reason        TEXT,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
  approved_by   INTEGER REFERENCES employees(id),
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ot_employee   ON ot_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_ot_date       ON ot_records(ot_date);
CREATE INDEX IF NOT EXISTS idx_ot_status     ON ot_records(status);
