CREATE TABLE development_automation_rules (
 id uuid PRIMARY KEY,mode mode NOT NULL,name text NOT NULL,enabled boolean NOT NULL DEFAULT false,
 trigger_status text NOT NULL CHECK(trigger_status IN ('backlog','analysis','todo','in_progress','test','done')),
 issue_type text CHECK(issue_type IN ('epic','story','task','bug','subtask')),
 action_field text NOT NULL CHECK(action_field IN ('assignee','qa_owner')),action_value text NOT NULL,
 version integer NOT NULL DEFAULT 1,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX development_automation_mode ON development_automation_rules(mode,enabled);
CREATE TABLE development_automation_executions (
 id bigserial PRIMARY KEY,rule_id uuid NOT NULL REFERENCES development_automation_rules(id),item_id uuid NOT NULL REFERENCES development_items(id),
 event_id bigint NOT NULL REFERENCES development_events(id),outcome text NOT NULL CHECK(outcome IN ('applied','unchanged','failed')),
 detail jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(rule_id,event_id)
);
--> statement-breakpoint
-- Observe current state without inventing historical transition times for legacy records.
INSERT INTO development_events(item_id,actor_kind,actor_id,event,detail)
SELECT id,'admin','system:flow-baseline-0021','status_observed',jsonb_build_object('status',status,'note','Current status observed when event-based reporting was enabled; historical timing is not inferred')
FROM development_items WHERE NOT is_demo;
