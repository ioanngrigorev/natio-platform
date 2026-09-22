import { bigint, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * Provider-side state of the NATIO Demo (mock) providers. This table simulates the
 * ledger of an external provider so that getPayment/refund/webhook flows behave realistically
 * in the sandbox. It is never used by real provider adapters.
 */
export const mockProviderRecords = pgTable(
  "mock_provider_records",
  {
    id: text("id").primaryKey(),
    providerAccountId: text("provider_account_id").notNull(),
    kind: text("kind").notNull(), // payment | refund | payout
    externalId: text("external_id").notNull(),
    natioReference: text("natio_reference"),
    status: text("status").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    capturedAmount: bigint("captured_amount", { mode: "number" }).notNull().default(0),
    refundedAmount: bigint("refunded_amount", { mode: "number" }).notNull().default(0),
    currency: text("currency").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mock_records_external_uq").on(t.providerAccountId, t.externalId), index("mock_records_ref_idx").on(t.natioReference)],
);
