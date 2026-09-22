CREATE TYPE "public"."account_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('merchant_user', 'admin_user', 'api_key', 'system');--> statement-breakpoint
CREATE TYPE "public"."admin_role" AS ENUM('superadmin', 'operations', 'support', 'readonly');--> statement-breakpoint
CREATE TYPE "public"."attempt_outcome" AS ENUM('success', 'requires_action', 'soft_decline', 'hard_decline', 'technical_error', 'timeout', 'provider_unavailable', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."attempt_status" AS ENUM('created', 'processing', 'unknown', 'authorized', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."capture_method" AS ENUM('automatic', 'manual');--> statement-breakpoint
CREATE TYPE "public"."event_level" AS ENUM('info', 'warning', 'error');--> statement-breakpoint
CREATE TYPE "public"."kyb_status" AS ENUM('not_started', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."merchant_role" AS ENUM('owner', 'admin', 'developer', 'finance', 'analyst', 'support', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."merchant_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."mode" AS ENUM('test', 'live');--> statement-breakpoint
CREATE TYPE "public"."payment_method_type" AS ENUM('card', 'bank_transfer', 'qr', 'open_banking', 'wallet', 'instant', 'local');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('created', 'pending', 'processing', 'authorized', 'captured', 'successful', 'failed', 'cancelled', 'refunded', 'partially_refunded');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('created', 'pending', 'processing', 'successful', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."provider_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."provider_type" AS ENUM('acquirer', 'psp', 'bank', 'qr', 'wallet', 'open_banking', 'local');--> statement-breakpoint
CREATE TYPE "public"."recon_batch_status" AS ENUM('processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."recon_item_status" AS ENUM('MATCHED', 'MISSING_PROVIDER', 'MISSING_NATIO', 'AMOUNT_MISMATCH', 'STATUS_MISMATCH');--> statement-breakpoint
CREATE TYPE "public"."recon_source" AS ENUM('csv', 'api');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('created', 'processing', 'successful', 'failed');--> statement-breakpoint
CREATE TYPE "public"."risk_action" AS ENUM('allow', 'review', 'block');--> statement-breakpoint
CREATE TYPE "public"."routing_strategy" AS ENUM('ordered', 'weighted', 'score');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('merchant', 'admin');--> statement-breakpoint
CREATE TYPE "public"."settlement_source" AS ENUM('provider_report', 'provider_api', 'manual');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('pending', 'settled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('pending', 'successful', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('payment', 'refund', 'payout', 'fee', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'delivering', 'succeeded', 'failed', 'exhausted');--> statement-breakpoint
CREATE TYPE "public"."webhook_endpoint_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "admin_role" DEFAULT 'readonly' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret_enc" text,
	"last_login_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"mode" "mode" NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"company" text,
	"message" text NOT NULL,
	"source" text DEFAULT 'website' NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"mode" "mode" NOT NULL,
	"external_id" text,
	"email" text,
	"name" text,
	"country" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_users" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"role" "merchant_role" DEFAULT 'viewer' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"invite_token_hash" text,
	"invite_expires_at" timestamp with time zone,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret_enc" text,
	"last_login_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"country" text,
	"website" text,
	"registration_number" text,
	"contact_email" text,
	"kyb_status" "kyb_status" DEFAULT 'not_started' NOT NULL,
	"status" "merchant_status" DEFAULT 'active' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"mode" "mode" NOT NULL,
	"customer_id" text,
	"type" "payment_method_type" NOT NULL,
	"provider_id" text,
	"provider_token" text,
	"display" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "merchant_status" DEFAULT 'active' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "session_kind" NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_token" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"merchant_id" text,
	"mode" "mode" NOT NULL,
	"name" text NOT NULL,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"credentials_enc" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fee_percent" numeric(8, 4) DEFAULT '0' NOT NULL,
	"fee_fixed_minor" bigint DEFAULT 0 NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"currencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_routes" (
	"id" text PRIMARY KEY NOT NULL,
	"routing_rule_id" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"weight" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "provider_type" NOT NULL,
	"adapter_key" text NOT NULL,
	"status" "provider_status" DEFAULT 'active' NOT NULL,
	"supported_methods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supported_currencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supported_countries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capabilities" jsonb DEFAULT '{"payments":true,"refunds":true,"capture":true,"payouts":false}'::jsonb NOT NULL,
	"settlement_entity" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routing_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_id" text,
	"payout_id" text,
	"routing_rule_id" text,
	"rule_name" text,
	"strategy" text NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_provider_account_id" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routing_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text,
	"project_id" text,
	"mode" "mode" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"priority" integer DEFAULT 100 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"transaction_type" text DEFAULT 'payment' NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"strategy" "routing_strategy" DEFAULT 'ordered' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"mode" "mode" NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"entity_id" text,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"provider_account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"status" "attempt_status" DEFAULT 'created' NOT NULL,
	"outcome" "attempt_outcome",
	"provider_payment_id" text,
	"provider_code" text,
	"provider_message" text,
	"failure_code" text,
	"fee_amount" bigint DEFAULT 0 NOT NULL,
	"request_sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"latency_ms" integer,
	"raw_response" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_id" text NOT NULL,
	"attempt_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"mode" "mode" NOT NULL,
	"customer_id" text,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"captured_amount" bigint DEFAULT 0 NOT NULL,
	"refunded_amount" bigint DEFAULT 0 NOT NULL,
	"status" "payment_status" DEFAULT 'created' NOT NULL,
	"capture_method" "capture_method" DEFAULT 'automatic' NOT NULL,
	"payment_method_type" "payment_method_type" NOT NULL,
	"payment_method_id" text,
	"country" text,
	"description" text,
	"reference" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text,
	"risk_decision_id" text,
	"risk_score" integer,
	"routing_decision_id" text,
	"current_attempt_id" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"provider_account_id" text,
	"provider_id" text,
	"provider_payment_id" text,
	"fee_amount" bigint DEFAULT 0 NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"decline_category" text,
	"next_action" jsonb,
	"return_url" text,
	"device" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"test_scenario" text,
	"processing_time_ms" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"mode" "mode" NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" "payout_status" DEFAULT 'created' NOT NULL,
	"destination" jsonb NOT NULL,
	"description" text,
	"reference" text,
	"country" text,
	"routing_decision_id" text,
	"provider_account_id" text,
	"provider_id" text,
	"provider_payout_id" text,
	"fee_amount" bigint DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"failure_code" text,
	"failure_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"test_scenario" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"mode" "mode" NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" "refund_status" DEFAULT 'created' NOT NULL,
	"reason" text,
	"provider_account_id" text,
	"provider_refund_id" text,
	"idempotency_key" text,
	"failure_code" text,
	"failure_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "state_transitions" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"actor" jsonb DEFAULT '{"type":"system"}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"mode" "mode" NOT NULL,
	"type" "transaction_type" NOT NULL,
	"status" "transaction_status" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"payment_id" text,
	"attempt_id" text,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"fee_amount" bigint DEFAULT 0 NOT NULL,
	"net_amount" bigint NOT NULL,
	"provider_account_id" text,
	"provider_id" text,
	"provider_reference" text,
	"payment_method_type" text,
	"country" text,
	"processing_time_ms" integer,
	"failure_code" text,
	"settlement_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_id" text NOT NULL,
	"decision" "risk_action" NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"matched_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text,
	"mode" "mode" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"priority" integer DEFAULT 100 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action" "risk_action" DEFAULT 'review' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text,
	"mode" "mode" NOT NULL,
	"provider_account_id" text NOT NULL,
	"source" "recon_source" DEFAULT 'csv' NOT NULL,
	"file_name" text,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"status" "recon_batch_status" DEFAULT 'processing' NOT NULL,
	"totals" jsonb DEFAULT '{"total":0,"MATCHED":0,"MISSING_PROVIDER":0,"MISSING_NATIO":0,"AMOUNT_MISMATCH":0,"STATUS_MISMATCH":0}'::jsonb NOT NULL,
	"error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reconciliation_items" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"status" "recon_item_status" NOT NULL,
	"transaction_id" text,
	"payment_id" text,
	"provider_reference" text,
	"natio_amount" bigint,
	"provider_amount" bigint,
	"currency" text,
	"natio_status" text,
	"provider_status" text,
	"notes" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_items" (
	"id" text PRIMARY KEY NOT NULL,
	"settlement_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"fee_amount" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"mode" "mode" NOT NULL,
	"provider_account_id" text NOT NULL,
	"settlement_reference" text,
	"currency" text NOT NULL,
	"gross_amount" bigint NOT NULL,
	"fee_amount" bigint DEFAULT 0 NOT NULL,
	"net_amount" bigint NOT NULL,
	"transaction_count" integer DEFAULT 0 NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" "settlement_status" DEFAULT 'pending' NOT NULL,
	"source" "settlement_source" DEFAULT 'provider_report' NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"mode" "mode" NOT NULL,
	"type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"mode" "mode" NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 6 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_response_status" integer,
	"last_response_body" text,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"request_headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_status" integer,
	"response_body" text,
	"error" text,
	"duration_ms" integer,
	"manual" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"mode" "mode" NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"secret_enc" text NOT NULL,
	"secret_prefix" text NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "webhook_endpoint_status" DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"actor_label" text,
	"merchant_id" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_events" (
	"id" text PRIMARY KEY NOT NULL,
	"level" "event_level" DEFAULT 'info' NOT NULL,
	"source" text NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"provider_account_id" text,
	"merchant_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_users" ADD CONSTRAINT "merchant_users_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_routes" ADD CONSTRAINT "provider_routes_routing_rule_id_routing_rules_id_fk" FOREIGN KEY ("routing_rule_id") REFERENCES "public"."routing_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_routes" ADD CONSTRAINT "provider_routes_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_rules" ADD CONSTRAINT "risk_rules_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_batches" ADD CONSTRAINT "reconciliation_batches_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_batches" ADD CONSTRAINT "reconciliation_batches_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_batch_id_reconciliation_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."reconciliation_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."webhook_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_email_uq" ON "admin_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_uq" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_merchant_idx" ON "api_keys" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "customers_merchant_idx" ON "customers" USING btree ("merchant_id","mode");--> statement-breakpoint
CREATE INDEX "customers_external_idx" ON "customers" USING btree ("project_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_users_email_uq" ON "merchant_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "merchant_users_merchant_idx" ON "merchant_users" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "payment_methods_merchant_idx" ON "payment_methods" USING btree ("merchant_id","mode");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_merchant_slug_uq" ON "projects" USING btree ("merchant_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "provider_accounts_provider_idx" ON "provider_accounts" USING btree ("provider_id","mode");--> statement-breakpoint
CREATE INDEX "provider_routes_rule_idx" ON "provider_routes" USING btree ("routing_rule_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "providers_code_uq" ON "providers" USING btree ("code");--> statement-breakpoint
CREATE INDEX "routing_decisions_payment_idx" ON "routing_decisions" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "routing_rules_scope_idx" ON "routing_rules" USING btree ("mode","merchant_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_uq" ON "idempotency_keys" USING btree ("merchant_id","mode","scope","key");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_number_uq" ON "payment_attempts" USING btree ("payment_id","attempt_number");--> statement-breakpoint
CREATE INDEX "payment_attempts_provider_idx" ON "payment_attempts" USING btree ("provider_account_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_events_payment_idx" ON "payment_events" USING btree ("payment_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_merchant_created_idx" ON "payments" USING btree ("merchant_id","mode","created_at");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_reference_idx" ON "payments" USING btree ("merchant_id","reference");--> statement-breakpoint
CREATE INDEX "payments_provider_idx" ON "payments" USING btree ("provider_account_id","created_at");--> statement-breakpoint
CREATE INDEX "payouts_merchant_idx" ON "payouts" USING btree ("merchant_id","mode","created_at");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "refunds_merchant_idx" ON "refunds" USING btree ("merchant_id","mode","created_at");--> statement-breakpoint
CREATE INDEX "state_transitions_entity_idx" ON "state_transitions" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "transactions_merchant_idx" ON "transactions" USING btree ("merchant_id","mode","occurred_at");--> statement-breakpoint
CREATE INDEX "transactions_entity_idx" ON "transactions" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "transactions_provider_idx" ON "transactions" USING btree ("provider_account_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_provider_ref_uq" ON "transactions" USING btree ("provider_account_id","provider_reference","type");--> statement-breakpoint
CREATE INDEX "risk_decisions_payment_idx" ON "risk_decisions" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "risk_rules_scope_idx" ON "risk_rules" USING btree ("mode","merchant_id","priority");--> statement-breakpoint
CREATE INDEX "recon_batches_merchant_idx" ON "reconciliation_batches" USING btree ("merchant_id","mode","created_at");--> statement-breakpoint
CREATE INDEX "recon_items_batch_idx" ON "reconciliation_items" USING btree ("batch_id","status");--> statement-breakpoint
CREATE INDEX "settlement_items_settlement_idx" ON "settlement_items" USING btree ("settlement_id");--> statement-breakpoint
CREATE INDEX "settlements_merchant_idx" ON "settlements" USING btree ("merchant_id","mode","period_end");--> statement-breakpoint
CREATE INDEX "events_merchant_idx" ON "events" USING btree ("merchant_id","mode","created_at");--> statement-breakpoint
CREATE INDEX "events_entity_idx" ON "events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" USING btree ("endpoint_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_merchant_idx" ON "webhook_deliveries" USING btree ("merchant_id","mode","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_event_idx" ON "webhook_deliveries" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_attempts_delivery_idx" ON "webhook_delivery_attempts" USING btree ("delivery_id","attempt_number");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_merchant_idx" ON "webhook_endpoints" USING btree ("merchant_id","mode");--> statement-breakpoint
CREATE INDEX "audit_logs_merchant_idx" ON "audit_logs" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_type","actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "system_events_created_idx" ON "system_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "system_events_level_idx" ON "system_events" USING btree ("level","created_at");