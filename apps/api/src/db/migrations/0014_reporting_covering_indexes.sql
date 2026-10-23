-- Cover broad dashboard aggregates without fetching large payment/metadata rows.
-- For a busy existing installation, pre-create these with CONCURRENTLY before migrate.
CREATE INDEX IF NOT EXISTS payments_overview_cover_idx ON payments(mode,created_at) INCLUDE(merchant_id,status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS transactions_reporting_cover_idx ON transactions(mode,currency,occurred_at) INCLUDE(type,status,amount,fee_amount,net_amount,settlement_id,traffic_type,country,payment_method_type,merchant_id,provider_account_id);
