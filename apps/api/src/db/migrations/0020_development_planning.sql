CREATE SEQUENCE development_issue_number_seq;
ALTER TABLE development_items ADD COLUMN issue_number bigint NOT NULL DEFAULT nextval('development_issue_number_seq');
ALTER SEQUENCE development_issue_number_seq OWNED BY development_items.issue_number;
CREATE UNIQUE INDEX development_issue_number_unique ON development_items(issue_number);
ALTER TABLE development_items ADD COLUMN issue_type text NOT NULL DEFAULT 'task' CHECK(issue_type IN ('epic','story','task','bug','subtask'));
ALTER TABLE development_items ADD COLUMN parent_id uuid REFERENCES development_items(id);
ALTER TABLE development_items ADD COLUMN board_rank bigint NOT NULL DEFAULT 0;
WITH ranked AS (SELECT id,row_number() OVER(PARTITION BY mode,status,is_demo ORDER BY ((data->'ice'->>'impact')::int*(data->'ice'->>'confidence')::int*(data->'ice'->>'ease')::int) DESC NULLS LAST,priority_score DESC,created_at DESC,id)*1024 AS rank FROM development_items)
UPDATE development_items i SET board_rank=r.rank FROM ranked r WHERE i.id=r.id;
CREATE INDEX development_board_order ON development_items(mode,status,sprint_id,board_rank,id);
CREATE INDEX development_parent ON development_items(parent_id);
