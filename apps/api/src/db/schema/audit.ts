import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { actorTypeEnum, eventLevelEnum } from "./enums.js";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Append-only audit trail for sensitive actions (dashboard, admin and API). */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: text("actor_id"),
    actorLabel: text("actor_label"),
    merchantId: text("merchant_id"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    before: jsonb("before").$type<unknown>(),
    after: jsonb("after").$type<unknown>(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_merchant_idx").on(t.merchantId, t.createdAt),
    index("audit_logs_actor_idx").on(t.actorType, t.actorId, t.createdAt),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  ],
);

/** Operational events: provider outages, worker failures, health changes. */
export const systemEvents = pgTable(
  "system_events",
  {
    id: text("id").primaryKey(),
    level: eventLevelEnum("level").notNull().default("info"),
    source: text("source").notNull(),
    type: text("type").notNull(),
    message: text("message").notNull(),
    providerAccountId: text("provider_account_id"),
    merchantId: text("merchant_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("system_events_created_idx").on(t.createdAt), index("system_events_level_idx").on(t.level, t.createdAt)],
);
