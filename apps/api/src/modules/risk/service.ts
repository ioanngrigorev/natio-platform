import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client.js";
import { payments, riskDecisions, riskRules, type RiskCondition } from "../../db/schema/index.js";
import { Errors } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { recordAudit, type Actor } from "../audit/service.js";
import { evaluateRisk, type RiskResult, type RiskSignals } from "./engine.js";

export async function loadRiskRules(db: DbOrTx, scope: { mode: "test" | "live"; merchantId: string }) {
  return db
    .select()
    .from(riskRules)
    .where(and(eq(riskRules.mode, scope.mode), or(isNull(riskRules.merchantId), eq(riskRules.merchantId, scope.merchantId))));
}

/** Compute velocity signals for a customer/IP in the recent window. */
export async function computeVelocity(
  db: DbOrTx,
  scope: { merchantId: string; mode: "test" | "live"; customerId?: string | null; ip?: string | null },
): Promise<Pick<RiskSignals, "velocity1h" | "velocity24h" | "failedAttempts24h" | "amount24h">> {
  if (!scope.customerId && !scope.ip) return { velocity1h: 0, velocity24h: 0, failedAttempts24h: 0, amount24h: 0 };
  const since24 = new Date(Date.now() - 24 * 3600 * 1000);
  const since1 = new Date(Date.now() - 3600 * 1000);
  const who = scope.customerId ? eq(payments.customerId, scope.customerId) : sql`${payments.device}->>'ip' = ${scope.ip}`;
  const [row] = await db
    .select({
      v24: sql<number>`count(*)`.mapWith(Number),
      v1: sql<number>`count(*) filter (where ${payments.createdAt} >= ${since1})`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${payments.status} = 'failed')`.mapWith(Number),
      amount: sql<number>`coalesce(sum(${payments.amount}) filter (where ${payments.status} in ('successful','authorized','processing')), 0)`.mapWith(Number),
    })
    .from(payments)
    .where(and(eq(payments.merchantId, scope.merchantId), eq(payments.mode, scope.mode), gte(payments.createdAt, since24), who));
  return { velocity1h: row?.v1 ?? 0, velocity24h: row?.v24 ?? 0, failedAttempts24h: row?.failed ?? 0, amount24h: row?.amount ?? 0 };
}

export async function assessPayment(db: DbOrTx, paymentId: string, signals: RiskSignals, mode: "test" | "live"): Promise<RiskResult & { decisionId: string }> {
  const rules = await loadRiskRules(db, { mode, merchantId: signals.merchantId });
  const result = evaluateRisk(rules, signals, mode);
  const decisionId = newId("riskDecision");
  await db.insert(riskDecisions).values({
    id: decisionId,
    paymentId,
    decision: result.decision,
    score: result.score,
    matchedRules: result.matched,
    signals: {
      country: signals.country ?? null,
      amount: signals.amount,
      currency: signals.currency,
      payment_method: signals.paymentMethod,
      ip: signals.ip ?? null,
      velocity_1h: signals.velocity1h ?? 0,
      velocity_24h: signals.velocity24h ?? 0,
      failed_attempts_24h: signals.failedAttempts24h ?? 0,
      amount_24h: signals.amount24h ?? 0,
    },
  });
  return { ...result, decisionId };
}

export interface RiskRuleInput {
  name: string;
  description?: string;
  merchantId?: string | null;
  mode: "test" | "live";
  priority: number;
  enabled: boolean;
  conditions: RiskCondition[];
  action: "allow" | "review" | "block";
  score: number;
}

export async function listRiskRules(db: DbOrTx, filter: { mode?: string; merchantId?: string }) {
  const conds = [];
  if (filter.mode) conds.push(eq(riskRules.mode, filter.mode as never));
  if (filter.merchantId) conds.push(or(isNull(riskRules.merchantId), eq(riskRules.merchantId, filter.merchantId)));
  return db
    .select()
    .from(riskRules)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(riskRules.mode, riskRules.priority, desc(riskRules.createdAt));
}

export async function createRiskRule(db: Db, input: RiskRuleInput, actor: Actor) {
  const id = newId("riskRule");
  await db.transaction(async (tx) => {
    await tx.insert(riskRules).values({
      id,
      merchantId: input.merchantId ?? null,
      mode: input.mode,
      name: input.name,
      description: input.description ?? null,
      priority: input.priority,
      enabled: input.enabled,
      conditions: input.conditions,
      action: input.action,
      score: input.score,
      createdBy: actor.id ?? null,
    });
    await recordAudit(tx, { actor, action: "risk_rule.created", entityType: "risk_rule", entityId: id, after: input });
  });
  return id;
}

export async function updateRiskRule(db: Db, id: string, input: Partial<RiskRuleInput>, actor: Actor) {
  const [existing] = await db.select().from(riskRules).where(eq(riskRules.id, id)).limit(1);
  if (!existing) throw Errors.notFound("Risk rule", id);
  await db.transaction(async (tx) => {
    await tx
      .update(riskRules)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.mode !== undefined ? { mode: input.mode } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.conditions !== undefined ? { conditions: input.conditions } : {}),
        ...(input.action !== undefined ? { action: input.action } : {}),
        ...(input.score !== undefined ? { score: input.score } : {}),
        ...(input.merchantId !== undefined ? { merchantId: input.merchantId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(riskRules.id, id));
    await recordAudit(tx, { actor, action: "risk_rule.updated", entityType: "risk_rule", entityId: id, before: existing, after: input });
  });
}

export async function deleteRiskRule(db: Db, id: string, actor: Actor) {
  const [existing] = await db.select().from(riskRules).where(eq(riskRules.id, id)).limit(1);
  if (!existing) throw Errors.notFound("Risk rule", id);
  await db.transaction(async (tx) => {
    await tx.delete(riskRules).where(eq(riskRules.id, id));
    await recordAudit(tx, { actor, action: "risk_rule.deleted", entityType: "risk_rule", entityId: id, before: existing });
  });
}
