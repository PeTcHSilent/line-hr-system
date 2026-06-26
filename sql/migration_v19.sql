-- ══════════════════════════════════════════════════════════════
-- Migration v19: holidays table + seed วันหยุดไทย 2025-2026
-- รัน: psql $DATABASE_URL -f sql/migration_v19.sql
-- ══════════════════════════════════════════════════════════════

-- 1. สร้างตาราง holidays
CREATE TABLE IF NOT EXISTS holidays (
  id              SERIAL PRIMARY KEY,
  date            DATE         NOT NULL UNIQUE,
  name            VARCHAR(150) NOT NULL,
  year            INT          NOT NULL,
  is_substitute   BOOLEAN      NOT NULL DEFAULT FALSE,  -- วันหยุดชดเชย
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_holidays_year ON holidays(year);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);

COMMENT ON TABLE  holidays                IS 'วันหยุดนักขัตฤกษ์และวันหยุดพิเศษ';
COMMENT ON COLUMN holidays.is_substitute  IS 'TRUE = วันหยุดชดเชย (เช่น ถ้าวันหยุดตรงกับเสาร์-อาทิตย์)';

-- 2. เพิ่มคอลัมน์ hire_date ให้ employees (ถ้ายังไม่มี)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS hire_date DATE;

-- 3. Seed วันหยุดไทย ปี 2025 (ค.ศ.)
INSERT INTO holidays (date, name, year, is_substitute) VALUES
  ('2025-01-01', 'วันขึ้นปีใหม่',                                       2025, FALSE),
  ('2025-02-12', 'วันมาฆบูชา',                                          2025, FALSE),
  ('2025-04-06', 'วันจักรี',                                            2025, FALSE),
  ('2025-04-07', 'วันหยุดชดเชย วันจักรี',                               2025, TRUE),
  ('2025-04-13', 'วันสงกรานต์',                                         2025, FALSE),
  ('2025-04-14', 'วันสงกรานต์',                                         2025, FALSE),
  ('2025-04-15', 'วันสงกรานต์',                                         2025, FALSE),
  ('2025-05-01', 'วันแรงงานแห่งชาติ',                                   2025, FALSE),
  ('2025-05-05', 'วันฉัตรมงคล',                                         2025, FALSE),
  ('2025-05-12', 'วันวิสาขบูชา',                                        2025, FALSE),
  ('2025-06-03', 'วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี',                 2025, FALSE),
  ('2025-07-10', 'วันอาสาฬหบูชา',                                       2025, FALSE),
  ('2025-07-11', 'วันเข้าพรรษา',                                        2025, FALSE),
  ('2025-07-28', 'วันเฉลิมพระชนมพรรษา รัชกาลที่ 10',                   2025, FALSE),
  ('2025-08-12', 'วันเฉลิมพระชนมพรรษาสมเด็จพระบรมราชชนนีพันปีหลวง',   2025, FALSE),
  ('2025-10-13', 'วันนวมินทรมหาราช',                                    2025, FALSE),
  ('2025-10-23', 'วันปิยมหาราช',                                        2025, FALSE),
  ('2025-12-05', 'วันชาติ / วันพ่อแห่งชาติ',                           2025, FALSE),
  ('2025-12-10', 'วันรัฐธรรมนูญ',                                       2025, FALSE),
  ('2025-12-31', 'วันสิ้นปี',                                           2025, FALSE)
ON CONFLICT (date) DO NOTHING;

-- 4. Seed วันหยุดไทย ปี 2026 (ค.ศ.)
INSERT INTO holidays (date, name, year, is_substitute) VALUES
  ('2026-01-01', 'วันขึ้นปีใหม่',                                       2026, FALSE),
  ('2026-03-02', 'วันมาฆบูชา',                                          2026, FALSE),
  ('2026-04-06', 'วันจักรี',                                            2026, FALSE),
  ('2026-04-13', 'วันสงกรานต์',                                         2026, FALSE),
  ('2026-04-14', 'วันสงกรานต์',                                         2026, FALSE),
  ('2026-04-15', 'วันสงกรานต์',                                         2026, FALSE),
  ('2026-05-01', 'วันแรงงานแห่งชาติ',                                   2026, FALSE),
  ('2026-05-04', 'วันฉัตรมงคล',                                         2026, FALSE),
  ('2026-05-31', 'วันวิสาขบูชา',                                        2026, FALSE),
  ('2026-06-03', 'วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี',                 2026, FALSE),
  ('2026-07-17', 'วันอาสาฬหบูชา',                                       2026, FALSE),
  ('2026-07-20', 'วันเข้าพรรษา',                                        2026, FALSE),
  ('2026-07-28', 'วันเฉลิมพระชนมพรรษา รัชกาลที่ 10',                   2026, FALSE),
  ('2026-08-12', 'วันเฉลิมพระชนมพรรษาสมเด็จพระบรมราชชนนีพันปีหลวง',   2026, FALSE),
  ('2026-10-13', 'วันนวมินทรมหาราช',                                    2026, FALSE),
  ('2026-10-23', 'วันปิยมหาราช',                                        2026, FALSE),
  ('2026-12-05', 'วันชาติ / วันพ่อแห่งชาติ',                           2026, FALSE),
  ('2026-12-10', 'วันรัฐธรรมนูญ',                                       2026, FALSE),
  ('2026-12-31', 'วันสิ้นปี',                                           2026, FALSE)
ON CONFLICT (date) DO NOTHING;
