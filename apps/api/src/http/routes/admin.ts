/**
 * Internal admin API — /admin. Separate admin users, session cookie, CSRF and admin RBAC.
 * Every mutating action is written to the audit log by the underlying service.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { loadConfig } from "../../config.js";
import { getDb } from "../../db/client.js";
import { adminUsers, merchantUsers, projects, refunds, riskDecisions, routingDecisions } from "../../db/schema/index.js";
import { Errors } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { hashPassword } from "../../lib/crypto.js";
import { platformOverview, providerComparison } from "../../modules/analytics/service.js";
import { listAudit, listSystemEvents, recordAudit } from "../../modules/audit/service.js";
import { loginAdmin, revokeSession } from "../../modules/auth/service.js";
import { ADMIN_ROLES, hasAdminPermission, type AdminPermission, type AdminRole } from "../../modules/auth/permissions.js";
import { adminListMerchants, adminSetKyb, adminSetMerchantStatus, listProjects, listUsers, serializeMerchant, serializeProject, serializeUser } from "../../modules/merchants/service.js";
import { listPaymentsQuerySchema } from "../../modules/payments/schemas.js";
import { getPaymentDetail, getPaymentRow, getPaymentTimeline, listPayments, reviewPayment } from "../../modules/payments/service.js";
import { runOrchestration, syncAttempt } from "../../modules/payments/orchestrator.js";
import { serializeRefund } from "../../modules/refunds/service.js";
import { getPayoutDetail, listPayouts } from "../../modules/payouts/service.js";
import { listTransactions } from "../../modules/transactions/service.js";
import { createProviderAccount, listProvidersWithAccounts, providerHealth, recentProviderEvents, runHealthCheck, setProviderStatus, updateProviderAccount } from "../../modules/providers/service.js";
import { createRule, deleteRule, listRulesAdmin, simulateRoute, updateRule } from "../../modules/routing/service.js";
import { createRiskRule, deleteRiskRule, listRiskRules, updateRiskRule } from "../../modules/risk/service.js";
import { createSettlementFromProviderReport, getSettlementDetail, listSettlements } from "../../modules/settlements/service.js";
import { getBatchDetail, listBatches, parseProviderCsv, resolveItem, runReconciliation, sandboxProviderReport } from "../../modules/reconciliation/service.js";
import { getDeliveryDetail, listDeliveries, resendDelivery } from "../../modules/webhooks/service.js";
import { getDb as _db } from "../../db/client.js";
import { actorFromRequest } from "../context.js";
import { requireAdmin } from "../guards.js";
import { clearSessionCookie, dateOrUndefined, periodFromQuery, setSessionCookie } from "../helpers.js";
import { parse, parseQuery } from "../validate.js";
import { merchants as merchantsTable } from "../../db/schema/index.js";

const conditionSchema = z.object({ field: z.string().min(1).max(40), op: z.enum(["eq", "neq", "in", "not_in", "gt", "gte", "lt", "lte", "between"]), value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]) });

export async function registerAdminRoutes(app: FastifyInstance) {
  const cfg = loadConfig();
  const db = getDb();

  await app.register(async (a) => {
    const authLimit = { rateLimit: { max: cfg.RATE_LIMIT_AUTH_PER_MINUTE, timeWindow: "1 minute" } };
    a.post("/auth/login", { config: authLimit }, async (req, reply) => {
      const body = parse(z.object({ email: z.string().email(), password: z.string().min(1).max(200) }), req.body);
      const { token, principal } = await loginAdmin(db, { ...body, ip: req.ip, userAgent: String(req.headers["user-agent"] ?? "") });
      setSessionCookie(reply, "admin", token, cfg.ADMIN_SESSION_TTL_HOURS);
      return { admin: { id: principal.admin.id, email: principal.admin.email, name: principal.admin.name, role: principal.admin.role }, csrf_token: principal.session.csrfToken };
    });
    a.post("/auth/logout", async (req, reply) => {
      const token = req.cookies?.natio_admin_session;
      if (token) {
        const { resolveAdminSession } = await import("../../modules/auth/service.js");
        const p = await resolveAdminSession(db, token);
        if (p) await revokeSession(db, p.session.id);
      }
      clearSessionCookie(reply, "admin");
      return { ok: true };
    });

    await a.register(async (r) => {
      r.addHook("preHandler", requireAdmin("admin.read"));
      const admin = (req: FastifyRequest) => req.admin!.admin;
      const need = (req: FastifyRequest, p: AdminPermission) => {
        if (!hasAdminPermission(admin(req).role, p)) throw Errors.forbidden(`Requires admin permission ${p}`);
      };

      r.get("/auth/me", async (req) => ({ admin: { id: admin(req).id, email: admin(req).email, name: admin(req).name, role: admin(req).role }, csrf_token: req.admin!.session.csrfToken, mode: req.dashboardMode }));

      // ---------------------------------------------------------------- overview
      r.get("/overview", async (req) => {
        const { from, to } = periodFromQuery(req.query as Record<string, unknown>, 1);
        const [platform, providers, health, events] = await Promise.all([
          platformOverview(db, req.dashboardMode, from, to),
          listProvidersWithAccounts(db, { mode: req.dashboardMode }),
          providerHealth(db, 24),
          listSystemEvents(db, { limit: 10 }),
        ]);
        const [m] = await db.select({ total: sql<number>`count(*)`.mapWith(Number), active: sql<number>`count(*) filter (where status = 'active')`.mapWith(Number), kybPending: sql<number>`count(*) filter (where kyb_status = 'pending')`.mapWith(Number) }).from(merchantsTable);
        return { period: { from, to }, payments: platform, merchants: m, providers, health, recent_events: events };
      });

      // ---------------------------------------------------------------- merchants
      r.get("/merchants", async (req) => {
        const q = req.query as Record<string, string | undefined>;
        return { data: await adminListMerchants(db, { search: q.search, status: q.status, kyb: q.kyb, limit: q.limit ? Number(q.limit) : undefined }) };
      });
      r.get<{ Params: { id: string } }>("/merchants/:id", async (req) => {
        const [m] = await db.select().from(merchantsTable).where(eq(merchantsTable.id, req.params.id)).limit(1);
        if (!m) throw Errors.notFound("Merchant", req.params.id);
        const [users, projs, recent] = await Promise.all([listUsers(db, m.id), listProjects(db, m.id), listPayments(db, { merchantId: m.id, limit: 10 })]);
        return { ...serializeMerchant(m), users: users.map(serializeUser), projects: projs.map(serializeProject), recent_payments: recent.data };
      });
      r.post<{ Params: { id: string } }>("/merchants/:id/status", async (req) => {
        need(req, "merchants.manage");
        const body = parse(z.object({ status: z.enum(["active", "disabled"]), reason: z.string().max(300).optional() }), req.body);
        await adminSetMerchantStatus(db, req.params.id, body.status, actorFromRequest(req), body.reason);
        return { ok: true };
      });
      r.post<{ Params: { id: string } }>("/merchants/:id/kyb", async (req) => {
        need(req, "merchants.manage");
        const body = parse(z.object({ kyb_status: z.enum(["not_started", "pending", "approved", "rejected"]), note: z.string().max(500).optional() }), req.body);
        await adminSetKyb(db, req.params.id, body.kyb_status, actorFromRequest(req), body.note);
        return { ok: true };
      });

      // ---------------------------------------------------------------- payments / transactions / payouts
      r.get("/payments", async (req) => {
        const q = parseQuery(listPaymentsQuerySchema.extend({ merchant_id: z.string().optional() }), req.query);
        return listPayments(db, { merchantId: q.merchant_id, mode: req.dashboardMode, status: q.status, currency: q.currency, country: q.country, paymentMethod: q.payment_method, providerAccountId: q.provider_account_id, search: q.search, from: dateOrUndefined(q.from), to: dateOrUndefined(q.to), limit: q.limit, cursor: q.cursor });
      });
      r.get<{ Params: { id: string } }>("/payments/:id", async (req) => {
        const detail = await getPaymentDetail(db, req.params.id);
        if (!detail) throw Errors.notFound("Payment", req.params.id);
        const [timeline, rfs, decision, risk, merchant] = await Promise.all([
          getPaymentTimeline(db, req.params.id),
          db.select().from(refunds).where(eq(refunds.paymentId, req.params.id)).orderBy(desc(refunds.createdAt)),
          detail.row.routingDecisionId ? db.select().from(routingDecisions).where(eq(routingDecisions.id, detail.row.routingDecisionId)).limit(1).then((x) => x[0] ?? null) : null,
          detail.row.riskDecisionId ? db.select().from(riskDecisions).where(eq(riskDecisions.id, detail.row.riskDecisionId)).limit(1).then((x) => x[0] ?? null) : null,
          db.select().from(merchantsTable).where(eq(merchantsTable.id, detail.row.merchantId)).limit(1).then((x) => x[0] ?? null),
        ]);
        return { ...detail.serialized, merchant: merchant ? { id: merchant.id, name: merchant.name } : null, timeline, refunds: rfs.map(serializeRefund), routing_decision: decision, risk_decision: risk };
      });
      r.post<{ Params: { id: string } }>("/payments/:id/review", async (req) => {
        need(req, "operations.retry");
        const body = parse(z.object({ decision: z.enum(["approve", "reject"]) }), req.body);
        const p = await getPaymentRow(db, req.params.id);
        if (!p) throw Errors.notFound("Payment", req.params.id);
        await reviewPayment(db, p, body.decision, actorFromRequest(req));
        return (await getPaymentDetail(db, p.id))!.serialized;
      });
      /** Manually resume orchestration for a payment stuck in processing (e.g. after an unresolved sync). */
      r.post<{ Params: { id: string } }>("/payments/:id/retry", async (req) => {
        need(req, "operations.retry");
        const p = await getPaymentRow(db, req.params.id);
        if (!p) throw Errors.notFound("Payment", req.params.id);
        if (p.status !== "processing" && p.status !== "pending") throw Errors.conflict("not_retryable", `Payment in status ${p.status} cannot be retried`);
        await recordAudit(db, { actor: actorFromRequest(req), merchantId: p.merchantId, action: "payment.manual_retry", entityType: "payment", entityId: p.id });
        await runOrchestration(db, p.id, { type: "admin_user", id: admin(req).id });
        return (await getPaymentDetail(db, p.id))!.serialized;
      });
      r.post<{ Params: { id: string } }>("/attempts/:id/sync", async (req) => {
        need(req, "operations.retry");
        await recordAudit(db, { actor: actorFromRequest(req), action: "attempt.manual_sync", entityType: "payment_attempt", entityId: req.params.id });
        await syncAttempt(db, { attemptId: req.params.id, tries: 99 });
        return { ok: true };
      });
      r.get("/transactions", async (req) => {
        const q = req.query as Record<string, string | undefined>;
        return listTransactions(db, { merchantId: q.merchant_id, mode: req.dashboardMode, type: q.type, status: q.status, currency: q.currency, providerAccountId: q.provider_account_id, search: q.search, from: dateOrUndefined(q.from), to: dateOrUndefined(q.to), limit: q.limit ? Number(q.limit) : undefined, cursor: q.cursor });
      });
      r.get("/payouts", async (req) => {
        const q = req.query as Record<string, string | undefined>;
        return listPayouts(db, { merchantId: q.merchant_id, mode: req.dashboardMode, status: q.status, currency: q.currency, search: q.search, limit: q.limit ? Number(q.limit) : undefined, cursor: q.cursor });
      });
      r.get<{ Params: { id: string } }>("/payouts/:id", async (req) => {
        const p = await getPayoutDetail(db, req.params.id);
        if (!p) throw Errors.notFound("Payout", req.params.id);
        return p;
      });

      // ---------------------------------------------------------------- providers
      r.get("/providers", async (req) => ({ data: await listProvidersWithAccounts(db, { mode: (req.query as Record<string, string>).mode as never }) }));
      r.post<{ Params: { id: string } }>("/providers/:id/status", async (req) => {
        need(req, "providers.manage");
        const body = parse(z.object({ status: z.enum(["active", "disabled"]), reason: z.string().max(300).optional() }), req.body);
        await setProviderStatus(db, req.params.id, body.status, actorFromRequest(req), body.reason);
        return { ok: true };
      });
      const accountInput = z.object({
        name: z.string().min(2).max(80).optional(),
        status: z.enum(["active", "disabled"]).optional(),
        priority: z.number().int().min(0).max(10000).optional(),
        fee_percent: z.number().min(0).max(100).optional(),
        fee_fixed_minor: z.number().int().min(0).optional(),
        limits: z.object({ minAmount: z.number().int().nonnegative().optional(), maxAmount: z.number().int().positive().optional() }).optional(),
        currencies: z.array(z.string().length(3)).max(60).optional(),
        config: z.object({ simulation: z.object({ forceOutcome: z.enum(["success", "soft_decline", "hard_decline", "technical_error", "timeout", "provider_unavailable"]).nullable().optional(), technicalErrorRate: z.number().min(0).max(1).optional(), latencyMs: z.number().int().min(0).max(30000).optional() }).optional() }).passthrough().optional(),
        credentials: z.record(z.unknown()).optional(),
      });
      r.patch<{ Params: { id: string } }>("/provider-accounts/:id", async (req) => {
        need(req, "providers.manage");
        const body = parse(accountInput, req.body);
        const config = body.config ? { ...body.config, simulation: body.config.simulation ? { ...body.config.simulation, forceOutcome: body.config.simulation.forceOutcome ?? undefined } : undefined } : undefined;
        const updated = await updateProviderAccount(db, req.params.id, { name: body.name, status: body.status, priority: body.priority, feePercent: body.fee_percent, feeFixedMinor: body.fee_fixed_minor, limits: body.limits as Record<string, number> | undefined, currencies: body.currencies, config: config as never, credentials: body.credentials }, actorFromRequest(req));
        const { serializeAccount } = await import("../../modules/providers/service.js");
        return serializeAccount(updated);
      });
      r.post("/provider-accounts", async (req, reply) => {
        need(req, "providers.manage");
        const body = parse(accountInput.extend({ provider_id: z.string(), mode: z.enum(["test", "live"]), name: z.string().min(2).max(80), merchant_id: z.string().optional() }), req.body);
        const acc = await createProviderAccount(db, { providerId: body.provider_id, mode: body.mode, name: body.name, merchantId: body.merchant_id ?? null, priority: body.priority, feePercent: body.fee_percent, feeFixedMinor: body.fee_fixed_minor, currencies: body.currencies, credentials: body.credentials, config: body.config as never }, actorFromRequest(req));
        const { serializeAccount } = await import("../../modules/providers/service.js");
        return reply.status(201).send(serializeAccount(acc));
      });
      r.post<{ Params: { id: string } }>("/provider-accounts/:id/health-check", async (req) => {
        need(req, "providers.manage");
        return runHealthCheck(db, req.params.id, actorFromRequest(req));
      });
      r.get<{ Params: { id: string } }>("/provider-accounts/:id/events", async (req) => ({ data: await recentProviderEvents(db, req.params.id) }));
      r.get("/providers/comparison", async (req) => {
        const { from, to } = periodFromQuery(req.query as Record<string, unknown>, 7);
        return providerComparison(db, { mode: req.dashboardMode, from, to, currency: (req.query as Record<string, string>).currency });
      });

      // ---------------------------------------------------------------- routing rules
      const ruleInput = z.object({
        name: z.string().min(2).max(120),
        description: z.string().max(500).optional(),
        merchant_id: z.string().nullable().optional(),
        project_id: z.string().nullable().optional(),
        mode: z.enum(["test", "live"]),
        priority: z.number().int().min(0).max(10000).default(100),
        enabled: z.boolean().default(true),
        transaction_type: z.enum(["payment", "payout"]).default("payment"),
        conditions: z.array(conditionSchema).max(20).default([]),
        strategy: z.enum(["ordered", "weighted", "score"]).default("ordered"),
        routes: z.array(z.object({ provider_account_id: z.string(), weight: z.number().int().min(1).max(1000).optional() })).max(10).default([]),
      });
      const toRuleInput = (b: z.infer<typeof ruleInput>) => ({
        name: b.name,
        description: b.description,
        merchantId: b.merchant_id ?? null,
        projectId: b.project_id ?? null,
        mode: b.mode,
        priority: b.priority,
        enabled: b.enabled,
        transactionType: b.transaction_type,
        conditions: b.conditions as never,
        strategy: b.strategy,
        routes: b.routes.map((x) => ({ providerAccountId: x.provider_account_id, weight: x.weight })),
      });
      r.get("/routing/rules", async (req) => {
        const q = req.query as Record<string, string | undefined>;
        return { data: await listRulesAdmin(db, { mode: q.mode, merchantId: q.merchant_id }) };
      });
      r.post("/routing/rules", async (req, reply) => {
        need(req, "routing.manage");
        const body = parse(ruleInput, req.body);
        const id = await createRule(db, toRuleInput(body), actorFromRequest(req));
        return reply.status(201).send({ id });
      });
      r.patch<{ Params: { id: string } }>("/routing/rules/:id", async (req) => {
        need(req, "routing.manage");
        const body = parse(ruleInput.partial(), req.body);
        await updateRule(
          db,
          req.params.id,
          {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.mode !== undefined ? { mode: body.mode } : {}),
            ...(body.merchant_id !== undefined ? { merchantId: body.merchant_id } : {}),
            ...(body.project_id !== undefined ? { projectId: body.project_id } : {}),
            ...(body.priority !== undefined ? { priority: body.priority } : {}),
            ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
            ...(body.transaction_type !== undefined ? { transactionType: body.transaction_type } : {}),
            ...(body.conditions !== undefined ? { conditions: body.conditions as never } : {}),
            ...(body.strategy !== undefined ? { strategy: body.strategy } : {}),
            ...(body.routes !== undefined ? { routes: body.routes.map((x) => ({ providerAccountId: x.provider_account_id, weight: x.weight })) } : {}),
          },
          actorFromRequest(req),
        );
        return { ok: true };
      });
      r.delete<{ Params: { id: string } }>("/routing/rules/:id", async (req) => {
        need(req, "routing.manage");
        await deleteRule(db, req.params.id, actorFromRequest(req));
        return { ok: true };
      });
      r.post("/routing/reorder", async (req) => {
        need(req, "routing.manage");
        const body = parse(z.object({ order: z.array(z.string()).min(1).max(200) }), req.body);
        for (let i = 0; i < body.order.length; i++) await updateRule(db, body.order[i]!, { priority: (i + 1) * 10 }, actorFromRequest(req));
        return { ok: true };
      });
      r.post("/routing/simulate", async (req) => {
        const body = parse(
          z.object({
            merchant_id: z.string(),
            project_id: z.string().optional(),
            mode: z.enum(["test", "live"]).default("test"),
            transaction_type: z.enum(["payment", "payout"]).default("payment"),
            amount: z.number().int().positive(),
            currency: z.string().length(3),
            payment_method: z.string(),
            country: z.string().length(2).optional(),
            risk_score: z.number().optional(),
          }),
          req.body,
        );
        let projectId = body.project_id;
        if (!projectId) {
          const [p] = await db.select().from(projects).where(eq(projects.merchantId, body.merchant_id)).limit(1);
          projectId = p?.id ?? "";
        }
        const result = await simulateRoute(db, { transactionType: body.transaction_type, merchantId: body.merchant_id, projectId, mode: body.mode, amount: body.amount, currency: body.currency.toUpperCase(), paymentMethod: body.payment_method, country: body.country, riskScore: body.risk_score, seed: "simulation" });
        return { rule: result.rule ? { id: result.rule.id, name: result.rule.name } : null, strategy: result.strategy, reason: result.reason, ordered: result.ordered.map((c) => ({ provider_account_id: c.account.id, provider: c.provider.name, account: c.account.name })), candidates: result.candidates };
      });

      // ---------------------------------------------------------------- risk rules
      const riskInput = z.object({
        name: z.string().min(2).max(120),
        description: z.string().max(500).optional(),
        merchant_id: z.string().nullable().optional(),
        mode: z.enum(["test", "live"]),
        priority: z.number().int().min(0).max(10000).default(100),
        enabled: z.boolean().default(true),
        conditions: z.array(conditionSchema.omit({ op: true }).extend({ op: z.enum(["eq", "neq", "in", "not_in", "gt", "gte", "lt", "lte"]) })).min(1).max(20),
        action: z.enum(["allow", "review", "block"]),
        score: z.number().int().min(0).max(100).default(0),
      });
      r.get("/risk/rules", async (req) => {
        const q = req.query as Record<string, string | undefined>;
        return { data: await listRiskRules(db, { mode: q.mode, merchantId: q.merchant_id }) };
      });
      r.post("/risk/rules", async (req, reply) => {
        need(req, "risk.manage");
        const b = parse(riskInput, req.body);
        const id = await createRiskRule(db, { name: b.name, description: b.description, merchantId: b.merchant_id ?? null, mode: b.mode, priority: b.priority, enabled: b.enabled, conditions: b.conditions as never, action: b.action, score: b.score }, actorFromRequest(req));
        return reply.status(201).send({ id });
      });
      r.patch<{ Params: { id: string } }>("/risk/rules/:id", async (req) => {
        need(req, "risk.manage");
        const b = parse(riskInput.partial(), req.body);
        await updateRiskRule(db, req.params.id, { name: b.name, description: b.description, merchantId: b.merchant_id, mode: b.mode, priority: b.priority, enabled: b.enabled, conditions: b.conditions as never, action: b.action, score: b.score }, actorFromRequest(req));
        return { ok: true };
      });
      r.delete<{ Params: { id: string } }>("/risk/rules/:id", async (req) => {
        need(req, "risk.manage");
        await deleteRiskRule(db, req.params.id, actorFromRequest(req));
        return { ok: true };
      });
      r.get("/risk/decisions", async (req) => {
        const q = req.query as Record<string, string | undefined>;
        const conds = [];
        if (q.decision) conds.push(eq(riskDecisions.decision, q.decision as never));
        const rows = await db
          .select()
          .from(riskDecisions)
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(riskDecisions.createdAt))
          .limit(100);
        return { data: rows };
      });

      // ---------------------------------------------------------------- settlements
      r.get("/settlements", async (req) => {
        const q = req.query as Record<string, string | undefined>;
        return { data: await listSettlements(db, { merchantId: q.merchant_id, mode: req.dashboardMode, providerAccountId: q.provider_account_id, status: q.status, limit: q.limit ? Number(q.limit) : undefined }) };
      });
      r.get<{ Params: { id: string } }>("/settlements/:id", async (req) => {
        const s = await getSettlementDetail(db, req.params.id);
        if (!s) throw Errors.notFound("Settlement", req.params.id);
        return s;
      });
      r.post("/settlements/import", async (req, reply) => {
        need(req, "settlements.manage");
        const body = parse(z.object({ merchant_id: z.string(), provider_account_id: z.string(), period_start: z.string().datetime(), period_end: z.string().datetime(), reference: z.string().max(120).optional(), source: z.enum(["provider_report", "provider_api", "manual"]).default("provider_report") }), req.body);
        const created = await createSettlementFromProviderReport(db, { merchantId: body.merchant_id, mode: req.dashboardMode, providerAccountId: body.provider_account_id, periodStart: new Date(body.period_start), periodEnd: new Date(body.period_end), reference: body.reference, source: body.source, actor: actorFromRequest(req) });
        return reply.status(201).send({ data: created.map((s) => ({ id: s.id, currency: s.currency, net_amount: s.netAmount, transaction_count: s.transactionCount })) });
      });

      // ---------------------------------------------------------------- reconciliation
      r.get("/reconciliation/batches", async (req) => ({ data: await listBatches(db, { merchantId: (req.query as Record<string, string>).merchant_id, mode: req.dashboardMode, limit: 100 }) }));
      r.get<{ Params: { id: string } }>("/reconciliation/batches/:id", async (req) => {
        const b = await getBatchDetail(db, req.params.id, undefined, { status: (req.query as Record<string, string>).status });
        if (!b) throw Errors.notFound("Reconciliation batch", req.params.id);
        return b;
      });
      r.post("/reconciliation/upload", async (req, reply) => {
        need(req, "reconciliation.manage");
        const file = await req.file();
        if (!file) throw Errors.badRequest("file_required", "Upload a CSV file in the `file` field");
        const fields = file.fields as Record<string, { value?: string } | undefined>;
        const providerAccountId = fields.provider_account_id?.value;
        if (!providerAccountId) throw Errors.badRequest("provider_account_required", "provider_account_id is required");
        const rows = parseProviderCsv((await file.toBuffer()).toString("utf8"));
        const batch = await runReconciliation(db, { merchantId: fields.merchant_id?.value ?? null, mode: req.dashboardMode, providerAccountId, source: "csv", fileName: file.filename, rows, periodStart: dateOrUndefined(fields.period_start?.value), periodEnd: dateOrUndefined(fields.period_end?.value), actor: actorFromRequest(req) });
        return reply.status(201).send(await getBatchDetail(db, batch.id));
      });
      r.post("/reconciliation/run-sandbox", async (req, reply) => {
        need(req, "reconciliation.manage");
        const body = parse(z.object({ provider_account_id: z.string(), merchant_id: z.string().optional() }), req.body);
        const { rows } = await sandboxProviderReport(db, body.provider_account_id);
        const batch = await runReconciliation(db, { merchantId: body.merchant_id ?? null, mode: "test", providerAccountId: body.provider_account_id, source: "api", fileName: "demo-provider-report", rows, actor: actorFromRequest(req) });
        return reply.status(201).send(await getBatchDetail(db, batch.id));
      });
      r.post<{ Params: { id: string } }>("/reconciliation/items/:id/resolve", async (req) => {
        need(req, "reconciliation.manage");
        const body = parse(z.object({ note: z.string().min(1).max(500) }), req.body);
        await resolveItem(db, req.params.id, body.note, actorFromRequest(req));
        return { ok: true };
      });

      // ---------------------------------------------------------------- webhooks, events, audit, users
      r.get("/webhooks/deliveries", async (req) => {
        const q = req.query as Record<string, string | undefined>;
        return listDeliveries(db, { merchantId: q.merchant_id, mode: req.dashboardMode, status: q.status, eventType: q.event_type, limit: q.limit ? Number(q.limit) : undefined, cursor: q.cursor });
      });
      r.get<{ Params: { id: string } }>("/webhooks/deliveries/:id", async (req) => {
        const d = await getDeliveryDetail(db, req.params.id);
        if (!d) throw Errors.notFound("Webhook delivery", req.params.id);
        return d;
      });
      r.post<{ Params: { id: string } }>("/webhooks/deliveries/:id/resend", async (req) => {
        need(req, "webhooks.resend");
        await resendDelivery(db, { deliveryId: req.params.id, actor: actorFromRequest(req) });
        return { ok: true };
      });
      r.get("/system-events", async (req) => {
        const q = req.query as Record<string, string | undefined>;
        return { data: await listSystemEvents(db, { level: q.level, source: q.source, limit: q.limit ? Number(q.limit) : undefined, before: dateOrUndefined(q.before) }) };
      });
      r.get("/audit", async (req) => {
        need(req, "audit.read");
        const q = req.query as Record<string, string | undefined>;
        const rows = await listAudit(db, { merchantId: q.merchant_id, actorType: q.actor_type, action: q.action, entityId: q.entity_id, limit: q.limit ? Number(q.limit) : undefined, before: dateOrUndefined(q.before) });
        return { data: rows.map((x) => ({ id: x.id, actor_type: x.actorType, actor_id: x.actorId, actor_label: x.actorLabel, merchant_id: x.merchantId, action: x.action, entity_type: x.entityType, entity_id: x.entityId, before: x.before, after: x.after, ip: x.ip, request_id: x.requestId, created_at: x.createdAt })) };
      });
      r.get("/users", async (req) => {
        const q = req.query as Record<string, string | undefined>;
        const admins = await db.select().from(adminUsers).orderBy(adminUsers.createdAt);
        const conds = [];
        if (q.merchant_id) conds.push(eq(merchantUsers.merchantId, q.merchant_id));
        const mus = await db
          .select({ u: merchantUsers, merchantName: merchantsTable.name })
          .from(merchantUsers)
          .innerJoin(merchantsTable, eq(merchantsTable.id, merchantUsers.merchantId))
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(merchantUsers.createdAt))
          .limit(200);
        return {
          admins: admins.map((x) => ({ id: x.id, email: x.email, name: x.name, role: x.role, status: x.status, last_login_at: x.lastLoginAt, created_at: x.createdAt })),
          merchant_users: mus.map((x) => ({ ...serializeUser(x.u), merchant_id: x.u.merchantId, merchant_name: x.merchantName })),
          roles: ADMIN_ROLES,
        };
      });
      r.post("/users", async (req, reply) => {
        need(req, "admin_users.manage");
        const body = parse(z.object({ email: z.string().email(), name: z.string().min(2).max(120), role: z.enum(ADMIN_ROLES as [AdminRole, ...AdminRole[]]), password: z.string().min(12).max(200) }), req.body);
        const [exists] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, body.email.toLowerCase())).limit(1);
        if (exists) throw Errors.conflict("email_taken", "An admin with this email already exists");
        const id = newId("adminUser");
        await db.insert(adminUsers).values({ id, email: body.email.toLowerCase(), name: body.name, role: body.role, passwordHash: await hashPassword(body.password) });
        await recordAudit(db, { actor: actorFromRequest(req), action: "admin_user.created", entityType: "admin_user", entityId: id, after: { email: body.email, role: body.role } });
        return reply.status(201).send({ id });
      });
      r.patch<{ Params: { id: string } }>("/users/:id", async (req) => {
        need(req, "admin_users.manage");
        const body = parse(z.object({ role: z.enum(ADMIN_ROLES as [AdminRole, ...AdminRole[]]).optional(), status: z.enum(["active", "disabled"]).optional() }), req.body);
        if (req.params.id === admin(req).id) throw Errors.forbidden("You cannot change your own role or status");
        const [before] = await db.select().from(adminUsers).where(eq(adminUsers.id, req.params.id)).limit(1);
        if (!before) throw Errors.notFound("Admin user", req.params.id);
        await db.update(adminUsers).set({ ...(body.role ? { role: body.role } : {}), ...(body.status ? { status: body.status } : {}), updatedAt: new Date() }).where(eq(adminUsers.id, before.id));
        await recordAudit(db, { actor: actorFromRequest(req), action: "admin_user.updated", entityType: "admin_user", entityId: before.id, before: { role: before.role, status: before.status }, after: body });
        return { ok: true };
      });
    });
  }, { prefix: "/admin" });
  void _db;
}
