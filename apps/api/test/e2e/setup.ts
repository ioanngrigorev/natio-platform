import "./env.js";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { loadConfig, resetConfigForTests } from "../../src/config.js";
import { closeDb, getDb } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { runSeed, type SeedResult } from "../../src/db/seed.js";
import { closeQueues, drainQueues } from "../../src/lib/queue.js";
import { buildServer } from "../../src/server.js";
import { startWorkers, stopWorkers } from "../../src/workers/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
/** The seed writes this file next to the package; we keep the developer's copy intact. */
const CREDENTIALS_FILE = path.resolve(here, "../../.sandbox-credentials.json");

export interface ReceivedWebhook {
  headers: http.IncomingHttpHeaders;
  body: string;
  json: Record<string, unknown>;
  receivedAt: number;
}

export interface WebhookReceiver {
  url: string;
  received: ReceivedWebhook[];
  /** Everything received for a given entity id (payload.data.object.id). */
  forObject(id: string): ReceivedWebhook[];
  close(): Promise<void>;
}

export interface TestEnv {
  app: FastifyInstance;
  seed: SeedResult & { testApiKey: string };
  receiver: WebhookReceiver;
}

/** Tiny real HTTP server: the webhook worker delivers with `fetch`, so `app.inject` cannot be used here. */
export async function startWebhookReceiver(): Promise<WebhookReceiver> {
  const received: ReceivedWebhook[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(body) as Record<string, unknown>;
      } catch {
        json = {};
      }
      received.push({ headers: req.headers, body, json, receivedAt: Date.now() });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("webhook receiver did not bind to a TCP port");
  return {
    url: `http://127.0.0.1:${address.port}/webhooks/natio`,
    received,
    forObject(id: string) {
      return received.filter((r) => ((r.json.data as { object?: { id?: string } } | undefined)?.object?.id ?? null) === id);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections?.();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function resetTestDatabase() {
  const cfg = loadConfig();
  if (!/natio_test(\?|$)/.test(cfg.DATABASE_URL)) {
    throw new Error(`refusing to reset a database that is not natio_test: ${cfg.DATABASE_URL}`);
  }
  const db = getDb();
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await runMigrations();
}

async function seedPreservingCredentialsFile(): Promise<SeedResult> {
  const previous = fs.existsSync(CREDENTIALS_FILE) ? fs.readFileSync(CREDENTIALS_FILE) : null;
  try {
    return await runSeed();
  } finally {
    if (previous) fs.writeFileSync(CREDENTIALS_FILE, previous);
    else if (fs.existsSync(CREDENTIALS_FILE)) fs.unlinkSync(CREDENTIALS_FILE);
  }
}

export async function startTestEnv(): Promise<TestEnv> {
  resetConfigForTests();
  const cfg = loadConfig();
  if (!cfg.isTest || cfg.QUEUE_DRIVER !== "memory") throw new Error("e2e suite requires NODE_ENV=test and QUEUE_DRIVER=memory");
  await resetTestDatabase();
  const seed = await seedPreservingCredentialsFile();
  if (!seed.testApiKey) throw new Error("seed did not return a test API key (database was not empty?)");
  const app = await buildServer();
  await app.ready();
  await startWorkers();
  const receiver = await startWebhookReceiver();
  return { app, seed: { ...seed, testApiKey: seed.testApiKey }, receiver };
}

export async function stopTestEnv(env: TestEnv | null | undefined) {
  if (!env) return;
  await drainQueues().catch(() => undefined);
  await stopWorkers();
  await env.receiver.close().catch(() => undefined);
  await env.app.close();
  await closeQueues();
  await closeDb();
}
