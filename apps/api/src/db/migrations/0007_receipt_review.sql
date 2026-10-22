CREATE TABLE receipt_cases (
  id text PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id),
  payment_id text NOT NULL REFERENCES payments(id),
  mode text NOT NULL DEFAULT 'test' CHECK (mode = 'test'),
  filename text NOT NULL,
  pdf bytea NOT NULL,
  previews bytea[] NOT NULL,
  sha256 text NOT NULL,
  fingerprint text NOT NULL,
  extracted_text text NOT NULL,
  ocr_text text NOT NULL,
  assessment jsonb NOT NULL,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','in_review','waiting_psp','needs_info','closed')),
  decision text CHECK (decision IN ('confirmed','rejected')),
  assignee text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'closed') = (decision IS NOT NULL)),
  UNIQUE (merchant_id, payment_id, sha256)
);
--> statement-breakpoint
CREATE INDEX receipt_cases_merchant_created ON receipt_cases(merchant_id, created_at DESC);
CREATE INDEX receipt_cases_state_created ON receipt_cases(state, created_at DESC);
CREATE INDEX receipt_cases_hash ON receipt_cases(sha256);
CREATE INDEX receipt_cases_fingerprint ON receipt_cases(fingerprint);
--> statement-breakpoint
CREATE TABLE receipt_events (
  id bigserial PRIMARY KEY,
  case_id text NOT NULL REFERENCES receipt_cases(id),
  action text NOT NULL,
  actor text NOT NULL,
  note text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX receipt_events_case ON receipt_events(case_id, id);
CREATE TRIGGER receipt_events_immutable BEFORE UPDATE OR DELETE ON receipt_events FOR EACH ROW EXECUTE FUNCTION natio_prevent_mutation();
