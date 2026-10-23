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
    }
  }

  async process(handler: JobHandler<T>): Promise<void> {
    this.handler = handler;
    const backlog = this.pending.splice(0);
    for (const job of backlog) void this.run(job);
  }

  async drain(): Promise<void> {
    // Give scheduled timers a chance to fire (retries with delay are bounded in tests).
    while (this.inflight > 0 || this.timers.size > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }

  async close(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.pending = [];
    while (this.inflight > 0) await new Promise<void>((resolve) => setTimeout(resolve, 25));
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
    this.queue.on("error", (err) => logger.error({ err, queue: name }, "queue connection error"));
  }

  async add(name: string, data: T, opts?: { delayMs?: number; jobId?: string }): Promise<void> {
    // Producers must fail promptly during an outage. BullMQ's ready wait can
    // otherwise outlive ioredis commandTimeout. Jobs may still reach Redis after
    // this deadline, so consumers must claim durable state idempotently.
    await withDeadline(this.queue.add(name, data, { delay: opts?.delayMs, jobId: opts?.jobId }), 2_500);
  }

  async process(handler: JobHandler<T>, concurrency = 5): Promise<void> {
    this.worker = new Worker(
      this.name,
      async (job: Job) => {
        await handler(job.data as T, { id: String(job.id), name: job.name });
      },
      { connection: workerConnection(), concurrency },
    );
    this.worker.on("error", (err) => logger.error({ err, queue: this.name }, "worker connection error"));
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
let workerRedis: Redis | null = null;

/** A worker waits for Redis to recover; an HTTP producer must not wait forever. */
function workerConnection(): Redis {
  if (!workerRedis) {
    workerRedis = new Redis(loadConfig().REDIS_URL!, { maxRetriesPerRequest: null, enableReadyCheck: false });
    workerRedis.on("error", (err) => logger.error({ err }, "worker redis error"));
  }
  return workerRedis;
}

function producerConnection(): Redis {
  if (!redis) {
    const url = loadConfig().REDIS_URL;
    if (!url) throw new Error("REDIS_URL is required when QUEUE_DRIVER=redis");
    redis = new Redis(url, { maxRetriesPerRequest: 1, connectTimeout: 1_000, commandTimeout: 2_000, enableOfflineQueue: false });
    redis.on("error", (err) => logger.error({ err }, "producer redis error"));
  }
  return redis;
}

export async function withDeadline<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Dependency operation timed out")), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export async function checkQueueHealth(): Promise<void> {
  if (loadConfig().QUEUE_DRIVER === "memory") return;
  if (await withDeadline(producerConnection().ping(), 1_500) !== "PONG") throw new Error("Redis probe failed");
}
const queues = new Map<string, JobQueue<unknown>>();

export function getQueue<T>(name: string): JobQueue<T> {
  const existing = queues.get(name);
  if (existing) return existing as JobQueue<T>;
  const cfg = loadConfig();
  let q: JobQueue<T>;
  if (cfg.QUEUE_DRIVER === "memory") {
    q = new MemoryQueue<T>(name);
  } else {
    q = new RedisQueue<T>(name, producerConnection());
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
  // No pending commands should keep shutdown stuck while Redis is unavailable.
  redis?.disconnect();
  workerRedis?.disconnect();
  redis = null;
  workerRedis = null;
}

export const QUEUE_NAMES = {
  webhooks: "natio-webhooks",
  providerSync: "natio-provider-sync",
} as const;
