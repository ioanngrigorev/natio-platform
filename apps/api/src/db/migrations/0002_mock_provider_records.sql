CREATE TABLE "mock_provider_records" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_account_id" text NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"natio_reference" text,
	"status" text NOT NULL,
	"amount" bigint NOT NULL,
	"captured_amount" bigint DEFAULT 0 NOT NULL,
	"refunded_amount" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mock_records_external_uq" ON "mock_provider_records" USING btree ("provider_account_id","external_id");--> statement-breakpoint
CREATE INDEX "mock_records_ref_idx" ON "mock_provider_records" USING btree ("natio_reference");