import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { modeEnum, webhookDeliveryStatusEnum, webhookEndpointStatusEnum } from "./enums.js";
import { merchants, projects } from "./merchants.js";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const WEBHOOK_EVENT_TYPES = [
  "payment.created",
  "payment.processing",
  "payment.authorized",
  "payment.successful",
  "payment.failed",
  "payment.cancelled",
  "payment.refunded",
  "refund.successful",
  "refund.failed",
  "payout.created",
  "payout.successful",
  "payout.failed",
  "settlement.created",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    mode: modeEnum("mode").notNull(),
    url: text("url").notNull(),
    description: text("description"),
    /** AES-GCM encrypted signing secret; needed in clear to sign, so it is encrypted rather than hashed. */
    secretEnc: text("secret_enc").notNull(),
    /** Prefix for display, e.g. whsec_ab12. */
    secretPrefix: text("secret_prefix").notNull(),
    events: jsonb("events").$type<string[]>().notNull().default([]),
    status: webhookEndpointStatusEnum("status").notNull().default("active"),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("webhook_endpoints_merchant_idx").on(t.merchantId, t.mode)],
);

/** Outbox of domain events. Every event is persisted before any delivery is attempted. */
export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    projectId: text("project_id").notNull(),
    mode: modeEnum("mode").notNull(),
    type: text("type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("events_merchant_idx").on(t.merchantId, t.mode, t.createdAt), index("events_entity_idx").on(t.entityType, t.entityId)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id),
    merchantId: text("merchant_id").notNull(),
    mode: modeEnum("mode").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: webhookDeliveryStatusEnum("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(6),
    nextAttemptAt: ts("next_attempt_at"),
    lastResponseStatus: integer("last_response_status"),
    lastResponseBody: text("last_response_body"),
    lastError: text("last_error"),
    deliveredAt: ts("delivered_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("webhook_deliveries_endpoint_idx").on(t.endpointId, t.createdAt),
    index("webhook_deliveries_merchant_idx").on(t.merchantId, t.mode, t.createdAt),
    index("webhook_deliveries_event_idx").on(t.eventId),
  ],
);

export const webhookDeliveryAttempts = pgTable(
  "webhook_delivery_attempts",
  {
    id: text("id").primaryKey(),
    deliveryId: text("delivery_id")
      .notNull()
      .references(() => webhookDeliveries.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    requestHeaders: jsonb("request_headers").$type<Record<string, string>>().notNull().default({}),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    error: text("error"),
    durationMs: integer("duration_ms"),
    manual: text("manual"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("webhook_delivery_attempts_delivery_idx").on(t.deliveryId, t.attemptNumber)],
);
