/**
 * Strict state machines for financial objects. Transitions are validated here and
 * persisted through `applyTransition`, which uses a status guard in the UPDATE so that
 * concurrent writers can never produce an invalid path.
 */
import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import { payments, payouts, refunds, stateTransitions } from "../../db/schema/index.js";
import { Errors } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";

export type PaymentStatus =
  | "created"
  | "pending"
  | "processing"
  | "authorized"
  | "captured"
  | "successful"
  | "failed"
  | "cancelled"
  | "refunded"
  | "partially_refunded";
export type RefundStatus = "created" | "processing" | "successful" | "failed";
export type PayoutStatus = "created" | "pending" | "processing" | "successful" | "failed" | "cancelled";

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  created: ["processing", "pending", "failed", "cancelled"],
  pending: ["processing", "failed", "cancelled"],
  processing: ["authorized", "successful", "failed", "cancelled", "pending"],
  authorized: ["successful", "cancelled", "failed"],
  captured: ["successful"],
  successful: ["partially_refunded", "refunded"],
  partially_refunded: ["partially_refunded", "refunded"],
  refunded: [],
  failed: [],
  cancelled: [],
};

export const REFUND_TRANSITIONS: Record<RefundStatus, RefundStatus[]> = {
  created: ["processing", "failed"],
  processing: ["successful", "failed"],
  successful: [],
  failed: [],
};

export const PAYOUT_TRANSITIONS: Record<PayoutStatus, PayoutStatus[]> = {
  created: ["pending", "processing", "failed", "cancelled"],
  pending: ["processing", "failed", "cancelled"],
  processing: ["successful", "failed"],
  successful: [],
  failed: [],
  cancelled: [],
};

export const TERMINAL_PAYMENT_STATUSES: PaymentStatus[] = ["failed", "cancelled", "refunded"];

export function canTransition<S extends string>(table: Record<S, S[]>, from: S, to: S): boolean {
  return table[from]?.includes(to) ?? false;
}

export function assertTransition<S extends string>(entity: string, table: Record<S, S[]>, from: S, to: S): void {
  if (!canTransition(table, from, to)) throw Errors.invalidTransition(entity, from, to);
}

export interface TransitionActor {
  type: string;
  id?: string;
}

type EntityKind = "payment" | "refund" | "payout";

const TABLES = {
  payment: { table: payments, transitions: PAYMENT_TRANSITIONS as Record<string, string[]> },
  refund: { table: refunds, transitions: REFUND_TRANSITIONS as Record<string, string[]> },
  payout: { table: payouts, transitions: PAYOUT_TRANSITIONS as Record<string, string[]> },
} as const;

/**
 * Apply a transition with a database-level guard. Returns the updated row.
 * Throws invalid_state_transition if the transition is not allowed or if the row is no
 * longer in `from` (lost race).
 */
export async function applyTransition<K extends EntityKind>(
  db: DbOrTx,
  kind: K,
  id: string,
  from: string,
  to: string,
  opts: { reason?: string; actor?: TransitionActor; set?: Record<string, unknown> } = {},
): Promise<(typeof TABLES)[K]["table"]["$inferSelect"]> {
  const { table, transitions } = TABLES[kind];
  if (!canTransition(transitions, from, to)) throw Errors.invalidTransition(kind, from, to);

  const rows = (await (db as never as { update: typeof db.update })
    .update(table as typeof payments)
    .set({
      ...(opts.set ?? {}),
      status: to as never,
      updatedAt: new Date(),
      ...(kind === "payment" ? { version: sql`${payments.version} + 1` } : {}),
    } as never)
    .where(and(eq((table as typeof payments).id, id), eq((table as typeof payments).status, from as never)))
    .returning()) as Array<(typeof TABLES)[K]["table"]["$inferSelect"]>;

  if (rows.length !== 1) throw Errors.invalidTransition(kind, from, to);
  await db.insert(stateTransitions).values({
    id: newId("transition"),
    entityType: kind,
    entityId: id,
    fromStatus: from,
    toStatus: to,
    reason: opts.reason ?? null,
    actor: opts.actor ?? { type: "system" },
  });
  return rows[0]!;
}
