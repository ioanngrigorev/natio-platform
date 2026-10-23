ALTER TABLE payments ADD COLUMN traffic_type text NOT NULL DEFAULT 'unknown' CHECK (traffic_type IN ('ftd','std','unknown'));
ALTER TABLE transactions ADD COLUMN traffic_type text NOT NULL DEFAULT 'unknown' CHECK (traffic_type IN ('ftd','std','unknown'));
ALTER TABLE transactions ADD COLUMN conversion jsonb;
CREATE INDEX transactions_traffic_period_idx ON transactions(mode,traffic_type,occurred_at);
