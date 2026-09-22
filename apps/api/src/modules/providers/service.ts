import { and, desc, eq, gte, sql } from "drizzle-orm";
import { loadConfig } from "../../config.js";
import type { Db, DbOrTx } from "../../db/client.js";
import { paymentAttempts, providerAccounts, providers, systemEvents, type ProviderAccountConfig } from "../../db/schema/index.js";
import { encryptJson } from "../../lib/crypto.js";
import { Errors } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { buildProviderContext } from "../../providers/context.js";
import { getAdapter, listAdapters } from "../../providers/registry.js";
import { recordAudit, recordSystemEvent, type Actor } from "../audit/service.js";

export type ProviderRow = typeof providers.$inferSelect;
export type AccountRow = typeof providerAccounts.$inferSelect;

export function serializeProvider(p: ProviderRow) {
  return {
    id: p.id,
    object: "provider",
    code: p.code,
    name: p.name,
    type: p.type,
    adapter_key: p.adapterKey,
    status: p.status,
    supported_methods: p.supportedMethods,
    supported_currencies: p.supportedCurrencies,
    supported_countries: p.supportedCountries,
    capabilities: p.capabilities,
    settlement_entity: p.settlementEntity,
    description: p.description,
    created_at: p.createdAt,
  };
}

/** Never exposes credentials. */
export function serializeAccount(a: AccountRow, provider?: ProviderRow | null) {
  return {
    id: a.id,
    object: "provider_account",
    provider_id: a.providerId,
    provider_name: provider?.name ?? null,
    provider_code: provider?.code ?? null,
    provider_type: provider?.type ?? null,
    merchant_id: a.merchantId,
    mode: a.mode,
    name: a.name,
    status: a.status,
    priority: a.priority,
    has_credentials: Boolean(a.credentialsEnc),
    config: a.config,
    fee_percent: Number(a.feePercent),
    fee_fixed_minor: a.feeFixedMinor,
    limits: a.limits,
    currencies: a.currencies,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}

export interface HealthStats {
  provider_account_id: string;
  window_hours: number;
  attempts: number;
  successes: number;
  declines: number;
  technical_failures: number;
  approval_rate: number | null;
  uptime: number | null;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  last_error_at: Date | null;
}

export async function providerHealth(db: DbOrTx, windowHours = 24): Promise<HealthStats[]> {
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  const rows = await db
    .select({
      id: paymentAttempts.providerAccountId,
      attempts: sql<number>`count(*)`.mapWith(Number),
      successes: sql<number>`count(*) filter (where ${paymentAttempts.outcome} in ('success','requires_action'))`.mapWith(Number),
      declines: sql<number>`count(*) filter (where ${paymentAttempts.outcome} in ('soft_decline','hard_decline'))`.mapWith(Number),
      technical: sql<number>`count(*) filter (where ${paymentAttempts.outcome} in ('technical_error','timeout','provider_unavailable'))`.mapWith(Number),
      avgLatency: sql<number>`avg(${paymentAttempts.latencyMs})`.mapWith(Number),
      p95: sql<number>`percentile_cont(0.95) within group (order by ${paymentAttempts.latencyMs})`.mapWith(Number),
      lastError: sql<Date | null>`max(${paymentAttempts.createdAt}) filter (where ${paymentAttempts.outcome} in ('technical_error','timeout','provider_unavailable'))`,
    })
    .from(paymentAttempts)
    .where(gte(paymentAttempts.createdAt, since))
    .groupBy(paymentAttempts.providerAccountId);
  return rows.map((r) => ({
    provider_account_id: r.id,
    window_hours: windowHours,
    attempts: r.attempts,
    successes: r.successes,
    declines: r.declines,
    technical_failures: r.technical,
    approval_rate: r.attempts ? r.successes / r.attempts : null,
    uptime: r.attempts ? 1 - r.technical / r.attempts : null,
    avg_latency_ms: r.attempts ? Math.round(r.avgLatency ?? 0) : null,
    p95_latency_ms: r.attempts ? Math.round(r.p95 ?? 0) : null,
    last_error_at: r.lastError ? new Date(r.lastError) : null,
  }));
}

export async function listProvidersWithAccounts(db: DbOrTx, f: { mode?: "test" | "live"; merchantId?: string } = {}) {
  const provs = await db.select().from(providers).orderBy(providers.name);
  const conds = [];
  if (f.mode) conds.push(eq(providerAccounts.mode, f.mode));
  const accounts = await db
    .select()
    .from(providerAccounts)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(providerAccounts.priority);
  const health = await providerHealth(db);
  const hmap = new Map(health.map((h) => [h.provider_account_id, h]));
  const adapters = new Set(listAdapters().map((a) => a.key));
  return provs.map((p) => ({
    ...serializeProvider(p),
    adapter_registered: adapters.has(p.adapterKey),
    accounts: accounts
      .filter((a) => a.providerId === p.id && (!f.merchantId || !a.merchantId || a.merchantId === f.merchantId))
      .map((a) => ({ ...serializeAccount(a, p), health: hmap.get(a.id) ?? null })),
  }));
}

export async function setProviderStatus(db: Db, providerId: string, status: "active" | "disabled", actor: Actor, reason?: string) {
  const [before] = await db.select().from(providers).where(eq(providers.id, providerId)).limit(1);
  if (!before) throw Errors.notFound("Provider", providerId);
  await db.update(providers).set({ status, updatedAt: new Date() }).where(eq(providers.id, providerId));
  await recordAudit(db, { actor, action: status === "disabled" ? "provider.disabled" : "provider.enabled", entityType: "provider", entityId: providerId, before: { status: before.status }, after: { status, reason } });
  await recordSystemEvent(db, { level: status === "disabled" ? "warning" : "info", source: "admin", type: `provider.${status}`, message: `${before.name} ${status} by ${actor.label ?? actor.id}${reason ? `: ${reason}` : ""}` });
}

export async function updateProviderAccount(
  db: Db,
  accountId: string,
  input: { name?: string; status?: "active" | "disabled"; priority?: number; feePercent?: number; feeFixedMinor?: number; limits?: Record<string, number>; currencies?: string[]; config?: ProviderAccountConfig; credentials?: Record<string, unknown> },
  actor: Actor,
) {
  const [before] = await db.select().from(providerAccounts).where(eq(providerAccounts.id, accountId)).limit(1);
  if (!before) throw Errors.notFound("Provider account", accountId);
  const cfg = loadConfig();
  const [after] = await db
    .update(providerAccounts)
    .set({
      ...(input.name ? { name: input.name } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.feePercent !== undefined ? { feePercent: String(input.feePercent) } : {}),
      ...(input.feeFixedMinor !== undefined ? { feeFixedMinor: input.feeFixedMinor } : {}),
      ...(input.limits ? { limits: input.limits } : {}),
      ...(input.currencies ? { currencies: input.currencies.map((c) => c.toUpperCase()) } : {}),
      ...(input.config ? { config: { ...before.config, ...input.config } } : {}),
      ...(input.credentials ? { credentialsEnc: encryptJson(input.credentials, cfg.NATIO_ENCRYPTION_KEY) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(providerAccounts.id, accountId))
    .returning();
  await recordAudit(db, {
    actor,
    action: "provider_account.updated",
    entityType: "provider_account",
    entityId: accountId,
    before: serializeAccount(before),
    after: { ...serializeAccount(after!), credentials_rotated: Boolean(input.credentials) },
  });
  if (input.status && input.status !== before.status) {
    await recordSystemEvent(db, { level: input.status === "disabled" ? "warning" : "info", source: "admin", type: `provider_account.${input.status}`, message: `${before.name} ${input.status} by ${actor.label ?? actor.id}`, providerAccountId: accountId });
  }
  if (input.config?.simulation?.forceOutcome !== undefined && input.config.simulation.forceOutcome !== before.config.simulation?.forceOutcome) {
    await recordSystemEvent(db, { level: "info", source: "admin", type: "provider_account.simulation", message: `${before.name} simulation set to ${input.config.simulation.forceOutcome ?? "none"}`, providerAccountId: accountId });
  }
  return after!;
}

export async function createProviderAccount(
  db: Db,
  input: { providerId: string; mode: "test" | "live"; name: string; merchantId?: string | null; priority?: number; feePercent?: number; feeFixedMinor?: number; currencies?: string[]; credentials?: Record<string, unknown>; config?: ProviderAccountConfig },
  actor: Actor,
) {
  const [provider] = await db.select().from(providers).where(eq(providers.id, input.providerId)).limit(1);
  if (!provider) throw Errors.notFound("Provider", input.providerId);
  const cfg = loadConfig();
  const [account] = await db
    .insert(providerAccounts)
    .values({
      id: newId("providerAccount"),
      providerId: input.providerId,
      merchantId: input.merchantId ?? null,
      mode: input.mode,
      name: input.name,
      priority: input.priority ?? 100,
      feePercent: String(input.feePercent ?? 0),
      feeFixedMinor: input.feeFixedMinor ?? 0,
      currencies: (input.currencies ?? []).map((c) => c.toUpperCase()),
      credentialsEnc: input.credentials ? encryptJson(input.credentials, cfg.NATIO_ENCRYPTION_KEY) : null,
      config: input.config ?? {},
    })
    .returning();
  await recordAudit(db, { actor, action: "provider_account.created", entityType: "provider_account", entityId: account!.id, after: serializeAccount(account!, provider) });
  return account!;
}

export async function runHealthCheck(db: Db, accountId: string, actor?: Actor) {
  const [row] = await db
    .select({ account: providerAccounts, provider: providers })
    .from(providerAccounts)
    .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
    .where(eq(providerAccounts.id, accountId))
    .limit(1);
  if (!row) throw Errors.notFound("Provider account", accountId);
  const adapter = getAdapter(row.provider.adapterKey);
  if (!adapter.healthCheck) return { ok: true, latencyMs: 0, message: "adapter has no health check" };
  const result = await adapter.healthCheck(buildProviderContext(row.account, row.provider));
  await recordSystemEvent(db, {
    level: result.ok ? "info" : "error",
    source: "health-check",
    type: result.ok ? "provider.healthy" : "provider.unhealthy",
    message: `${row.provider.name} (${row.account.name}): ${result.message ?? (result.ok ? "ok" : "failed")} in ${result.latencyMs} ms`,
    providerAccountId: accountId,
    data: { triggered_by: actor?.label ?? "system" },
  });
  return result;
}

export async function recentProviderEvents(db: DbOrTx, accountId: string, limit = 20) {
  return db.select().from(systemEvents).where(eq(systemEvents.providerAccountId, accountId)).orderBy(desc(systemEvents.createdAt)).limit(limit);
}
