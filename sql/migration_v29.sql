-- ══════════════════════════════════════════════════════════════
-- Migration v29:
--   1) employee_documents — เอกสาร/ใบอนุญาตพนักงานที่มีวันหมดอายุ
--      (ใบอนุญาตนายหน้าประกันวินาศภัย, บัตร ปชช., ใบขับขี่, work permit ฯลฯ)
--   2) company_assets + asset_assignments — ทะเบียนทรัพย์สิน/อุปกรณ์บริษัท
--      และประวัติการเบิก-คืนของพนักงาน (เชื่อมกับ payroll_deductions
--      หมวด 'equipment' เมื่อของชำรุด/สูญหาย)
-- ══════════════════════════════════════════════════════════════

-- ── เอกสาร/ใบอนุญาตพนักงาน ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_documents (
  id               SERIAL PRIMARY KEY,
  employee_id      INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  doc_type         VARCHAR(30) NOT NULL DEFAULT 'other'
                     CHECK (doc_type IN ('broker_license','id_card','driver_license','passport','work_permit','contract','other')),
  doc_number       VARCHAR(100),
  issue_date       DATE,
  expiry_date      DATE NOT NULL,
  note             TEXT,
  last_notified_at DATE,
  created_by       INTEGER REFERENCES employees(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_documents_emp    ON employee_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_expiry ON employee_documents(expiry_date);

COMMENT ON COLUMN employee_documents.doc_type IS
  'broker_license=ใบอนุญาตนายหน้าประกัน | id_card=บัตรประชาชน | driver_license=ใบขับขี่ | passport=พาสปอร์ต | work_permit=ใบอนุญาตทำงาน | contract=สัญญาจ้าง | other=อื่นๆ';

-- ── ทะเบียนทรัพย์สิน/อุปกรณ์บริษัท ──────────────────────────────
CREATE TABLE IF NOT EXISTS company_assets (
  id             SERIAL PRIMARY KEY,
  asset_code     VARCHAR(50) UNIQUE NOT NULL,
  asset_name     VARCHAR(200) NOT NULL,
  category       VARCHAR(30) NOT NULL DEFAULT 'other'
                   CHECK (category IN ('laptop','phone','uniform','vehicle','furniture','other')),
  serial_number  VARCHAR(100),
  purchase_date  DATE,
  purchase_price NUMERIC(12,2),
  status         VARCHAR(20) NOT NULL DEFAULT 'available'
                   CHECK (status IN ('available','assigned','maintenance','retired','lost')),
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── ประวัติการเบิก/คืนทรัพย์สิน ──────────────────────────────────
CREATE TABLE IF NOT EXISTS asset_assignments (
  id               SERIAL PRIMARY KEY,
  asset_id         INTEGER NOT NULL REFERENCES company_assets(id) ON DELETE CASCADE,
  employee_id      INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  assigned_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  returned_date    DATE,
  return_condition VARCHAR(20) CHECK (return_condition IN ('normal','damaged','lost')),
  note             TEXT,
  assigned_by      INTEGER REFERENCES employees(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_assignments_asset ON asset_assignments(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_assignments_emp   ON asset_assignments(employee_id);

-- ป้องกันเบิก asset ตัวเดียวกันซ้ำซ้อนก่อนคืน (active assignment ต้องมีได้แค่ 1 รายการ/asset)
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_active_assignment
  ON asset_assignments(asset_id) WHERE returned_date IS NULL;
