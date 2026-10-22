ALTER TABLE routing_rules ADD COLUMN policy jsonb NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE payment_attempts ADD COLUMN pricing_snapshot jsonb;
--> statement-breakpoint
CREATE TABLE pricing_plans (
 id text PRIMARY KEY, family_id text NOT NULL, revision integer NOT NULL CHECK(revision>0), mode mode NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','retired')), terms jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1, created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX pricing_plan_revision_uq ON pricing_plans(family_id,revision);
--> statement-breakpoint
CREATE INDEX pricing_plans_mode_idx ON pricing_plans(mode,status);
--> statement-breakpoint
CREATE FUNCTION natio_guard_pricing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Pricing history cannot be deleted'; END IF;
 IF OLD.status <> 'draft' AND (NEW.terms IS DISTINCT FROM OLD.terms OR NEW.mode <> OLD.mode OR NEW.family_id <> OLD.family_id OR NEW.revision <> OLD.revision OR NEW.id <> OLD.id OR NEW.status NOT IN ('active','retired')) THEN
   RAISE EXCEPTION 'Published pricing terms are immutable';
 END IF;
 IF OLD.status='retired' AND NEW.status<>'retired' THEN RAISE EXCEPTION 'Retired pricing cannot be reactivated'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER pricing_history_guard BEFORE UPDATE OR DELETE ON pricing_plans FOR EACH ROW EXECUTE FUNCTION natio_guard_pricing();

--> statement-breakpoint
CREATE FUNCTION natio_guard_attempt_price() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.pricing_snapshot IS DISTINCT FROM NEW.pricing_snapshot THEN RAISE EXCEPTION 'Attempt pricing snapshot is immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER attempt_price_guard BEFORE UPDATE ON payment_attempts FOR EACH ROW EXECUTE FUNCTION natio_guard_attempt_price();
