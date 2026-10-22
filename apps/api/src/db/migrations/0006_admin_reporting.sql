CREATE INDEX IF NOT EXISTS transactions_mode_time_id_idx ON transactions(mode, occurred_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS transactions_mode_currency_time_idx ON transactions(mode, currency, occurred_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS payments_mode_time_idx ON payments(mode, created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS payouts_mode_time_idx ON payouts(mode, created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS providers_name_id_idx ON providers(name, id);
