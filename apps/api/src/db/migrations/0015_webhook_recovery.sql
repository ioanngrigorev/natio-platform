-- Additive migration: old workers can run during the rolling deployment.
ALTER TABLE webhook_deliveries ADD COLUMN manual_requested boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE INDEX webhook_deliveries_recovery_idx ON webhook_deliveries (next_attempt_at, id)
WHERE status IN ('pending', 'failed');
--> statement-breakpoint
CREATE INDEX webhook_deliveries_lease_idx ON webhook_deliveries (updated_at)
WHERE status = 'delivering';
