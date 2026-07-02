-- migration_v24.sql
-- สร้างตาราง broadcast_log สำหรับเก็บประวัติการส่งประกาศ

CREATE TABLE IF NOT EXISTS broadcast_log (
  id           SERIAL PRIMARY KEY,
  title        VARCHAR(255),
  message      TEXT,
  total_sent   INTEGER DEFAULT 0,
  total_failed INTEGER DEFAULT 0,
  sent_at      TIMESTAMPTZ DEFAULT NOW()
);
