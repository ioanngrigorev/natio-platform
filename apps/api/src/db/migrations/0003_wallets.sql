CREATE TYPE "public"."chain_network" AS ENUM('bitcoin', 'ethereum', 'bsc', 'polygon', 'tron');--> statement-breakpoint
CREATE TYPE "public"."wallet_account_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."wallet_address_status" AS ENUM('reserved', 'awaiting', 'settled', 'underpaid', 'expired');--> statement-breakpoint
CREATE TABLE "chain_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_address_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"network" "chain_network" NOT NULL,
	"tx_hash" text NOT NULL,
	"output_index" integer DEFAULT 0 NOT NULL,
	"asset" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"block_number" integer,
	"confirmations" integer DEFAULT 0 NOT NULL,
	"orphaned" boolean DEFAULT false NOT NULL,
	"raw" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"mode" "mode" NOT NULL,
	"label" text NOT NULL,
	"network" "chain_network" NOT NULL,
	"asset" text NOT NULL,
	"extended_key" text NOT NULL,
	"key_fingerprint" text NOT NULL,
	"script_type" text NOT NULL,
	"next_index" integer DEFAULT 0 NOT NULL,
	"status" "wallet_account_status" DEFAULT 'active' NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_addresses" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_account_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"mode" "mode" NOT NULL,
	"network" "chain_network" NOT NULL,
	"asset" text NOT NULL,
	"derivation_index" integer NOT NULL,
	"derivation_path" text NOT NULL,
	"address" text NOT NULL,
	"payment_id" text,
	"status" "wallet_address_status" DEFAULT 'reserved' NOT NULL,
	"expected_amount" numeric(78, 0),
	"observed_amount" numeric(78, 0) DEFAULT '0' NOT NULL,
	"confirmations_required" integer NOT NULL,
	"expires_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chain_observations" ADD CONSTRAINT "chain_observations_wallet_address_id_wallet_addresses_id_fk" FOREIGN KEY ("wallet_address_id") REFERENCES "public"."wallet_addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_observations" ADD CONSTRAINT "chain_observations_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_accounts_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_addresses" ADD CONSTRAINT "wallet_addresses_wallet_account_id_wallet_accounts_id_fk" FOREIGN KEY ("wallet_account_id") REFERENCES "public"."wallet_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_addresses" ADD CONSTRAINT "wallet_addresses_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_addresses" ADD CONSTRAINT "wallet_addresses_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chain_observations_tx_idx" ON "chain_observations" USING btree ("network","tx_hash","output_index");--> statement-breakpoint
CREATE INDEX "chain_observations_address_idx" ON "chain_observations" USING btree ("wallet_address_id");--> statement-breakpoint
CREATE INDEX "wallet_accounts_merchant_idx" ON "wallet_accounts" USING btree ("merchant_id","mode","network");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_accounts_fingerprint_idx" ON "wallet_accounts" USING btree ("merchant_id","key_fingerprint","mode");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_addresses_index_idx" ON "wallet_addresses" USING btree ("wallet_account_id","derivation_index");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_addresses_address_idx" ON "wallet_addresses" USING btree ("network","address");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_addresses_payment_idx" ON "wallet_addresses" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "wallet_addresses_watch_idx" ON "wallet_addresses" USING btree ("status","network");--> statement-breakpoint
CREATE INDEX "wallet_addresses_merchant_idx" ON "wallet_addresses" USING btree ("merchant_id","mode","created_at");--> statement-breakpoint
-- Chain observations: a record of what the chain showed us.
--
-- Not fully append-only, because confirmations genuinely accumulate and a
-- reorg genuinely orphans a row — those are the two things the watcher must be
-- able to write. What must never change is the financial fact itself: which
-- transaction, which output, which asset, how much. If those were editable,
-- "the chain said so" would stop being evidence of anything.
CREATE OR REPLACE FUNCTION natio_chain_observations_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'chain_observations are append-only' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.tx_hash <> OLD.tx_hash OR NEW.output_index <> OLD.output_index
     OR NEW.amount <> OLD.amount OR NEW.asset <> OLD.asset
     OR NEW.network <> OLD.network OR NEW.wallet_address_id <> OLD.wallet_address_id
     OR NEW.merchant_id <> OLD.merchant_id OR NEW.first_seen_at <> OLD.first_seen_at THEN
    RAISE EXCEPTION 'financial fields of chain_observations are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER chain_observations_guard BEFORE UPDATE OR DELETE ON "chain_observations"
  FOR EACH ROW EXECUTE FUNCTION natio_chain_observations_guard();
--> statement-breakpoint
-- A derived address is reserved for exactly one payment and its identity is
-- fixed at creation. Rewriting the address of a row a customer has already
-- been shown would send their funds to a different place with no trace.
CREATE OR REPLACE FUNCTION natio_wallet_addresses_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'wallet_addresses are append-only' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.address <> OLD.address OR NEW.derivation_index <> OLD.derivation_index
     OR NEW.derivation_path <> OLD.derivation_path OR NEW.wallet_account_id <> OLD.wallet_account_id
     OR NEW.network <> OLD.network OR NEW.merchant_id <> OLD.merchant_id THEN
    RAISE EXCEPTION 'identity of a derived address is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  -- A payment may be attached once, never moved to a different payment.
  IF OLD.payment_id IS NOT NULL AND NEW.payment_id IS DISTINCT FROM OLD.payment_id THEN
    RAISE EXCEPTION 'a derived address cannot be reassigned to another payment' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER wallet_addresses_guard BEFORE UPDATE OR DELETE ON "wallet_addresses"
  FOR EACH ROW EXECUTE FUNCTION natio_wallet_addresses_guard();
