CREATE TABLE admin_dashboards (
 id text PRIMARY KEY, owner_id text NOT NULL REFERENCES admin_users(id), mode mode NOT NULL,
 name text NOT NULL, spec jsonb NOT NULL, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_dashboards_owner_idx ON admin_dashboards(owner_id,mode,updated_at DESC);
--> statement-breakpoint
CREATE TABLE lab_connections (
 id text PRIMARY KEY, owner_id text REFERENCES admin_users(id), name text NOT NULL,
 config jsonb NOT NULL, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','passed','failed')),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lab_connections_owner_idx ON lab_connections(owner_id,created_at DESC);
--> statement-breakpoint
CREATE TABLE lab_runs (
 id text PRIMARY KEY, connection_id text NOT NULL REFERENCES lab_connections(id), actor_id text NOT NULL REFERENCES admin_users(id),
 config_version integer NOT NULL, config_snapshot jsonb NOT NULL, results jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('passed','failed')), duration_ms integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lab_runs_connection_idx ON lab_runs(connection_id,created_at DESC);
