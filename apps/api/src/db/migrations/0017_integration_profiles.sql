ALTER TABLE api_keys ADD COLUMN integration_type text NOT NULL DEFAULT 'api' CHECK (integration_type IN ('api','redirect'));
--> statement-breakpoint
CREATE TABLE merchant_integration_profiles (
 merchant_id text NOT NULL REFERENCES merchants(id),
 mode mode NOT NULL,
 preferred_type text NOT NULL DEFAULT 'api' CHECK (preferred_type IN ('api','redirect')),
 allowed_types jsonb NOT NULL DEFAULT '["api","redirect"]',
 updated_by text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (merchant_id,mode)
);

--> statement-breakpoint
CREATE TABLE merchant_dashboards (
 id text PRIMARY KEY, owner_id text NOT NULL REFERENCES merchant_users(id), merchant_id text NOT NULL REFERENCES merchants(id), mode mode NOT NULL,
 name text NOT NULL, spec jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX merchant_dashboards_scope_idx ON merchant_dashboards(owner_id,merchant_id,mode,updated_at DESC);
