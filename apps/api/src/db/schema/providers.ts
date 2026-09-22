import { bigint, boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import {
  accountStatusEnum,
  modeEnum,
  providerStatusEnum,
  providerTypeEnum,
  routingStrategyEnum,
} from "./enums.js";
import { merchants, projects } from "./merchants.js";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export interface ProviderCapabilities {
  payments: boolean;
  refunds: boolean;
  capture: boolean;
  payouts: boolean;
  tokenization?: boolean;
  hostedPage?: boolean;
}

/** A provider is a connectable financial/payment organisation, implemented by an adapter. */
export const providers = pgTable(
  "providers",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: providerTypeEnum("type").notNull(),
    /** Key in the adapter registry (e.g. "mock_acquirer"). */
    adapterKey: text("adapter_key").notNull(),
    status: providerStatusEnum("status").notNull().default("active"),
    supportedMethods: jsonb("supported_methods").$type<string[]>().notNull().default([]),
    supportedCurrencies: jsonb("supported_currencies").$type<string[]>().notNull().default([]),
    supportedCountries: jsonb("supported_countries").$type<string[]>().notNull().default([]),
    capabilities: jsonb("capabilities")
      .$type<ProviderCapabilities>()
      .notNull()
      .default({ payments: true, refunds: true, capture: true, payouts: false }),
    /** Legal entity that performs settlement for this provider (informational). */
    settlementEntity: text("settlement_entity"),
    description: text("description"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("providers_code_uq").on(t.code)],
);

export interface ProviderAccountConfig {
  /** Sandbox simulation settings for mock adapters. */
  simulation?: {
    /** Force every request to this outcome (admin can simulate an outage). */
    forceOutcome?: "success" | "soft_decline" | "hard_decline" | "technical_error" | "timeout" | "provider_unavailable";
    /** Probability (0..1) of a random technical error; default 0. */
    technicalErrorRate?: number;
    /** Base latency in ms for the simulated provider; default 40. */
    latencyMs?: number;
  };
  /** Provider-specific non-secret settings (endpoints, MIDs, descriptors). */
  [key: string]: unknown;
}

export interface ProviderLimits {
  minAmount?: number;
  maxAmount?: number;
  dailyVolume?: number;
}

/** A provider account is a concrete integration (credentials + MID) in test or live mode. */
export const providerAccounts = pgTable(
  "provider_accounts",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id),
    /** Null = platform-level shared account; otherwise account dedicated to a merchant. */
    merchantId: text("merchant_id").references(() => merchants.id),
    mode: modeEnum("mode").notNull(),
    name: text("name").notNull(),
    status: accountStatusEnum("status").notNull().default("active"),
    /** Lower number = higher priority when no rule applies. */
    priority: integer("priority").notNull().default(100),
    /** AES-256-GCM encrypted JSON blob with provider credentials. Never returned by the API. */
    credentialsEnc: text("credentials_enc"),
    config: jsonb("config").$type<ProviderAccountConfig>().notNull().default({}),
    feePercent: numeric("fee_percent", { precision: 8, scale: 4 }).notNull().default("0"),
    feeFixedMinor: bigint("fee_fixed_minor", { mode: "number" }).notNull().default(0),
    limits: jsonb("limits").$type<ProviderLimits>().notNull().default({}),
    currencies: jsonb("currencies").$type<string[]>().notNull().default([]),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("provider_accounts_provider_idx").on(t.providerId, t.mode)],
);

export type RuleOperator = "eq" | "neq" | "in" | "not_in" | "gt" | "gte" | "lt" | "lte" | "between";
export type RuleField =
  | "country"
  | "currency"
  | "merchant_id"
  | "project_id"
  | "payment_method"
  | "amount"
  | "transaction_type"
  | "risk_score"
  | "hour_of_day"
  | "day_of_week"
  | "customer_country";

export interface RuleCondition {
  field: RuleField;
  op: RuleOperator;
  value: string | number | Array<string | number>;
}

export const routingRules = pgTable(
  "routing_rules",
  {
    id: text("id").primaryKey(),
    /** Null = global rule maintained by NATIO operations. */
    merchantId: text("merchant_id").references(() => merchants.id),
    projectId: text("project_id").references(() => projects.id),
    mode: modeEnum("mode").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** Lower number = evaluated first. */
    priority: integer("priority").notNull().default(100),
    enabled: boolean("enabled").notNull().default(true),
    /** Transaction type this rule applies to. */
    transactionType: text("transaction_type").notNull().default("payment"),
    conditions: jsonb("conditions").$type<RuleCondition[]>().notNull().default([]),
    strategy: routingStrategyEnum("strategy").notNull().default("ordered"),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("routing_rules_scope_idx").on(t.mode, t.merchantId, t.priority)],
);

/** Ordered provider candidates for a routing rule. */
export const providerRoutes = pgTable(
  "provider_routes",
  {
    id: text("id").primaryKey(),
    routingRuleId: text("routing_rule_id")
      .notNull()
      .references(() => routingRules.id, { onDelete: "cascade" }),
    providerAccountId: text("provider_account_id")
      .notNull()
      .references(() => providerAccounts.id),
    position: integer("position").notNull().default(0),
    weight: integer("weight").notNull().default(100),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("provider_routes_rule_idx").on(t.routingRuleId, t.position)],
);

export interface RoutingCandidate {
  providerAccountId: string;
  providerId: string;
  providerName: string;
  accountName: string;
  score: number;
  eligible: boolean;
  reasons: string[];
  factors?: Record<string, number>;
}

export const routingDecisions = pgTable(
  "routing_decisions",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id"),
    payoutId: text("payout_id"),
    routingRuleId: text("routing_rule_id"),
    ruleName: text("rule_name"),
    strategy: text("strategy").notNull(),
    candidates: jsonb("candidates").$type<RoutingCandidate[]>().notNull().default([]),
    selectedProviderAccountId: text("selected_provider_account_id"),
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    evaluatedAt: ts("evaluated_at").notNull().defaultNow(),
  },
  (t) => [index("routing_decisions_payment_idx").on(t.paymentId)],
);
