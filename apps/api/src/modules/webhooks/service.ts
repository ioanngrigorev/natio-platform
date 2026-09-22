import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { loadConfig } from "../../config.js";
import type { Db, DbOrTx } from "../../db/client.js";
import { webhookDeliveries, webhookDeliveryAttempts, webhookEndpoints, WEBHOOK_EVENT_TYPES } from "../../db/schema/index.js";
import { decryptString, encryptString, generateWebhookSecret, signWebhookPayload } from "../../lib/crypto.js";
import { Errors } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { logger } from "../../lib/logger.js";
import { validateOutboundUrl } from "../../lib/net.js";
import { getQueue, QUEUE_NAMES } from "../../lib/queue.js";
import { recordAudit, type Actor } from "../audit/service.js";
import { emitEvent, enqueueDeliveries, type WebhookJob } from "../events/service.js";

export type EndpointRow = typeof webhookEndpoints.$inferSelect;
export type DeliveryRow = typeof webhookDeliveries.$inferSelect;

export function serializeEndpoint(e: EndpointRow) {
  return {
    id: e.id,
    object: "webhook_endpoint",
    mode: e.mode,
    project_id: e.projectId,
    url: e.url,
    description: e.description,
    events: e.events,
    status: e.status,
    secret_prefix: e.secretPrefix,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
  };
}

export function serializeDelivery(d: DeliveryRow, endpoint?: { url: string } | null) {
  return {
    id: d.id,
    object: "webhook_delivery",
    endpoint_id: d.endpointId,
    endpoint_url: endpoint?.url ?? null,
    merchant_id: d.merchantId,
    event_id: d.eventId,
    event_type: d.eventType,
    status: d.status,
    attempt_count: d.attemptCount,
    max_attempts: d.maxAttempts,
    next_attempt_at: d.nextAttemptAt,
    last_response_status: d.lastResponseStatus,
    last_response_body: d.lastResponseBody,
    last_error: d.lastError,
    delivered_at: d.deliveredAt,
    payload: d.payload,
    created_at: d.createdAt,
  };
}

async function checkUrl(url: string) {
  const cfg = loadConfig();
  const problem = await validateOutboundUrl(url, { allowPrivate: cfg.WEBHOOK_ALLOW_PRIVATE_URLS, allowHttp: !cfg.isProduction });
  if (problem) throw Errors.badRequest("invalid_webhook_url", problem, "url");
}

export async function createEndpoint(
  db: Db,
  input: { merchantId: string; projectId: string; mode: "test" | "live"; url: string; description?: string; events: string[]; actor: Actor },
): Promise<{ endpoint: EndpointRow; secret: string }> {
  await checkUrl(input.url);
  const invalid = input.events.filter((e) => e !== "*" && !(WEBHOOK_EVENT_TYPES as readonly string[]).includes(e));
  if (invalid.length) throw Errors.badRequest("invalid_event_type", `Unknown event types: ${invalid.join(", ")}`, "events");
  const cfg = loadConfig();
  const { secret, prefix } = generateWebhookSecret();
  const [endpoint] = await db
    .insert(webhookEndpoints)
    .values({
      id: newId("webhookEndpoint"),
      merchantId: input.merchantId,
      projectId: input.projectId,
      mode: input.mode,
      url: input.url,
      description: input.description ?? null,
      secretEnc: encryptString(secret, cfg.NATIO_ENCRYPTION_KEY),
      secretPrefix: prefix,
      events: input.events,
      createdBy: input.actor.id ?? null,
    })
    .returning();
  await recordAudit(db, { actor: input.actor, merchantId: input.merchantId, action: "webhook_endpoint.created", entityType: "webhook_endpoint", entityId: endpoint!.id, after: { url: input.url, events: input.events, mode: input.mode } });
  return { endpoint: endpoint!, secret };
}

export async function updateEndpoint(
  db: Db,
  input: { merchantId: string; endpointId: string; url?: string; description?: string; events?: string[]; status?: "active" | "disabled"; actor: Actor },
) {
  const [existing] = await db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, input.endpointId), eq(webhookEndpoints.merchantId, input.merchantId)))
    .limit(1);
  if (!existing) throw Errors.notFound("Webhook endpoint", input.endpointId);
  if (input.url) await checkUrl(input.url);
  const [updated] = await db
    .update(webhookEndpoints)
    .set({
      ...(input.url ? { url: input.url } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.events ? { events: input.events } : {}),
      ...(input.status ? { status: input.status } : {}),
      updatedAt: new Date(),
    })
    .where(eq(webhookEndpoints.id, existing.id))
    .returning();
  await recordAudit(db, { actor: input.actor, merchantId: input.merchantId, action: "webhook_endpoint.updated", entityType: "webhook_endpoint", entityId: existing.id, before: existing, after: input });
  return updated!;
}

export async function rotateEndpointSecret(db: Db, input: { merchantId: string; endpointId: string; actor: Actor }) {
  const [existing] = await db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, input.endpointId), eq(webhookEndpoints.merchantId, input.merchantId)))
    .limit(1);
  if (!existing) throw Errors.notFound("Webhook endpoint", input.endpointId);
  const cfg = loadConfig();
  const { secret, prefix } = generateWebhookSecret();
  await db.update(webhookEndpoints).set({ secretEnc: encryptString(secret, cfg.NATIO_ENCRYPTION_KEY), secretPrefix: prefix, updatedAt: new Date() }).where(eq(webhookEndpoints.id, existing.id));
  await recordAudit(db, { actor: input.actor, merchantId: input.merchantId, action: "webhook_endpoint.secret_rotated", entityType: "webhook_endpoint", entityId: existing.id });
  return secret;
}

export async function deleteEndpoint(db: Db, input: { merchantId: string; endpointId: string; actor: Actor }) {
  const [existing] = await db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, input.endpointId), eq(webhookEndpoints.merchantId, input.merchantId)))
    .limit(1);
  if (!existing) throw Errors.notFound("Webhook endpoint", input.endpointId);
  await db.update(webhookEndpoints).set({ status: "disabled", updatedAt: new Date() }).where(eq(webhookEndpoints.id, existing.id));
  await recordAudit(db, { actor: input.actor, merchantId: input.merchantId, action: "webhook_endpoint.disabled", entityType: "webhook_endpoint", entityId: existing.id });
}

export async function listEndpoints(db: DbOrTx, merchantId: string, mode?: "test" | "live") {
  const conds = [eq(webhookEndpoints.merchantId, merchantId)];
  if (mode) conds.push(eq(webhookEndpoints.mode, mode));
  return db
    .select()
    .from(webhookEndpoints)
    .where(and(...conds))
    .orderBy(desc(webhookEndpoints.createdAt));
}

export async function listDeliveries(
  db: DbOrTx,
  f: { merchantId?: string; mode?: "test" | "live"; endpointId?: string; status?: string; eventType?: string; limit?: number; cursor?: string },
) {
  const conds: SQL[] = [];
  if (f.merchantId) conds.push(eq(webhookDeliveries.merchantId, f.merchantId));
  if (f.mode) conds.push(eq(webhookDeliveries.mode, f.mode));
  if (f.endpointId) conds.push(eq(webhookDeliveries.endpointId, f.endpointId));
  if (f.status) conds.push(eq(webhookDeliveries.status, f.status as never));
  if (f.eventType) conds.push(eq(webhookDeliveries.eventType, f.eventType));
  if (f.cursor) {
    conds.push(
      f.merchantId
        ? sql`${webhookDeliveries.createdAt} < (select created_at from webhook_deliveries where id = ${f.cursor} and merchant_id = ${f.merchantId})`
        : sql`${webhookDeliveries.createdAt} < (select created_at from webhook_deliveries where id = ${f.cursor})`,
    );
  }
  const limit = Math.min(f.limit ?? 50, 200);
  const rows = await db
    .select({ d: webhookDeliveries, url: webhookEndpoints.url })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit).map((r) => serializeDelivery(r.d, { url: r.url }));
  return { data, has_more: hasMore, next_cursor: hasMore ? data[data.length - 1]!.id : null };
}

export async function getDeliveryDetail(db: DbOrTx, id: string, scope?: { merchantId: string }) {
  const conds = [eq(webhookDeliveries.id, id)];
  if (scope) conds.push(eq(webhookDeliveries.merchantId, scope.merchantId));
  const [row] = await db
    .select({ d: webhookDeliveries, url: webhookEndpoints.url })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
    .where(and(...conds))
    .limit(1);
  if (!row) return null;
  const attempts = await db.select().from(webhookDeliveryAttempts).where(eq(webhookDeliveryAttempts.deliveryId, id)).orderBy(webhookDeliveryAttempts.attemptNumber);
  return {
    ...serializeDelivery(row.d, { url: row.url }),
    attempts: attempts.map((a) => ({
      id: a.id,
      attempt_number: a.attemptNumber,
      request_headers: a.requestHeaders,
      response_status: a.responseStatus,
      response_body: a.responseBody,
      error: a.error,
      duration_ms: a.durationMs,
      manual: a.manual === "true",
      created_at: a.createdAt,
    })),
  };
}

/** Manual resend: resets the delivery and enqueues it immediately (audited). */
export async function resendDelivery(db: Db, input: { deliveryId: string; merchantId?: string; actor: Actor }) {
  const conds = [eq(webhookDeliveries.id, input.deliveryId)];
  if (input.merchantId) conds.push(eq(webhookDeliveries.merchantId, input.merchantId));
  const [d] = await db
    .select()
    .from(webhookDeliveries)
    .where(and(...conds))
    .limit(1);
  if (!d) throw Errors.notFound("Webhook delivery", input.deliveryId);
  await db
    .update(webhookDeliveries)
    .set({ status: "pending", nextAttemptAt: new Date(), maxAttempts: d.attemptCount + 1, updatedAt: new Date() })
    .where(eq(webhookDeliveries.id, d.id));
  await recordAudit(db, { actor: input.actor, merchantId: d.merchantId, action: "webhook_delivery.resent", entityType: "webhook_delivery", entityId: d.id });
  await getQueue<WebhookJob>(QUEUE_NAMES.webhooks).add("deliver", { deliveryId: d.id, manual: true } as WebhookJob, { jobId: `${d.id}-manual-${Date.now()}` });
}

/** POST /v1/webhooks/test — emits a synthetic event to all endpoints of the project/mode. */
export async function sendTestEvent(db: Db, scope: { merchantId: string; projectId: string; mode: "test" | "live" }, eventType: string, actor: Actor) {
  if (eventType !== "*" && !(WEBHOOK_EVENT_TYPES as readonly string[]).includes(eventType)) {
    throw Errors.badRequest("invalid_event_type", `Unknown event type ${eventType}`, "event_type");
  }
  const type = eventType === "*" ? "payment.successful" : eventType;
  const ev = await emitEvent(db, {
    merchantId: scope.merchantId,
    projectId: scope.projectId,
    mode: scope.mode,
    type,
    entityType: "test",
    entityId: `test_${Date.now()}`,
    data: { id: "pay_test_000000000000000000", object: "payment", status: "successful", amount: 1000, currency: "USD", test: true, sent_by: actor.label ?? actor.id ?? "api" },
  });
  await enqueueDeliveries(ev.deliveryIds);
  return { event_id: ev.eventId, deliveries: ev.deliveryIds.length };
}

// ---------------------------------------------------------------------------
// Delivery worker
// ---------------------------------------------------------------------------
export function backoffMs(attempt: number): number {
  // 30s, 2m, 10m, 30m, 2h (capped)
  const table = [30_000, 120_000, 600_000, 1_800_000, 7_200_000];
  return table[Math.min(attempt - 1, table.length - 1)]!;
}

export async function deliverWebhook(db: Db, job: WebhookJob & { manual?: boolean }): Promise<void> {
  const cfg = loadConfig();
  const [row] = await db
    .select({ d: webhookDeliveries, ep: webhookEndpoints })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
    .where(eq(webhookDeliveries.id, job.deliveryId))
    .limit(1);
  if (!row) return;
  const { d, ep } = row;
  if (d.status === "succeeded" || d.status === "exhausted") return;
  if (ep.status !== "active" && !job.manual) {
    await db.update(webhookDeliveries).set({ status: "failed", lastError: "endpoint disabled", updatedAt: new Date() }).where(eq(webhookDeliveries.id, d.id));
    return;
  }
  // Claim the delivery (prevents duplicate concurrent sends).
  const claimed = await db
    .update(webhookDeliveries)
    .set({ status: "delivering", updatedAt: new Date() })
    .where(and(eq(webhookDeliveries.id, d.id), sql`${webhookDeliveries.status} in ('pending','failed')`))
    .returning({ id: webhookDeliveries.id });
  if (!claimed.length) return;

  // Re-check the destination at send time. The URL was validated when it was registered, but DNS
  // can be repointed at a private address afterwards (stored SSRF / DNS rebinding).
  const urlProblem = await validateOutboundUrl(ep.url, { allowPrivate: cfg.WEBHOOK_ALLOW_PRIVATE_URLS, allowHttp: !cfg.isProduction });
  if (urlProblem) {
    await db
      .update(webhookDeliveries)
      .set({ status: "exhausted", lastError: `endpoint rejected: ${urlProblem}`, nextAttemptAt: null, updatedAt: new Date() })
      .where(eq(webhookDeliveries.id, d.id));
    await db.update(webhookEndpoints).set({ status: "disabled", updatedAt: new Date() }).where(eq(webhookEndpoints.id, ep.id));
    logger.warn({ deliveryId: d.id, endpointId: ep.id, reason: urlProblem }, "webhook endpoint disabled: destination is not allowed");
    return;
  }

  const attemptNumber = d.attemptCount + 1;
  const body = JSON.stringify(d.payload);
  const secret = decryptString(ep.secretEnc, cfg.NATIO_ENCRYPTION_KEY);
  const signature = signWebhookPayload(secret, body);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "NATIO-Webhooks/1.0",
    "natio-signature": signature,
    "natio-event-id": d.eventId,
    "natio-event-type": d.eventType,
    "natio-delivery-id": d.id,
    "natio-delivery-attempt": String(attemptNumber),
  };

  const t0 = Date.now();
  let status: number | null = null;
  let responseBody: string | null = null;
  let error: string | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.WEBHOOK_TIMEOUT_MS);
    try {
      const res = await fetch(ep.url, { method: "POST", headers, body, signal: controller.signal, redirect: "manual" });
      status = res.status;
      responseBody = (await res.text()).slice(0, 2000);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    error = err instanceof Error ? (err.name === "AbortError" ? `timeout after ${cfg.WEBHOOK_TIMEOUT_MS}ms` : err.message) : String(err);
  }
  const duration = Date.now() - t0;
  const ok = status !== null && status >= 200 && status < 300;

  await db.insert(webhookDeliveryAttempts).values({
    id: newId("webhookAttempt"),
    deliveryId: d.id,
    attemptNumber,
    requestHeaders: { ...headers, "natio-signature": signature.slice(0, 12) + "…" },
    responseStatus: status,
    responseBody,
    error,
    durationMs: duration,
    manual: job.manual ? "true" : null,
  });

  if (ok) {
    await db
      .update(webhookDeliveries)
      .set({ status: "succeeded", attemptCount: attemptNumber, lastResponseStatus: status, lastResponseBody: responseBody, lastError: null, deliveredAt: new Date(), nextAttemptAt: null, updatedAt: new Date() })
      .where(eq(webhookDeliveries.id, d.id));
    return;
  }

  const exhausted = attemptNumber >= d.maxAttempts;
  const nextAt = exhausted ? null : new Date(Date.now() + backoffMs(attemptNumber));
  await db
    .update(webhookDeliveries)
    .set({
      status: exhausted ? "exhausted" : "failed",
      attemptCount: attemptNumber,
      lastResponseStatus: status,
      lastResponseBody: responseBody,
      lastError: error ?? `HTTP ${status}`,
      nextAttemptAt: nextAt,
      updatedAt: new Date(),
    })
    .where(eq(webhookDeliveries.id, d.id));
  if (!exhausted) {
    const delayMs = cfg.isTest ? 50 : backoffMs(attemptNumber);
    await getQueue<WebhookJob>(QUEUE_NAMES.webhooks).add("deliver", { deliveryId: d.id }, { delayMs, jobId: `${d.id}-${attemptNumber + 1}` });
  } else {
    logger.warn({ deliveryId: d.id, endpoint: ep.url }, "webhook delivery exhausted");
  }
}
