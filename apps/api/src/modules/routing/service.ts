import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client.js";
import {
  paymentAttempts,
  providerAccounts,
  providerRoutes,
  providers,
  routingDecisions,
  routingRules,
  type RuleCondition,
} from "../../db/schema/index.js";
import { Errors } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { recordAudit, type Actor } from "../audit/service.js";
import { buildRoute, type Candidate, type ProviderStats, type RoutingContext, type RoutingResult, type RuleWithRoutes } from "./engine.js";

export async function loadRules(db: DbOrTx, scope: { mode: "test" | "live"; merchantId: string; transactionType: string }): Promise<RuleWithRoutes[]> {
  const rules = await db
    .select()
    .from(routingRules)
    .where(
      and(
        eq(routingRules.mode, scope.mode),
        eq(routingRules.transactionType, scope.transactionType),
        or(isNull(routingRules.merchantId), eq(routingRules.merchantId, scope.merchantId)),
      ),
    );
  if (!rules.length) return [];
  const routes = await db
    .select()
    .from(providerRoutes)
    .where(
      inArray(
        providerRoutes.routingRuleId,
        rules.map((r) => r.id),
      ),
    );
  return rules.map((r) => ({ ...r, routes: routes.filter((x) => x.routingRuleId === r.id) }));
}

export async function loadProviderStats(db: DbOrTx, sinceHours = 24): Promise<Map<string, ProviderStats>> {
  const since = new Date(Date.now() - sinceHours * 3600 * 1000);
  const rows = await db
    .select({
      providerAccountId: paymentAttempts.providerAccountId,
      total: sql<number>`count(*)`.mapWith(Number),
      success: sql<number>`count(*) filter (where ${paymentAttempts.outcome} in ('success','requires_action'))`.mapWith(Number),
      technical: sql<number>`count(*) filter (where ${paymentAttempts.outcome} in ('technical_error','timeout','provider_unavailable'))`.mapWith(Number),
      avgLatency: sql<number>`coalesce(avg(${paymentAttempts.latencyMs}), 0)`.mapWith(Number),
    })
    .from(paymentAttempts)
    .where(gte(paymentAttempts.createdAt, since))
    .groupBy(paymentAttempts.providerAccountId);
  const map = new Map<string, ProviderStats>();
  for (const r of rows) {
    const total = r.total || 0;
    map.set(r.providerAccountId, {
      approvalRate: total ? r.success / total : 1,
      uptime: total ? 1 - r.technical / total : 1,
      avgLatencyMs: r.avgLatency,
      sampleSize: total,
    });
  }
  return map;
}

export async function loadCandidates(db: DbOrTx, scope: { mode: "test" | "live"; merchantId: string }): Promise<Candidate[]> {
  const rows = await db
    .select({ account: providerAccounts, provider: providers })
    .from(providerAccounts)
    .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
    .where(and(eq(providerAccounts.mode, scope.mode), or(isNull(providerAccounts.merchantId), eq(providerAccounts.merchantId, scope.merchantId))))
    .orderBy(providerAccounts.priority);
  const stats = await loadProviderStats(db);
  return rows.map((r) => ({ account: r.account, provider: r.provider, stats: stats.get(r.account.id) }));
}

export async function decideRoute(db: DbOrTx, ctx: RoutingContext, ref: { paymentId?: string; payoutId?: string }): Promise<{ result: RoutingResult; decisionId: string }> {
  const [rules, candidates] = await Promise.all([
    loadRules(db, { mode: ctx.mode, merchantId: ctx.merchantId, transactionType: ctx.transactionType }),
    loadCandidates(db, { mode: ctx.mode, merchantId: ctx.merchantId }),
  ]);
  const result = buildRoute(rules, candidates, ctx);
  const decisionId = newId("routingDecision");
  await db.insert(routingDecisions).values({
    id: decisionId,
    paymentId: ref.paymentId ?? null,
    payoutId: ref.payoutId ?? null,
    routingRuleId: result.rule?.id ?? null,
    ruleName: result.rule?.name ?? null,
    strategy: result.strategy,
    candidates: result.candidates,
    selectedProviderAccountId: result.ordered[0]?.account.id ?? null,
    context: {
      amount: ctx.amount,
      currency: ctx.currency,
      country: ctx.country ?? null,
      payment_method: ctx.paymentMethod,
      risk_score: ctx.riskScore ?? null,
      reason: result.reason,
      excluded: ctx.excludeAccountIds ?? [],
    },
  });
  return { result, decisionId };
}

// ---------------------------------------------------------------------------
// Rule administration
// ---------------------------------------------------------------------------
export interface RuleInput {
  name: string;
  description?: string;
  merchantId?: string | null;
  projectId?: string | null;
  mode: "test" | "live";
  priority: number;
  enabled: boolean;
  transactionType: "payment" | "payout";
  conditions: RuleCondition[];
  strategy: "ordered" | "weighted" | "score";
  routes: Array<{ providerAccountId: string; weight?: number }>;
}

export async function listRulesAdmin(db: DbOrTx, filter: { mode?: string; merchantId?: string }) {
  const conds = [];
  if (filter.mode) conds.push(eq(routingRules.mode, filter.mode as never));
  if (filter.merchantId) conds.push(or(isNull(routingRules.merchantId), eq(routingRules.merchantId, filter.merchantId)));
  const rules = await db
    .select()
    .from(routingRules)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(routingRules.mode, routingRules.priority, desc(routingRules.createdAt));
  if (!rules.length) return [];
  const routes = await db
    .select({ route: providerRoutes, account: providerAccounts, provider: providers })
    .from(providerRoutes)
    .innerJoin(providerAccounts, eq(providerAccounts.id, providerRoutes.providerAccountId))
    .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
    .where(
      inArray(
        providerRoutes.routingRuleId,
        rules.map((r) => r.id),
      ),
    )
    .orderBy(providerRoutes.position);
  return rules.map((r) => ({
    ...r,
    routes: routes
      .filter((x) => x.route.routingRuleId === r.id)
      .map((x) => ({
        id: x.route.id,
        provider_account_id: x.account.id,
        account_name: x.account.name,
        provider_id: x.provider.id,
        provider_name: x.provider.name,
        position: x.route.position,
        weight: x.route.weight,
      })),
  }));
}

async function assertAccounts(db: DbOrTx, ids: string[]) {
  if (!ids.length) return;
  const rows = await db.select({ id: providerAccounts.id }).from(providerAccounts).where(inArray(providerAccounts.id, ids));
  if (rows.length !== new Set(ids).size) throw Errors.badRequest("invalid_provider_account", "One or more provider accounts do not exist", "routes");
}

export async function createRule(db: Db, input: RuleInput, actor: Actor) {
  await assertAccounts(
    db,
    input.routes.map((r) => r.providerAccountId),
  );
  const id = newId("routingRule");
  await db.transaction(async (tx) => {
    await tx.insert(routingRules).values({
      id,
      merchantId: input.merchantId ?? null,
      projectId: input.projectId ?? null,
      mode: input.mode,
      name: input.name,
      description: input.description ?? null,
      priority: input.priority,
      enabled: input.enabled,
      transactionType: input.transactionType,
      conditions: input.conditions,
      strategy: input.strategy,
      createdBy: actor.id ?? null,
    });
    if (input.routes.length) {
      await tx.insert(providerRoutes).values(
        input.routes.map((r, i) => ({
          id: newId("providerRoute"),
          routingRuleId: id,
          providerAccountId: r.providerAccountId,
          position: i,
          weight: r.weight ?? 100,
        })),
      );
    }
    await recordAudit(tx, { actor, action: "routing_rule.created", entityType: "routing_rule", entityId: id, after: input, merchantId: input.merchantId ?? undefined });
  });
  return id;
}

export async function updateRule(db: Db, id: string, input: Partial<RuleInput>, actor: Actor) {
  const [existing] = await db.select().from(routingRules).where(eq(routingRules.id, id)).limit(1);
  if (!existing) throw Errors.notFound("Routing rule", id);
  if (input.routes) {
    await assertAccounts(
      db,
      input.routes.map((r) => r.providerAccountId),
    );
  }
  await db.transaction(async (tx) => {
    await tx
      .update(routingRules)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.mode !== undefined ? { mode: input.mode } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.conditions !== undefined ? { conditions: input.conditions } : {}),
        ...(input.strategy !== undefined ? { strategy: input.strategy } : {}),
        ...(input.transactionType !== undefined ? { transactionType: input.transactionType } : {}),
        ...(input.merchantId !== undefined ? { merchantId: input.merchantId } : {}),
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(routingRules.id, id));
    if (input.routes) {
      await tx.delete(providerRoutes).where(eq(providerRoutes.routingRuleId, id));
      if (input.routes.length) {
        await tx.insert(providerRoutes).values(
          input.routes.map((r, i) => ({
            id: newId("providerRoute"),
            routingRuleId: id,
            providerAccountId: r.providerAccountId,
            position: i,
            weight: r.weight ?? 100,
          })),
        );
      }
    }
    await recordAudit(tx, {
      actor,
      action: "routing_rule.updated",
      entityType: "routing_rule",
      entityId: id,
      before: existing,
      after: input,
      merchantId: existing.merchantId ?? undefined,
    });
  });
}

export async function deleteRule(db: Db, id: string, actor: Actor) {
  const [existing] = await db.select().from(routingRules).where(eq(routingRules.id, id)).limit(1);
  if (!existing) throw Errors.notFound("Routing rule", id);
  await db.transaction(async (tx) => {
    await tx.delete(routingRules).where(eq(routingRules.id, id));
    await recordAudit(tx, { actor, action: "routing_rule.deleted", entityType: "routing_rule", entityId: id, before: existing });
  });
}

/** Dry-run a routing context against current rules (admin "simulate" feature). */
export async function simulateRoute(db: DbOrTx, ctx: RoutingContext): Promise<RoutingResult> {
  const [rules, candidates] = await Promise.all([
    loadRules(db, { mode: ctx.mode, merchantId: ctx.merchantId, transactionType: ctx.transactionType }),
    loadCandidates(db, { mode: ctx.mode, merchantId: ctx.merchantId }),
  ]);
  return buildRoute(rules, candidates, ctx);
}

export async function getDecision(db: DbOrTx, id: string) {
  const [d] = await db.select().from(routingDecisions).where(eq(routingDecisions.id, id)).limit(1);
  return d ?? null;
}
