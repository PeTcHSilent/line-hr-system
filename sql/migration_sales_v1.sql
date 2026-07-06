-- migration_sales_v1.sql
-- Sales Bot: leads + conversation tables

-- ── Sales Leads ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales_leads (
  id               SERIAL PRIMARY KEY,
  line_user_id     VARCHAR(100) NOT NULL UNIQUE,
  line_display_name VARCHAR(200),
  customer_name    VARCHAR(200),
  phone            VARCHAR(20),
  car_brand        VARCHAR(100),
  car_model        VARCHAR(100),
  car_year         VARCHAR(10),
  insurance_type   VARCHAR(50),   -- 'type1','type2','type3','compulsory'
  interest_level   VARCHAR(20) DEFAULT 'warm',  -- 'hot','warm','cold'
  status           VARCHAR(30) DEFAULT 'new',   -- 'new','contacted','quoted','closed','lost'
  notes            TEXT,
  assigned_to      VARCHAR(100),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Sales Conversations (history per LINE user) ────────────────
CREATE TABLE IF NOT EXISTS sales_conversations (
  id               SERIAL PRIMARY KEY,
  line_user_id     VARCHAR(100) NOT NULL UNIQUE,
  display_name     VARCHAR(200),
  history          JSONB NOT NULL DEFAULT '[]',
  message_count    INT NOT NULL DEFAULT 0,
  lead_captured    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_leads_status    ON sales_leads(status);
CREATE INDEX IF NOT EXISTS idx_sales_leads_created   ON sales_leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_conv_line_user  ON sales_conversations(line_user_id);
