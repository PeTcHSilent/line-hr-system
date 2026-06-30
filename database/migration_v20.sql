-- ============================================================
-- Migration v20 — ระบบปรับเงินเดือนประจำปี (Salary Adjustment)
-- ============================================================

CREATE TABLE IF NOT EXISTS salary_adjustments (
  id               SERIAL PRIMARY KEY,
  employee_id      INT NOT NULL REFERENCES employees(id),
  effective_date   DATE NOT NULL,              -- วันที่มีผล
  old_salary       NUMERIC(12,2) NOT NULL,     -- เงินเดือนก่อนปรับ
  new_salary       NUMERIC(12,2) NOT NULL,     -- เงินเดือนหลังปรับ
  adjustment_type  VARCHAR(20) NOT NULL CHECK (adjustment_type IN ('percent', 'amount')),
  adjustment_value NUMERIC(10,4),              -- % หรือจำนวนเงิน
  reason           TEXT,                       -- เหตุผล / รอบประเมิน
  round_name       VARCHAR(100),               -- ชื่อรอบการขึ้น เช่น "ประจำปี 2026"
  applied_by       INT REFERENCES employees(id),
  created_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salary_adj_employee ON salary_adjustments(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_adj_date     ON salary_adjustments(effective_date);
CREATE INDEX IF NOT EXISTS idx_salary_adj_round    ON salary_adjustments(round_name);
