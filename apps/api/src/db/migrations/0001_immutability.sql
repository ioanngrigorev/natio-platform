-- Append-only guarantees for financial history tables.
-- These tables may be inserted into, but never updated or deleted from the application role.
CREATE OR REPLACE FUNCTION natio_prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only (operation % rejected)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER state_transitions_immutable BEFORE UPDATE OR DELETE ON "state_transitions"
  FOR EACH ROW EXECUTE FUNCTION natio_prevent_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION natio_prevent_mutation();
--> statement-breakpoint
CREATE TRIGGER payment_events_immutable BEFORE UPDATE OR DELETE ON "payment_events"
  FOR EACH ROW EXECUTE FUNCTION natio_prevent_mutation();
--> statement-breakpoint
CREATE TRIGGER events_immutable BEFORE UPDATE OR DELETE ON "events"
  FOR EACH ROW EXECUTE FUNCTION natio_prevent_mutation();
--> statement-breakpoint
-- Transactions: rows are immutable except for late settlement linkage.
CREATE OR REPLACE FUNCTION natio_transactions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'transactions are append-only' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.amount <> OLD.amount OR NEW.currency <> OLD.currency OR NEW.type <> OLD.type
     OR NEW.merchant_id <> OLD.merchant_id OR NEW.entity_id <> OLD.entity_id OR NEW.fee_amount <> OLD.fee_amount
     OR NEW.net_amount <> OLD.net_amount OR NEW.occurred_at <> OLD.occurred_at THEN
    RAISE EXCEPTION 'financial fields of transactions are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER transactions_guard BEFORE UPDATE OR DELETE ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION natio_transactions_guard();
--> statement-breakpoint
-- Payment attempts: provider identifiers must not be rewritten once set.
CREATE OR REPLACE FUNCTION natio_attempts_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment_attempts are append-only' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.provider_payment_id IS NOT NULL AND NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id THEN
    RAISE EXCEPTION 'provider_payment_id of an attempt is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payment_attempts_guard BEFORE UPDATE OR DELETE ON "payment_attempts"
  FOR EACH ROW EXECUTE FUNCTION natio_attempts_guard();
