UPDATE platform_plan_catalog SET monthly_usd_cents=CASE code WHEN 'light' THEN 990000 WHEN 'optimal' THEN 2990000 ELSE 9990000 END,version=version+1,updated_at=now();
ALTER TABLE platform_plan_catalog ADD COLUMN ai_included_credits integer NOT NULL DEFAULT 1000 CHECK(ai_included_credits BETWEEN 0 AND 10000000);
ALTER TABLE platform_plan_catalog ADD COLUMN ai_overage_cents integer NOT NULL DEFAULT 50 CHECK(ai_overage_cents BETWEEN 0 AND 100000);
UPDATE platform_plan_catalog SET ai_included_credits=CASE code WHEN 'light' THEN 1000 WHEN 'optimal' THEN 5000 ELSE 25000 END,ai_overage_cents=CASE code WHEN 'light' THEN 50 WHEN 'optimal' THEN 40 ELSE 25 END;
--> statement-breakpoint
CREATE TABLE platform_demo_subscriptions (
 actor_kind text NOT NULL CHECK(actor_kind IN ('admin','merchant')),actor_id text NOT NULL,
 plan text NOT NULL REFERENCES platform_plan_catalog(code),overage_enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_kind,actor_id)
);
CREATE TABLE platform_demo_invoices (
 id uuid PRIMARY KEY,actor_kind text NOT NULL CHECK(actor_kind IN ('admin','merchant')),actor_id text NOT NULL,
 plan text NOT NULL REFERENCES platform_plan_catalog(code),amount_cents integer NOT NULL CHECK(amount_cents>=0),catalog_version integer NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','declined','expired')),
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',resolved_at timestamptz
);
CREATE INDEX platform_demo_invoice_owner ON platform_demo_invoices(actor_kind,actor_id,created_at DESC);
CREATE TABLE platform_ai_usage (
 id uuid PRIMARY KEY,actor_kind text NOT NULL CHECK(actor_kind IN ('admin','merchant')),actor_id text NOT NULL,mode mode NOT NULL,
 period text NOT NULL,operation text NOT NULL,credits integer NOT NULL CHECK(credits>0),
 status text NOT NULL CHECK(status IN ('pending','succeeded','failed')),
 created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz
);
CREATE INDEX platform_ai_usage_owner ON platform_ai_usage(actor_kind,actor_id,mode,period);
