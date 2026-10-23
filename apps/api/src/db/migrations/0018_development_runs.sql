CREATE TABLE development_runs (
 id uuid PRIMARY KEY, item_id uuid NOT NULL REFERENCES development_items(id), mode mode NOT NULL,
 requester_id text NOT NULL, item_version integer NOT NULL, snapshot jsonb NOT NULL,
 target text NOT NULL CHECK(target IN ('test','production')),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','developing','testing','awaiting_approval','deploy_queued','deploying','succeeded','failed','cancelled','interrupted')),
 cancel_requested boolean NOT NULL DEFAULT false,
 base_sha text, commit_sha text, approved_sha text, approved_by text,
 lease_token uuid, heartbeat_at timestamptz, runner_id text,
 patch text NOT NULL DEFAULT '' CHECK(octet_length(patch)<=200000),
 summary text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE UNIQUE INDEX development_run_active ON development_runs(item_id) WHERE state IN ('queued','developing','testing','awaiting_approval','deploy_queued','deploying');
CREATE INDEX development_run_queue ON development_runs(created_at) WHERE state IN ('queued','deploy_queued');
--> statement-breakpoint
CREATE TABLE development_run_events (
 id bigserial PRIMARY KEY, run_id uuid NOT NULL REFERENCES development_runs(id), stage text NOT NULL,
 message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX development_run_events_run ON development_run_events(run_id,id);

--> statement-breakpoint
CREATE TABLE development_runner_status (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), heartbeat_at timestamptz NOT NULL,
 production_enabled boolean NOT NULL DEFAULT false
);
