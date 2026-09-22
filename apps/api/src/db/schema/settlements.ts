import { bigint, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import {
  modeEnum,
  reconBatchStatusEnum,
  reconItemStatusEnum,
  reconSourceEnum,
  settlementSourceEnum,
  settlementStatusEnum,
} from "./enums.js";
import { merchants } from "./merchants.js";
import { providerAccounts } from "./providers.js";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => bigint(name, { mode: "number" });

/**
 * Settlement information reported by a licensed provider. NATIO is not a custodian:
 * these rows describe money moved by the provider to the merchant, not by NATIO.
 */
export const settlements = pgTable(
  "settlements",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    mode: modeEnum("mode").notNull(),
    providerAccountId: text("provider_account_id")
      .notNull()
      .references(() => providerAccounts.id),
    settlementReference: text("settlement_reference"),
    currency: text("currency").notNull(),
    grossAmount: money("gross_amount").notNull(),
    feeAmount: money("fee_amount").notNull().default(0),
    netAmount: money("net_amount").notNull(),
    transactionCount: integer("transaction_count").notNull().default(0),
    periodStart: ts("period_start").notNull(),
    periodEnd: ts("period_end").notNull(),
    status: settlementStatusEnum("status").notNull().default("pending"),
    source: settlementSourceEnum("source").notNull().default("provider_report"),
    settledAt: ts("settled_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("settlements_merchant_idx").on(t.merchantId, t.mode, t.periodEnd)],
);

export const settlementItems = pgTable(
  "settlement_items",
  {
    id: text("id").primaryKey(),
    settlementId: text("settlement_id")
      .notNull()
      .references(() => settlements.id, { onDelete: "cascade" }),
    transactionId: text("transaction_id").notNull(),
    amount: money("amount").notNull(),
    feeAmount: money("fee_amount").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("settlement_items_settlement_idx").on(t.settlementId)],
);

export interface ReconTotals {
  total: number;
  MATCHED: number;
  MISSING_PROVIDER: number;
  MISSING_NATIO: number;
  AMOUNT_MISMATCH: number;
  STATUS_MISMATCH: number;
}

export const reconciliationBatches = pgTable(
  "reconciliation_batches",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").references(() => merchants.id),
    mode: modeEnum("mode").notNull(),
    providerAccountId: text("provider_account_id")
      .notNull()
      .references(() => providerAccounts.id),
    source: reconSourceEnum("source").notNull().default("csv"),
    fileName: text("file_name"),
    periodStart: ts("period_start"),
    periodEnd: ts("period_end"),
    status: reconBatchStatusEnum("status").notNull().default("processing"),
    totals: jsonb("totals")
      .$type<ReconTotals>()
      .notNull()
      .default({ total: 0, MATCHED: 0, MISSING_PROVIDER: 0, MISSING_NATIO: 0, AMOUNT_MISMATCH: 0, STATUS_MISMATCH: 0 }),
    error: text("error"),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
    completedAt: ts("completed_at"),
  },
  (t) => [index("recon_batches_merchant_idx").on(t.merchantId, t.mode, t.createdAt)],
);

export const reconciliationItems = pgTable(
  "reconciliation_items",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id")
      .notNull()
      .references(() => reconciliationBatches.id, { onDelete: "cascade" }),
    status: reconItemStatusEnum("status").notNull(),
    transactionId: text("transaction_id"),
    paymentId: text("payment_id"),
    providerReference: text("provider_reference"),
    natioAmount: money("natio_amount"),
    providerAmount: money("provider_amount"),
    currency: text("currency"),
    natioStatus: text("natio_status"),
    providerStatus: text("provider_status"),
    notes: text("notes"),
    resolvedAt: ts("resolved_at"),
    resolvedBy: text("resolved_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("recon_items_batch_idx").on(t.batchId, t.status)],
);
