/**
 * Minimal queue abstraction. Production uses BullMQ on Redis; tests and
 * local development without Redis use the in-process driver.
 * Retries are scheduled explicitly by the job handlers (delay), so both drivers behave the same.
 */
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { loadConfig } from "../config.js";
import { logger } from "./logger.js";

export type JobHandler<T> = (data: T, job: { id: string; name: string }) => Promise<void>;

export interface JobQueue<T> {
  readonly name: string;
  add(name: string, data: T, opts?: { delayMs?: number; jobId?: string }): Promise<void>;
  process(handler: JobHandler<T>, concurrency?: number): Promise<void>;
  /** Wait for all in-flight jobs (memory driver only; used by tests). */
  drain(): Promise<void>;
  close(): Promise<void>;
}

class MemoryQueue<T> implements JobQueue<T> {
  private handler: JobHandler<T> | null = null;
  private pending: Array<{ name: string; data: T; id: string }> = [];
  private timers = new Set<NodeJS.Timeout>();
  private inflight = 0;
  private seq = 0;
  private waiters: Array<() => void> = [];

  constructor(public readonly name: string) {}

  async add(name: string, data: T, opts?: { delayMs?: number; jobId?: string }): Promise<void> {
    const id = opts?.jobId ?? `${this.name}-${++this.seq}`;
    const job = { name, data, id };
    const delay = opts?.delayMs ?? 0;
    const t = setTimeout(() => {
      this.timers.delete(t);
      void this.run(job);
    }, delay);
    this.timers.add(t);
  }

  private async run(job: { name: string; data: T; id: string }) {
    if (!this.handler) {
      this.pending.push(job);
      return;
    }
    this.inflight++;
    try {
      await this.handler(job.data, { id: job.id, name: job.name });
    } catch (err) {
      logger.error({ err, queue: this.name, job: job.name }, "memory queue job failed");
    } finally {
      this.inflight--;
      this.notify();
    }
  }

  async process(handler: JobHandler<T>): Promise<void> {
    this.handler = handler;
    const backlog = this.pending.splice(0);
    for (const job of backlog) void this.run(job);
  }

  private notify() {
    if (this.inflight === 0 && this.timers.size === 0) {
      const w = this.waiters.splice(0);
      for (const r of w) r();
    }
  }

  async drain(): Promise<void> {
    // Give scheduled timers a chance to fire (retries with delay are bounded in tests).
    while (this.inflight > 0 || this.timers.size > 0) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 25);
      });
    }
  }

  async close(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}

class RedisQueue<T> implements JobQueue<T> {
  private queue: Queue;
  private worker: Worker | null = null;

  constructor(
    public readonly name: string,
    private readonly connection: Redis,
  ) {
    this.queue = new Queue(name, { connection, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000, attempts: 1 } });
  }

  async add(name: string, data: T, opts?: { delayMs?: number; jobId?: string }): Promise<void> {
    await this.queue.add(name, data, { delay: opts?.delayMs, jobId: opts?.jobId });
  }

  async process(handler: JobHandler<T>, concurrency = 5): Promise<void> {
    this.worker = new Worker(
      this.name,
      async (job: Job) => {
        await handler(job.data as T, { id: String(job.id), name: job.name });
      },
      { connection: this.connection, concurrency },
    );
    this.worker.on("failed", (job, err) => logger.error({ err, queue: this.name, job: job?.name }, "job failed"));
  }

  async drain(): Promise<void> {
    // no-op for Redis; tests use the memory driver
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}

let redis: Redis | null = null;
const queues = new Map<string, JobQueue<unknown>>();

export function getQueue<T>(name: string): JobQueue<T> {
  const existing = queues.get(name);
  if (existing) return existing as JobQueue<T>;
  const cfg = loadConfig();
  let q: JobQueue<T>;
  if (cfg.QUEUE_DRIVER === "memory") {
    q = new MemoryQueue<T>(name);
  } else {
    if (!redis) {
      if (!cfg.REDIS_URL) throw new Error("REDIS_URL is required when QUEUE_DRIVER=redis");
      redis = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
      redis.on("error", (err: Error) => logger.error({ err }, "redis error"));
    }
    q = new RedisQueue<T>(name, redis);
  }
  queues.set(name, q as JobQueue<unknown>);
  return q;
}

export async function drainQueues(): Promise<void> {
  for (const q of queues.values()) await q.drain();
}

export async function closeQueues(): Promise<void> {
  for (const q of queues.values()) await q.close();
  queues.clear();
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

export const QUEUE_NAMES = {
  webhooks: "natio-webhooks",
  providerSync: "natio-provider-sync",
} as const;
