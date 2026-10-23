import './env.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Redis } from 'ioredis';
import { resetConfigForTests } from '../../src/config.js';
import { checkQueueHealth, closeQueues, getQueue, withDeadline } from '../../src/lib/queue.js';
import { stopWorkers } from '../../src/workers/index.js';
import { startTestEnv, stopTestEnv, type TestEnv } from './setup.js';

// This suite owns a disposable, loopback-only Redis process. Never kills or
// flushes a configured/shared Redis instance and never reads production .env.
let env: TestEnv;
let processUnderTest: ChildProcess | null = null;
let port: number;
async function startRedis() {
  const child = spawn(process.env.NATIO_TEST_REDIS_BIN ?? 'redis-server', ['--port', String(port), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no', '--loglevel', 'warning'], { stdio: 'ignore' });
  processUnderTest = child;
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  const probe = new Redis(`redis://127.0.0.1:${port}`, { connectTimeout: 500, maxRetriesPerRequest: 1, retryStrategy: () => 50 });
  probe.on('error', () => undefined);
  try { await withDeadline(new Promise<void>((resolve) => probe.once('ready', () => resolve())), 5_000); }
  finally { probe.disconnect(); }
}
async function stopRedis() {
  if (!processUnderTest) return;
  const exited = once(processUnderTest, 'exit');
  processUnderTest.kill('SIGTERM'); await exited; processUnderTest = null;
}
async function waitForRecovery() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { await checkQueueHealth(); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('Redis did not recover');
}
beforeAll(async () => {
  env = await startTestEnv(); await stopWorkers(); await closeQueues();
  const socket = createServer(); await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  await startRedis();
  vi.stubEnv('QUEUE_DRIVER', 'redis'); vi.stubEnv('REDIS_URL', `redis://127.0.0.1:${port}`); resetConfigForTests();
  await waitForRecovery();
});
afterAll(async () => {
  await closeQueues(); await stopRedis();
  vi.unstubAllEnvs(); resetConfigForTests(); await stopTestEnv(env);
});
describe('real Redis outage and recovery', () => {
  it('reports degraded readiness and bounds a producer failure, then resumes jobs after restart', async () => {
    const queue = getQueue<{ id: string }>('resilience-test-queue');
    const delivered: string[] = [];
    await queue.process(async (job) => { delivered.push(job.id); });
    await queue.add('probe', { id: 'before' });
    await vi.waitFor(() => expect(delivered).toContain('before'), { timeout: 5_000 });
    expect((await env.app.inject('/health')).json().checks.queue).toBe('ok');
    await stopRedis();
    const health = await env.app.inject('/health');
    expect(health.statusCode).toBe(503); expect(health.json().checks).toEqual({ database: 'ok', queue: 'error' });
    const start = Date.now();
    await expect(queue.add('probe', { id: 'during' })).rejects.toBeDefined();
    expect(Date.now() - start).toBeLessThan(3_500);
    await startRedis(); await waitForRecovery();
    await queue.add('probe', { id: 'after' });
    await vi.waitFor(() => expect(delivered).toContain('after'), { timeout: 8_000 });
    expect((await env.app.inject('/health')).statusCode).toBe(200);
  });
});
