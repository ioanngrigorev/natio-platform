import { and, desc, eq, lt, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import { auditLogs, systemEvents } from "../../db/schema/index.js";
import { newId } from "../../lib/ids.js";
import { logger } from "../../lib/logger.js";

export interface Actor {
  type: "merchant_user" | "admin_user" | "api_key" | "system";
  id?: string;
  label?: string;
  merchantId?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export interface AuditInput {
  actor: Actor;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  merchantId?: string;
}

const SENSITIVE_KEYS = /password|secret|credential|token|hash|cvv|pan/i;

/** Strip sensitive keys before persisting before/after snapshots. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object" || depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

export async function recordAudit(db: DbOrTx, input: AuditInput): Promise<void> {
  await db.insert(auditLogs).values({
    id: newId("audit"),
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    actorLabel: input.actor.label ?? null,
    merchantId: input.merchantId ?? input.actor.merchantId ?? null,
    action: input.action,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    before: input.before === undefined ? null : redact(input.before),
    after: input.after === undefined ? null : redact(input.after),
    ip: input.actor.ip ?? null,
    userAgent: input.actor.userAgent?.slice(0, 500) ?? null,
    requestId: input.actor.requestId ?? null,
  });
}

export async function listAudit(
  db: DbOrTx,
  filter: { merchantId?: string; actorType?: string; action?: string; entityId?: string; limit?: number; before?: Date },
) {
  const conds: SQL[] = [];
  if (filter.merchantId) conds.push(eq(auditLogs.merchantId, filter.merchantId));
  if (filter.actorType) conds.push(eq(auditLogs.actorType, filter.actorType as never));
  if (filter.action) conds.push(sql`${auditLogs.action} ILIKE ${"%" + filter.action + "%"}`);
  if (filter.entityId) conds.push(eq(auditLogs.entityId, filter.entityId));
  if (filter.before) conds.push(lt(auditLogs.createdAt, filter.before));
  return db
    .select()
    .from(auditLogs)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(Math.min(filter.limit ?? 50, 200));
}

export async function recordSystemEvent(
  db: DbOrTx,
  input: {
    level?: "info" | "warning" | "error";
    source: string;
    type: string;
    message: string;
    providerAccountId?: string | null;
    merchantId?: string | null;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await db.insert(systemEvents).values({
      id: newId("systemEvent"),
      level: input.level ?? "info",
      source: input.source,
      type: input.type,
      message: input.message,
      providerAccountId: input.providerAccountId ?? null,
      merchantId: input.merchantId ?? null,
      data: input.data ?? {},
    });
  } catch (err) {
    logger.error({ err }, "failed to record system event");
  }
}

export async function listSystemEvents(db: DbOrTx, filter: { level?: string; source?: string; limit?: number; before?: Date }) {
  const conds: SQL[] = [];
  if (filter.level) conds.push(eq(systemEvents.level, filter.level as never));
  if (filter.source) conds.push(eq(systemEvents.source, filter.source));
  if (filter.before) conds.push(lt(systemEvents.createdAt, filter.before));
  return db
    .select()
    .from(systemEvents)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(systemEvents.createdAt))
    .limit(Math.min(filter.limit ?? 50, 200));
}
