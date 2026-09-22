/**
 * Unauthenticated routes: health, contact form, provider webhooks, sandbox hosted page, OpenAPI.
 */
import type { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadConfig } from "../../config.js";
import { getDb } from "../../db/client.js";
import { contactRequests, mockProviderRecords, providerAccounts, providers } from "../../db/schema/index.js";
import { hmacSha256Hex } from "../../lib/crypto.js";
import { Errors } from "../../lib/errors.js";
import { newId, randomString } from "../../lib/ids.js";
import { buildProviderContext } from "../../providers/context.js";
import { getAdapter } from "../../providers/registry.js";
import { MockProviderAdapter } from "../../providers/mock/mock-adapter.js";
import { handleProviderPaymentEvent } from "../../modules/payments/orchestrator.js";
import { recordSystemEvent } from "../../modules/audit/service.js";
import { parse } from "../validate.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function registerPublicRoutes(app: FastifyInstance) {
  const cfg = loadConfig();
  const db = getDb();

  app.get("/health", async (_req, reply) => {
    const checks: Record<string, "ok" | "error"> = {};
    try {
      await db.execute(sql`select 1`);
      checks.database = "ok";
    } catch {
      checks.database = "error";
    }
    checks.queue = cfg.QUEUE_DRIVER === "memory" ? "ok" : "ok";
    const ok = Object.values(checks).every((v) => v === "ok");
    // The commit is baked in at image build time. Without it there is no way
    // to tell from outside which code a server is running — and on a host that
    // deploys itself and cannot be logged into, "which version is live?" is
    // otherwise unanswerable.
    return reply.status(ok ? 200 : 503).send({
      status: ok ? "ok" : "degraded",
      version: process.env.NATIO_VERSION ?? "0.1.0",
      commit: process.env.NATIO_GIT_SHA ?? "unknown",
      role: cfg.NATIO_PROCESS_ROLE,
      checks,
      time: new Date().toISOString(),
    });
  });

  app.get("/openapi.json", async (_req, reply) => {
    const file = path.resolve(here, "../../../openapi/openapi.json");
    reply.header("cache-control", "public, max-age=300");
    return reply.type("application/json").send(fs.readFileSync(file, "utf8"));
  });

  app.post("/public/contact", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = parse(z.object({ name: z.string().min(2).max(120), email: z.string().email(), company: z.string().max(120).optional(), message: z.string().min(10).max(4000), source: z.string().max(40).optional() }), req.body);
    const id = newId("contact");
    await db.insert(contactRequests).values({ id, name: body.name, email: body.email, company: body.company ?? null, message: body.message, source: body.source ?? "website", ip: req.ip });
    await recordSystemEvent(db, { level: "info", source: "website", type: "contact.request", message: `Contact request from ${body.email}${body.company ? ` (${body.company})` : ""}`, data: { id } });
    return reply.status(201).send({ id, ok: true });
  });

  // ------------------------------------------------------------------ inbound provider webhooks
  // Encapsulated plugin: JSON is kept as a raw string so adapters can verify signatures over the exact bytes.
  await app.register(async (wh) => {
    wh.removeContentTypeParser("application/json");
    wh.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));
    wh.post<{ Params: { accountId: string } }>("/providers/webhooks/:accountId", { config: { rateLimit: { max: 1200, timeWindow: "1 minute" } } }, async (req, reply) => {
      const [row] = await db
        .select({ account: providerAccounts, provider: providers })
        .from(providerAccounts)
        .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
        .where(eq(providerAccounts.id, req.params.accountId))
        .limit(1);
      if (!row) throw Errors.notFound("Provider account");
      const adapter = getAdapter(row.provider.adapterKey);
      const ctx = buildProviderContext(row.account, row.provider);
      const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
      const verification = await adapter.verifyWebhook(ctx, { headers: req.headers as Record<string, string | string[] | undefined>, rawBody });
      if (!verification.valid || !verification.event) {
        await recordSystemEvent(db, { level: "warning", source: "provider-webhook", type: "webhook.rejected", message: `Rejected webhook for ${row.provider.name}: ${verification.reason ?? "invalid"}`, providerAccountId: row.account.id });
        return reply.status(400).send({ error: { type: "invalid_request_error", code: "invalid_signature", message: verification.reason ?? "invalid webhook" } });
      }
      const ev = verification.event;
      if (ev.kind === "payment") {
        const result = await handleProviderPaymentEvent(db, row.account.id, { providerReference: ev.providerReference, status: ev.status, failureCode: ev.failureCode, providerMessage: ev.providerMessage, eventId: ev.eventId });
        return { received: true, ...result };
      }
      return { received: true, handled: false, reason: `${ev.kind} events are recorded only` };
    });
  });

  // ------------------------------------------------------------------ sandbox hosted page (demo providers only)
  const hostedPage = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font-family:Inter,system-ui,sans-serif;background:#f4f6f9;color:#0e1320;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
.card{background:#fff;border:1px solid #d2d7df;border-radius:12px;padding:32px;max-width:440px;width:100%}
h1{font-size:18px;margin:0 0 4px}p{color:#5b6678;font-size:14px;line-height:1.5}
.amt{font-size:28px;font-weight:600;margin:16px 0}
button{font:inherit;padding:10px 16px;border-radius:8px;border:1px solid #1e3a8a;background:#1e3a8a;color:#fff;cursor:pointer;margin-right:8px}
button.secondary{background:#fff;color:#1e3a8a}.tag{display:inline-block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9a6700;background:#fbf1d9;padding:2px 8px;border-radius:999px}
code{font-family:ui-monospace,Menlo,monospace;font-size:12px;background:#f4f6f9;padding:2px 6px;border-radius:4px}
</style></head><body><div class="card">${body}</div></body></html>`;

  app.get<{ Params: { accountId: string; externalId: string } }>("/sandbox/hosted/:accountId/:externalId", async (req, reply) => {
    const [rec] = await db
      .select()
      .from(mockProviderRecords)
      .where(and(eq(mockProviderRecords.providerAccountId, req.params.accountId), eq(mockProviderRecords.externalId, req.params.externalId)))
      .limit(1);
    if (!rec) return reply.status(404).type("text/html").send(hostedPage("Not found", "<h1>Payment not found</h1><p>This sandbox payment does not exist.</p>"));
    if (rec.status !== "pending") {
      return reply.type("text/html").send(hostedPage("Sandbox payment", `<span class="tag">Sandbox · demo provider</span><h1>Payment already ${rec.status}</h1><p>Reference <code>${rec.externalId}</code></p>`));
    }
    const amount = (rec.amount / 100).toFixed(2);
    return reply.type("text/html").send(
      hostedPage(
        "Sandbox hosted page",
        `<span class="tag">Sandbox · NATIO demo provider</span><h1>Simulated hosted payment page</h1>
<p>A real provider would show its PCI-compliant checkout here. NATIO never sees card data.</p>
<div class="amt">${amount} ${rec.currency}</div>
<p>Reference <code>${rec.externalId}</code></p>
<form method="post" action="/sandbox/hosted/${rec.providerAccountId}/${rec.externalId}/complete" style="margin-top:16px">
<button name="outcome" value="approve">Approve payment</button>
<button class="secondary" name="outcome" value="decline">Decline</button></form>`,
      ),
    );
  });

  app.post<{ Params: { accountId: string; externalId: string } }>("/sandbox/hosted/:accountId/:externalId/complete", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const approve = (body.outcome ?? "approve") !== "decline";
    const [row] = await db
      .select({ account: providerAccounts, provider: providers })
      .from(providerAccounts)
      .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
      .where(eq(providerAccounts.id, req.params.accountId))
      .limit(1);
    if (!row) throw Errors.notFound("Provider account");
    const adapter = getAdapter(row.provider.adapterKey);
    if (!(adapter instanceof MockProviderAdapter)) throw Errors.forbidden("Hosted page simulation exists only for demo providers");
    const ctx = buildProviderContext(row.account, row.provider);
    const rec = await adapter.completeHosted(ctx, req.params.externalId, approve);
    if (!rec) throw Errors.conflict("not_pending", "This sandbox payment is not awaiting customer action");
    // The demo provider now notifies NATIO exactly like a real provider would: a signed webhook.
    const payload = JSON.stringify({ event_id: `mev_${randomString(12)}`, kind: "payment", external_id: rec.externalId, status: approve ? "captured" : "failed", amount: rec.amount, currency: rec.currency, failure_code: approve ? undefined : "cancelled_by_customer", message: approve ? "Customer approved" : "Customer declined" });
    const secret = String(ctx.credentials.webhookSecret ?? "");
    const res = await app.inject({ method: "POST", url: `/providers/webhooks/${row.account.id}`, headers: { "content-type": "application/json", "x-mock-signature": hmacSha256Hex(secret, payload) }, payload });
    const wantsHtml = String(req.headers.accept ?? "").includes("text/html");
    if (wantsHtml) {
      return reply.type("text/html").send(hostedPage("Sandbox payment", `<span class="tag">Sandbox · demo provider</span><h1>Payment ${approve ? "approved" : "declined"}</h1><p>The demo provider sent a signed webhook to NATIO (HTTP ${res.statusCode}). You can close this page and return to the merchant.</p>`));
    }
    return { ok: true, status: approve ? "captured" : "failed", provider_webhook_status: res.statusCode, natio: res.json() };
  });

  // Accept form posts for the hosted page (application/x-www-form-urlencoded).
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    try {
      const params = new URLSearchParams(String(body));
      done(null, Object.fromEntries(params.entries()));
    } catch (err) {
      done(err as Error);
    }
  });
}
