/**
 * Domain events (outbox). An event is written in the same transaction as the state change
 * that produced it; webhook deliveries are fanned out from the event after commit.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { loadConfig } from "../../config.js";
import type { DbOrTx } from "../../db/client.js";
import { events, paymentEvents, webhookDeliveries, webhookEndpoints } from "../../db/schema/index.js";
import { newId } from "../../lib/ids.js";
import { getQueue, QUEUE_NAMES } from "../../lib/queue.js";

export interface EmitEventInput {
  merchantId: string;
  projectId: string;
  mode: "test" | "live";
  type: string;
  entityType: string;
  entityId: string;
  data: Record<string, unknown>;
}

export interface WebhookJob {
  deliveryId: string;
}

/**
 * Persist the event and create pending deliveries for every subscribed endpoint.
 * Returns delivery ids; the caller enqueues them after the surrounding transaction commits.
 */
export async function emitEvent(db: DbOrTx, input: EmitEventInput): Promise<{ eventId: string; deliveryIds: string[] }> {
  const cfg = loadConfig();
  const eventId = newId("event");
  await db.insert(events).values({
    id: eventId,
    merchantId: input.merchantId,
    projectId: input.projectId,
    mode: input.mode,
    type: input.type,
    entityType: input.entityType,
    entityId: input.entityId,
    data: input.data,
  });
  const endpoints = await db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.merchantId, input.merchantId), eq(webhookEndpoints.projectId, input.projectId), eq(webhookEndpoints.mode, input.mode), eq(webhookEndpoints.status, "active")));
  const subscribed = endpoints.filter((e) => e.events.length === 0 || e.events.includes(input.type) || e.events.includes("*"));
  const deliveryIds: string[] = [];
  const payload = {
    id: eventId,
    type: input.type,
    mode: input.mode,
    created_at: new Date().toISOString(),
    data: { object: input.data },
  };
  for (const ep of subscribed) {
    const id = newId("webhookDelivery");
    deliveryIds.push(id);
    await db.insert(webhookDeliveries).values({
      id,
      endpointId: ep.id,
      merchantId: input.merchantId,
      mode: input.mode,
      eventId,
      eventType: input.type,
      payload,
      status: "pending",
      attemptCount: 0,
      maxAttempts: cfg.WEBHOOK_MAX_ATTEMPTS,
      nextAttemptAt: new Date(),
    });
  }
  return { eventId, deliveryIds };
}

export async function enqueueDeliveries(deliveryIds: string[]): Promise<void> {
  if (!deliveryIds.length) return;
  const q = getQueue<WebhookJob>(QUEUE_NAMES.webhooks);
  for (const id of deliveryIds) await q.add("deliver", { deliveryId: id }, { jobId: `${id}-1` });
}

/** Append a payment timeline entry. */
export async function addTimeline(
  db: DbOrTx,
  input: { paymentId: string; attemptId?: string | null; type: string; title: string; description?: string; data?: Record<string, unknown> },
): Promise<void> {
  await db.insert(paymentEvents).values({
    id: newId("paymentEvent"),
    paymentId: input.paymentId,
    attemptId: input.attemptId ?? null,
    type: input.type,
    title: input.title,
    description: input.description ?? null,
    data: input.data ?? {},
  });
}

export async function listTimeline(db: DbOrTx, paymentId: string) {
  return db.select().from(paymentEvents).where(eq(paymentEvents.paymentId, paymentId)).orderBy(paymentEvents.createdAt, paymentEvents.id);
}

export async function eventsForEntities(db: DbOrTx, entityIds: string[]) {
  if (!entityIds.length) return [];
  return db
    .select()
    .from(events)
    .where(inArray(events.entityId, entityIds))
    .orderBy(sql`${events.createdAt} desc`);
}
