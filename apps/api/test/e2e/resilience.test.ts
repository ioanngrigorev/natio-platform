import './env.js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, getPool } from '../../src/db/client.js';
import { idempotencyKeys, webhookDeliveries, webhookDeliveryAttempts } from '../../src/db/schema/index.js';
import { Errors } from '../../src/lib/errors.js';
import { drainQueues, getQueue, QUEUE_NAMES } from '../../src/lib/queue.js';
import { withIdempotency, purgeExpiredIdempotencyKeys } from '../../src/modules/idempotency/service.js';
import { emitEvent, enqueueDeliveries, type WebhookJob } from '../../src/modules/events/service.js';
import { createEndpoint, deliverWebhook, recoverWebhookOutbox, resendDelivery } from '../../src/modules/webhooks/service.js';
import { startTestEnv, stopTestEnv, type TestEnv } from './setup.js';

let env: TestEnv;
let endpointId: string;
let sequence = 0;
const db = () => getDb();
const scope = () => ({ merchantId: env.seed.merchantId, mode: 'test' as const, scope: 'payments.create' });
const actor = { type: 'system' as const, id: 'resilience-test' };
const key = () => `resilience-${++sequence}`;
beforeAll(async () => {
  env = await startTestEnv();
  const { endpoint } = await createEndpoint(db(), { merchantId: env.seed.merchantId, projectId: env.seed.projectId, mode: 'test', url: env.receiver.url, events: ['payment.created'], actor });
  endpointId = endpoint.id;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => { await stopTestEnv(env); });

async function delivery() {
  const result = await emitEvent(db(), { merchantId: env.seed.merchantId, projectId: env.seed.projectId, mode: 'test', type: 'payment.created', entityType: 'test', entityId: key(), data: { synthetic: true } });
  return result.deliveryIds[0]!;
}
async function readDelivery(id: string) { return (await db().select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)))[0]!; }
const received = (id: string) => env.receiver.received.filter((r) => r.headers['natio-delivery-id'] === id);

describe('idempotency across concurrent requests and uncertain failures', () => {
  it('executes one side effect, rejects a concurrent request, then replays the result', async () => {
    const id = key(); let release!: () => void; let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const handler = vi.fn(async () => { started(); await gate; return { status: 201, body: { id: 'synthetic-payment' } }; });
    const first = withIdempotency(db(), scope(), id, { amount: 100 }, handler);
    await running;
    try { await expect(withIdempotency(db(), scope(), id, { amount: 100 }, handler)).rejects.toMatchObject({ status: 409, code: 'idempotency_in_progress' }); }
    finally { release(); }
    expect((await first).replayed).toBe(false);
    expect((await withIdempotency(db(), scope(), id, { amount: 100 }, handler)).replayed).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    await expect(withIdempotency(db(), scope(), id, { amount: 200 }, handler)).rejects.toMatchObject({ code: 'idempotency_key_reused' });
  });
  it('never releases a reservation after a committed side effect followed by an exception', async () => {
    const id = key(); let committedEffects = 0;
    const handler = async () => { committedEffects++; throw new Error('response storage failed after commit'); };
    await expect(withIdempotency(db(), scope(), id, {}, handler)).rejects.toThrow('after commit');
    await expect(withIdempotency(db(), scope(), id, {}, handler)).rejects.toMatchObject({ status: 409 });
    await db().update(idempotencyKeys).set({ lockedAt: new Date(Date.now() - 120_000), expiresAt: new Date(0) }).where(eq(idempotencyKeys.key, id));
    await purgeExpiredIdempotencyKeys(db());
    for (let i = 0; i < 2; i++) await expect(withIdempotency(db(), scope(), id, {}, handler)).rejects.toMatchObject({ code: 'idempotency_recovery_required' });
    expect(committedEffects).toBe(1);
  });
  it('replays deterministic errors and never re-runs their handler', async () => {
    const handler = vi.fn(async () => { throw Errors.validation('Invalid amount', { min: 1 }, 'amount'); });
    const id = key();
    for (let i = 0; i < 2; i++) await expect(withIdempotency(db(), scope(), id, {}, handler)).rejects.toMatchObject({ status: 422, code: 'validation_failed', param: 'amount', details: { min: 1 } });
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it('scopes keys by operation and mode and only purges completed expired requests', async () => {
    const id = key(); const handler = vi.fn(async () => ({ status: 200, body: { ok: true } }));
    await withIdempotency(db(), scope(), id, {}, handler);
    await withIdempotency(db(), { ...scope(), mode: 'live' }, id, {}, handler);
    await withIdempotency(db(), { ...scope(), scope: 'payments.cancel' }, id, {}, handler);
    expect(handler).toHaveBeenCalledTimes(3);
    await db().update(idempotencyKeys).set({ expiresAt: new Date(0) }).where(eq(idempotencyKeys.key, id));
    expect(await purgeExpiredIdempotencyKeys(db())).toBe(3);
  });
});

describe('durable webhook recovery', () => {
  it('recovers a committed outbox after enqueue fails without reporting the transaction as failed', async () => {
    const id = await delivery();
    const add = vi.spyOn(getQueue<WebhookJob>(QUEUE_NAMES.webhooks), 'add').mockRejectedValue(new Error('Redis disconnected'));
    await expect(enqueueDeliveries([id])).resolves.toBeUndefined();
    expect((await readDelivery(id)).status).toBe('pending');
    add.mockRestore();
    expect(await recoverWebhookOutbox(db())).toBe(1);
    await drainQueues();
    expect((await readDelivery(id)).status).toBe('succeeded');
    expect(received(id)).toHaveLength(1);
  });
  it('claims only one send when the same job is delivered concurrently', async () => {
    const id = await delivery();
    await Promise.all(Array.from({ length: 8 }, () => deliverWebhook(db(), { deliveryId: id })));
    expect(received(id)).toHaveLength(1);
    expect((await readDelivery(id)).attemptCount).toBe(1);
  });
  it('honours backoff and attempt budgets even when a stale job arrives early', async () => {
    const id = await delivery();
    await db().update(webhookDeliveries).set({ nextAttemptAt: new Date(Date.now() + 60_000) }).where(eq(webhookDeliveries.id, id));
    await deliverWebhook(db(), { deliveryId: id });
    expect(await recoverWebhookOutbox(db())).toBe(0);
    expect(received(id)).toHaveLength(0);
    await db().update(webhookDeliveries).set({ nextAttemptAt: new Date(0), attemptCount: 6 }).where(eq(webhookDeliveries.id, id));
    await deliverWebhook(db(), { deliveryId: id });
    expect(await recoverWebhookOutbox(db())).toBe(0);
  });
  it('recovers an expired worker lease and preserves monotonically increasing attempt numbers', async () => {
    const id = await delivery();
    await db().update(webhookDeliveries).set({ status: 'delivering', attemptCount: 1, updatedAt: new Date(0) }).where(eq(webhookDeliveries.id, id));
    expect(await recoverWebhookOutbox(db())).toBe(1);
    await drainQueues();
    expect((await readDelivery(id)).status).toBe('succeeded');
    expect(received(id)[0].headers['natio-delivery-attempt']).toBe('2');
  });
  it('does not steal a current lease or allow a concurrent manual resend', async () => {
    const id = await delivery();
    await db().update(webhookDeliveries).set({ status: 'delivering', attemptCount: 1, updatedAt: new Date() }).where(eq(webhookDeliveries.id, id));
    expect(await recoverWebhookOutbox(db())).toBe(0);
    await expect(resendDelivery(db(), { deliveryId: id, actor })).rejects.toMatchObject({ status: 409, code: 'delivery_in_progress' });
    await db().update(webhookDeliveries).set({ status: 'exhausted' }).where(eq(webhookDeliveries.id, id));
  });
  it('fences a resumed old worker after its lease was recovered', async () => {
    const id = await delivery(); let release!: (response: Response) => void; let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    const fetchMock = vi.fn().mockImplementationOnce(() => { started(); return new Promise<Response>((resolve) => { release = resolve; }); }).mockResolvedValue(new Response('new worker'));
    vi.stubGlobal('fetch', fetchMock);
    const oldWorker = deliverWebhook(db(), { deliveryId: id });
    await running;
    await db().update(webhookDeliveries).set({ updatedAt: new Date(0) }).where(eq(webhookDeliveries.id, id));
    await recoverWebhookOutbox(db()); await drainQueues();
    release(new Response('old worker failure', { status: 500 })); await oldWorker;
    const row = await readDelivery(id);
    expect(row.status).toBe('succeeded'); expect(row.attemptCount).toBe(2); expect(row.lastResponseBody).toBe('new worker');
    const attempts = await db().select().from(webhookDeliveryAttempts).where(eq(webhookDeliveryAttempts.deliveryId, id));
    expect(attempts.map((a) => a.attemptNumber)).toEqual([2]);
  });
  it('limits stored response bytes and retries an HTTP failure', async () => {
    const id = await delivery();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('failure', { status: 503 })).mockResolvedValue(new Response('x'.repeat(1_000_000))));
    await deliverWebhook(db(), { deliveryId: id }); await drainQueues();
    const row = await readDelivery(id);
    expect(row.status).toBe('succeeded'); expect(row.attemptCount).toBe(2); expect(row.lastResponseBody?.length).toBe(2000);
  });
  it('keeps manual resend intent durable through a queue outage', async () => {
    const id = await delivery(); await deliverWebhook(db(), { deliveryId: id });
    const add = vi.spyOn(getQueue<WebhookJob>(QUEUE_NAMES.webhooks), 'add').mockRejectedValue(new Error('Redis unavailable'));
    await resendDelivery(db(), { deliveryId: id, actor });
    expect((await readDelivery(id)).manualRequested).toBe(true);
    add.mockRestore(); await recoverWebhookOutbox(db()); await drainQueues();
    expect(received(id)).toHaveLength(2);
    const attempts = await db().select().from(webhookDeliveryAttempts).where(eq(webhookDeliveryAttempts.deliveryId, id));
    expect(attempts.find((a) => a.attemptNumber === 2)?.manual).toBe('true');
  });
});

describe('health and HTTP error contracts', () => {
  it('reports dependency failure as 503 without leaking DB details, then recovers', async () => {
    const query = vi.spyOn(getPool(), 'query').mockRejectedValueOnce(new Error('private database connection detail') as never);
    const down = await env.app.inject('/health');
    expect(down.statusCode).toBe(503); expect(down.json().checks.database).toBe('error'); expect(down.body).not.toContain('private database');
    query.mockRestore();
    expect((await env.app.inject('/health')).statusCode).toBe(200);
  });
  it('survives an idle-pool connection error and serves the next request', async () => {
    expect(() => getPool().emit('error', new Error('synthetic idle connection loss'))).not.toThrow();
    expect((await env.app.inject('/health')).statusCode).toBe(200);
  });
  it.each(['', '{invalid'])('returns a correlated 400 for malformed JSON %j', async (payload) => {
    const response = await env.app.inject({ method: 'POST', url: '/public/contact', headers: { 'content-type': 'application/json' }, payload });
    expect(response.statusCode).toBe(400); expect(response.json().error.code).toBe('invalid_json');
    expect(response.json().request_id).toBe(response.headers['x-request-id']);
  });
});
