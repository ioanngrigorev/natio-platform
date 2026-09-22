import { boolean, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { modeEnum, riskActionEnum } from "./enums.js";
import { merchants } from "./merchants.js";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export type RiskField =
  | "country"
  | "amount"
  | "currency"
  | "payment_method"
  | "merchant_id"
  | "ip"
  | "device_fingerprint"
  | "customer_email"
  | "velocity_1h"
  | "velocity_24h"
  | "failed_attempts_24h"
  | "amount_24h";

export interface RiskCondition {
  field: RiskField;
  op: "eq" | "neq" | "in" | "not_in" | "gt" | "gte" | "lt" | "lte";
  value: string | number | Array<string | number>;
}

export const riskRules = pgTable(
  "risk_rules",
  {
    id: text("id").primaryKey(),
    /** Null = global rule. */
    merchantId: text("merchant_id").references(() => merchants.id),
    mode: modeEnum("mode").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    priority: integer("priority").notNull().default(100),
    enabled: boolean("enabled").notNull().default(true),
    conditions: jsonb("conditions").$type<RiskCondition[]>().notNull().default([]),
    action: riskActionEnum("action").notNull().default("review"),
    /** Score contribution when matched (0-100). */
    score: integer("score").notNull().default(0),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("risk_rules_scope_idx").on(t.mode, t.merchantId, t.priority)],
);

export const riskDecisions = pgTable(
  "risk_decisions",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id").notNull(),
    decision: riskActionEnum("decision").notNull(),
    score: integer("score").notNull().default(0),
    matchedRules: jsonb("matched_rules").$type<Array<{ id: string; name: string; action: string; score: number }>>().notNull().default([]),
    signals: jsonb("signals").$type<Record<string, unknown>>().notNull().default({}),
    reviewedBy: text("reviewed_by"),
    reviewedAt: ts("reviewed_at"),
    reviewOutcome: text("review_outcome"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("risk_decisions_payment_idx").on(t.paymentId)],
);
