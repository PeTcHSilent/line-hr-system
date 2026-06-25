-- migration_v18.sql — Reset OT rate defaults to 1.0
-- รัน: psql -d hr_db -f sql/migration_v18.sql

UPDATE company_settings SET value = '1.0', updated_at = NOW()
WHERE key IN ('ot_rate_weekday', 'ot_rate_weekend', 'ot_rate_holiday');
