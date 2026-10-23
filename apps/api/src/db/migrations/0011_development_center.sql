CREATE TABLE development_sprints (
 id uuid PRIMARY KEY, mode mode NOT NULL, name text NOT NULL, goal text NOT NULL,
 start_date date NOT NULL, end_date date NOT NULL, status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','completed')),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), CHECK(end_date>=start_date AND end_date-start_date<=31)
);
CREATE UNIQUE INDEX development_one_active_sprint ON development_sprints(mode) WHERE status='active';
--> statement-breakpoint
CREATE TABLE development_items (
 id uuid PRIMARY KEY, mode mode NOT NULL, owner_kind text NOT NULL CHECK(owner_kind IN ('admin','merchant')), owner_id text NOT NULL,
 merchant_id text, title text NOT NULL, public_summary text NOT NULL DEFAULT '', visibility text NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared')),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','idea','backlog','todo','in_progress','review','test','done','rejected','archived')),
 is_demo boolean NOT NULL DEFAULT false, data jsonb NOT NULL, priority_score double precision NOT NULL DEFAULT 0, sprint_id uuid REFERENCES development_sprints(id),
 version integer NOT NULL DEFAULT 1, started_at timestamptz, completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX development_items_mode_priority ON development_items(mode,priority_score DESC,created_at);
CREATE INDEX development_items_owner ON development_items(owner_kind,owner_id,mode);
--> statement-breakpoint
CREATE TABLE development_events (
 id bigserial PRIMARY KEY, item_id uuid NOT NULL REFERENCES development_items(id), actor_kind text NOT NULL, actor_id text NOT NULL,
 event text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX development_events_item ON development_events(item_id,id DESC);
CREATE TABLE development_work_sessions (
 id uuid PRIMARY KEY, item_id uuid NOT NULL REFERENCES development_items(id), actor_kind text NOT NULL, actor_id text NOT NULL,
 worker text NOT NULL CHECK(worker IN ('ai','human')), source text NOT NULL CHECK(source IN ('manual_timer','ai_specification')),
 started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz, outcome text NOT NULL DEFAULT '', CHECK(ended_at IS NULL OR ended_at>=started_at)
);
CREATE UNIQUE INDEX development_one_timer_per_actor ON development_work_sessions(actor_kind,actor_id) WHERE ended_at IS NULL;
CREATE INDEX development_sessions_item ON development_work_sessions(item_id);
--> statement-breakpoint
CREATE TABLE merchant_plans (
 merchant_id text PRIMARY KEY REFERENCES merchants(id), plan text NOT NULL CHECK(plan IN ('light','optimal','premium')),
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_plan_catalog (
 code text PRIMARY KEY CHECK(code IN ('light','optimal','premium')), monthly_usd_cents integer NOT NULL CHECK(monthly_usd_cents>=0),
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_plan_catalog(code,monthly_usd_cents) VALUES ('light',9900),('optimal',29900),('premium',99900);
CREATE TABLE plan_requests (
 id uuid PRIMARY KEY, merchant_id text NOT NULL REFERENCES merchants(id), requester_id text NOT NULL,
 plan text NOT NULL CHECK(plan IN ('light','optimal','premium')), status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','declined')),
 created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE UNIQUE INDEX plan_request_pending ON plan_requests(merchant_id) WHERE status='requested';
CREATE TABLE development_notices (
 id uuid PRIMARY KEY, mode mode NOT NULL, title text NOT NULL, body text NOT NULL,
 source_url text, item_id uuid REFERENCES development_items(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE development_notice_reads (
 notice_id uuid NOT NULL REFERENCES development_notices(id), actor_kind text NOT NULL, actor_id text NOT NULL,
 action text NOT NULL CHECK(action IN ('read','dismissed')), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(notice_id,actor_kind,actor_id)
);
