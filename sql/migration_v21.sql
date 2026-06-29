-- Migration v21: Audit Log table
-- Run: psql $DATABASE_URL -f sql/migration_v21.sql

CREATE TABLE IF NOT EXISTS audit_logs (
  id            SERIAL PRIMARY KEY,
  actor_name    VARCHAR(100) NOT NULL DEFAULT 'system',
  actor_role    VARCHAR(50),
  action        VARCHAR(60) NOT NULL,
  target_type   VARCHAR(50) NOT NULL,
  target_id     INTEGER,
  description   TEXT,
  meta          JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at  ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target       ON audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action       ON audit_logs(action);

COMMENT ON TABLE audit_logs IS 'บันทึกการกระทำของ Admin เช่น approve/reject leave/OT/expense';
