ALTER TABLE development_items DROP CONSTRAINT development_items_status_check;
ALTER TABLE development_items ADD CONSTRAINT development_items_status_check CHECK(status IN ('draft','idea','backlog','analysis','todo','in_progress','review','test','done','rejected','archived'));
--> statement-breakpoint
INSERT INTO development_events(item_id,actor_kind,actor_id,event,detail) SELECT id,'admin','system:workflow-0019','status_changed','{"from":"review","to":"test","reason":"Code review consolidated into test acceptance"}'::jsonb FROM development_items WHERE status='review';
UPDATE development_items SET status='test',version=version+1,updated_at=now() WHERE status='review';
