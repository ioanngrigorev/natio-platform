/**
 * Merchant dashboard API — /dashboard. Cookie session + CSRF header + RBAC.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { loadConfig } from "../../config.js";
import { getDb } from "../../db/client.js";
import { Errors } from "../../lib/errors.js";
import { WEBHOOK_EVENT_TYPES } from "../../db/schema/index.js";
import { createApiKey, listApiKeys, publicApiKey, revokeApiKey } from "../../modules/api-keys/service.js";
import { acceptInvite, changePassword, inviteUser, loginMerchant, registerMerchant, revokeSession, setUserStatus, updateUserRole } from "../../modules/auth/service.js";
import { assignableRoles, MERCHANT_ROLES, permissionsForRole, type MerchantRole, type Permission } from "../../modules/auth/permissions.js";
import { listAudit } from "../../modules/audit/service.js";
import { breakdowns, overview, providerComparison, timeseries } from "../../modules/analytics/service.js";
import { createProject, listProjects, listUsers, serializeMerchant, serializeProject, serializeUser, updateMerchantProfile, updateProject } from "../../modules/merchants/service.js";
import { cancelSchema, captureSchema, createPaymentSchema,
  createPaymentObject,
  settlementRule, listPaymentsQuerySchema, refundSchema } from "../../modules/payments/schemas.js";
import { cancelPayment, capturePayment, createPayment, getPaymentDetail, getPaymentRow, getPaymentTimeline, listPayments } from "../../modules/payments/service.js";
import { TEST_SCENARIOS } from "../../modules/payments/scenarios.js";
import { createRefund, listRefundsForPayment, serializeRefund } from "../../modules/refunds/service.js";
import { cancelPayout, createPayout, createPayoutSchema, getPayout, getPayoutDetail, listPayouts, serializePayout } from "../../modules/payouts/service.js";
import { listTransactions } from "../../modules/transactions/service.js";
import { balances, getSettlementDetail, listSettlements } from "../../modules/settlements/service.js";
import { assertProviderAccountVisible, getBatchDetail, listBatches, parseProviderCsv, runReconciliation, sandboxProviderReport } from "../../modules/reconciliation/service.js";
import { createEndpoint, deleteEndpoint, getDeliveryDetail, listDeliveries, listEndpoints, resendDelivery, rotateEndpointSecret, sendTestEvent, serializeEndpoint, updateEndpoint } from "../../modules/webhooks/service.js";
import { listProvidersWithAccounts, providerHealth } from "../../modules/providers/service.js";
import { listRulesAdmin } from "../../modules/routing/service.js";
import { actorFromRequest } from "../context.js";
import { requireMerchant } from "../guards.js";
import { clearSessionCookie, dateOrUndefined, periodFromQuery, setSessionCookie } from "../helpers.js";
import { parse, parseQuery } from "../validate.js";

const passwordSchema = z.string().min(10).max(200).refine((p) => /[a-z]/.test(p) && /[A-Z0-9]/.test(p), { message: "use at least 10 characters with mixed case or digits" });

export async function registerDashboardRoutes(app: FastifyInstance) {
  const cfg = loadConfig();
  const db = getDb();

  await app.register(async (d) => {
    // ------------------------------------------------------------------ auth (public)
    const authLimit = { rateLimit: { max: cfg.RATE_LIMIT_AUTH_PER_MINUTE, timeWindow: "1 minute" } };

    d.post("/auth/register", { config: authLimit }, async (req, reply) => {
      const body = parse(
        z.object({
          company_name: z.string().min(2).max(120),
          country: z.string().length(2).optional(),
          website: z.string().url().optional(),
          name: z.string().min(2).max(120),
          email: z.string().email(),
          password: passwordSchema,
        }),
        req.body,
      );
      const { merchant, user } = await registerMerchant(db, { companyName: body.company_name, country: body.country, website: body.website, name: body.name, email: body.email, password: body.password, actor: actorFromRequest(req) });
      const login = await loginMerchant(db, { email: body.email, password: body.password, ip: req.ip, userAgent: String(req.headers["user-agent"] ?? "") });
      setSessionCookie(reply, "merchant", login.token, cfg.SESSION_TTL_HOURS);
      return reply.status(201).send({ merchant: serializeMerchant(merchant), user: serializeUser(user), csrf_token: login.principal.session.csrfToken });
    });

    d.post("/auth/login", { config: authLimit }, async (req, reply) => {
      const body = parse(z.object({ email: z.string().email(), password: z.string().min(1).max(200) }), req.body);
      const { token, principal } = await loginMerchant(db, { ...body, ip: req.ip, userAgent: String(req.headers["user-agent"] ?? "") });
      setSessionCookie(reply, "merchant", token, cfg.SESSION_TTL_HOURS);
      return { user: serializeUser(principal.user), merchant: serializeMerchant(principal.merchant), csrf_token: principal.session.csrfToken, permissions: permissionsForRole(principal.user.role) };
    });

    d.post("/auth/accept-invite", { config: authLimit }, async (req, reply) => {
      const body = parse(z.object({ token: z.string().min(10), password: passwordSchema }), req.body);
      const user = await acceptInvite(db, { token: body.token, password: body.password, ip: req.ip });
      const login = await loginMerchant(db, { email: user.email, password: body.password, ip: req.ip, userAgent: String(req.headers["user-agent"] ?? "") });
      setSessionCookie(reply, "merchant", login.token, cfg.SESSION_TTL_HOURS);
      return { user: serializeUser(login.principal.user), csrf_token: login.principal.session.csrfToken };
    });

    d.post("/auth/logout", async (req, reply) => {
      const token = req.cookies?.natio_session;
      if (token) {
        const { resolveMerchantSession } = await import("../../modules/auth/service.js");
        const principal = await resolveMerchantSession(db, token);
        if (principal) await revokeSession(db, principal.session.id);
      }
      clearSessionCookie(reply, "merchant");
      return { ok: true };
    });

    // ------------------------------------------------------------------ authenticated
    await d.register(async (m) => {
      m.addHook("preHandler", requireMerchant());
      const me = (req: FastifyRequest) => req.merchantUser!;
      const merchantId = (req: FastifyRequest) => req.merchantUser!.merchant.id;
      const need = (req: FastifyRequest, p: Permission) => {
        if (!permissionsForRole(me(req).user.role).includes(p)) throw Errors.forbidden(`Requires permission ${p}`);
      };
      const projectOf = async (req: FastifyRequest, projectId?: string) => {
        const list = await listProjects(db, merchantId(req));
        const p = projectId ? list.find((x) => x.id === projectId) : list[0];
        if (!p) throw Errors.notFound("Project", projectId);
        return p;
      };

      m.get("/auth/me", async (req) => {
        const { user, merchant, session } = me(req);
        const projects = await listProjects(db, merchant.id);
        return { user: serializeUser(user), merchant: serializeMerchant(merchant), projects: projects.map(serializeProject), permissions: permissionsForRole(user.role), csrf_token: session.csrfToken, mode: req.dashboardMode };
      });

      m.post("/auth/password", async (req) => {
        const body = parse(z.object({ current_password: z.string().min(1), new_password: passwordSchema }), req.body);
        await changePassword(db, { userId: me(req).user.id, currentPassword: body.current_password, newPassword: body.new_password, actor: actorFromRequest(req), keepSessionId: me(req).session.id });
        return { ok: true };
      });

      // ---------------------------------------------------------------- merchant & projects
      m.get("/merchant", async (req) => serializeMerchant(me(req).merchant));
      m.patch("/merchant", async (req) => {
        need(req, "merchant.update");
        const body = parse(
          z.object({
            name: z.string().min(2).max(120).optional(),
            legal_name: z.string().max(200).optional(),
            country: z.string().length(2).optional(),
            website: z.string().url().or(z.literal("")).optional(),
            registration_number: z.string().max(64).optional(),
            contact_email: z.string().email().optional(),
            settings: z.object({ industry: z.string().max(64).optional(), default_currency: z.string().length(3).optional(), timezone: z.string().max(64).optional() }).optional(),
          }),
          req.body,
        );
        const updated = await updateMerchantProfile(
          db,
          merchantId(req),
          { name: body.name, legalName: body.legal_name, country: body.country, website: body.website, registrationNumber: body.registration_number, contactEmail: body.contact_email, settings: body.settings ? { industry: body.settings.industry, defaultCurrency: body.settings.default_currency, timezone: body.settings.timezone } : undefined },
          actorFromRequest(req),
        );
        return serializeMerchant(updated);
      });

      m.get("/projects", async (req) => ({ data: (await listProjects(db, merchantId(req))).map(serializeProject) }));
      m.post("/projects", async (req, reply) => {
        need(req, "projects.manage");
        const body = parse(z.object({ name: z.string().min(2).max(80) }), req.body);
        return reply.status(201).send(serializeProject(await createProject(db, merchantId(req), body, actorFromRequest(req))));
      });
      m.patch<{ Params: { id: string } }>("/projects/:id", async (req) => {
        need(req, "projects.manage");
        const body = parse(
          z.object({
            name: z.string().min(2).max(80).optional(),
            status: z.enum(["active", "disabled"]).optional(),
            settings: z
              .object({
                allowed_ips: z.array(z.string().max(64)).max(50).optional(),
                allowed_domains: z.array(z.string().max(253)).max(50).optional(),
                default_currency: z.string().length(3).optional(),
                capture_method: z.enum(["automatic", "manual"]).optional(),
                retry_policy: z.object({ max_attempts: z.number().int().min(1).max(5).optional(), retry_on_soft_decline: z.boolean().optional(), retry_on_timeout: z.boolean().optional() }).optional(),
                statement_descriptor: z.string().max(22).optional(),
              })
              .optional(),
          }),
          req.body,
        );
        const s = body.settings;
        const updated = await updateProject(
          db,
          merchantId(req),
          req.params.id,
          {
            name: body.name,
            status: body.status,
            settings: s
              ? {
                  allowedIps: s.allowed_ips,
                  allowedDomains: s.allowed_domains,
                  defaultCurrency: s.default_currency?.toUpperCase(),
                  captureMethod: s.capture_method,
                  retryPolicy: s.retry_policy ? { maxAttempts: s.retry_policy.max_attempts, retryOnSoftDecline: s.retry_policy.retry_on_soft_decline, retryOnTimeout: s.retry_policy.retry_on_timeout } : undefined,
                  statementDescriptor: s.statement_descriptor,
                }
              : undefined,
          },
          actorFromRequest(req),
        );
        return serializeProject(updated);
      });

      // ---------------------------------------------------------------- team
      m.get("/team", async (req) => {
        need(req, "team.read");
        return { data: (await listUsers(db, merchantId(req))).map(serializeUser), roles: MERCHANT_ROLES, assignable_roles: assignableRoles(me(req).user.role) };
      });
      m.post("/team/invite", async (req, reply) => {
        need(req, "team.manage");
        const body = parse(z.object({ email: z.string().email(), name: z.string().min(2).max(120), role: z.enum(MERCHANT_ROLES as [MerchantRole, ...MerchantRole[]]) }), req.body);
        if (!assignableRoles(me(req).user.role).includes(body.role)) throw Errors.forbidden(`You cannot assign the ${body.role} role`);
        const { user, inviteToken } = await inviteUser(db, { merchantId: merchantId(req), ...body, actor: actorFromRequest(req) });
        // No outbound email service is configured in the MVP: the invite link is returned once to the inviter.
        return reply.status(201).send({ user: serializeUser(user), invite_url: `${cfg.PUBLIC_WEB_URL}/dashboard/accept-invite?token=${inviteToken}`, note: "Share this link with the invitee. It expires in 7 days and is shown only once." });
      });
      m.patch<{ Params: { id: string } }>("/team/:id", async (req) => {
        need(req, "team.manage");
        const body = parse(z.object({ role: z.enum(MERCHANT_ROLES as [MerchantRole, ...MerchantRole[]]).optional(), status: z.enum(["active", "disabled"]).optional() }), req.body);
        if (req.params.id === me(req).user.id) throw Errors.forbidden("You cannot change your own role or status");
        if (body.role) {
          if (!assignableRoles(me(req).user.role).includes(body.role)) throw Errors.forbidden(`You cannot assign the ${body.role} role`);
          await updateUserRole(db, { merchantId: merchantId(req), userId: req.params.id, role: body.role, actor: actorFromRequest(req) });
        }
        if (body.status) await setUserStatus(db, { merchantId: merchantId(req), userId: req.params.id, status: body.status, actor: actorFromRequest(req) });
        return { ok: true };
      });

      // ---------------------------------------------------------------- api keys
      m.get("/api-keys", async (req) => {
        need(req, "api_keys.read");
        return { data: (await listApiKeys(db, merchantId(req))).map(publicApiKey) };
      });
      m.post("/api-keys", async (req, reply) => {
        need(req, "api_keys.manage");
        const body = parse(z.object({ project_id: z.string().optional(), mode: z.enum(["test", "live"]), name: z.string().min(1).max(80) }), req.body);
        const project = await projectOf(req, body.project_id);
        const { key, secret } = await createApiKey(db, { merchantId: merchantId(req), projectId: project.id, mode: body.mode, name: body.name, actor: actorFromRequest(req) });
        return reply.status(201).send({ ...publicApiKey(key), secret, note: "Store this key securely. It will not be shown again." });
      });
      m.delete<{ Params: { id: string } }>("/api-keys/:id", async (req) => {
        need(req, "api_keys.manage");
        return publicApiKey(await revokeApiKey(db, { merchantId: merchantId(req), keyId: req.params.id, actor: actorFromRequest(req) }));
      });

      // ---------------------------------------------------------------- webhooks
      const eventEnum = z.array(z.string()).max(30);
      m.get("/webhooks/endpoints", async (req) => {
        need(req, "webhooks.read");
        return { data: (await listEndpoints(db, merchantId(req), req.dashboardMode)).map(serializeEndpoint), event_types: WEBHOOK_EVENT_TYPES };
      });
      m.post("/webhooks/endpoints", async (req, reply) => {
        need(req, "webhooks.manage");
        const body = parse(z.object({ project_id: z.string().optional(), url: z.string().url().max(2000), description: z.string().max(200).optional(), events: eventEnum.default([]) }), req.body);
        const project = await projectOf(req, body.project_id);
        const { endpoint, secret } = await createEndpoint(db, { merchantId: merchantId(req), projectId: project.id, mode: req.dashboardMode, url: body.url, description: body.description, events: body.events, actor: actorFromRequest(req) });
        return reply.status(201).send({ ...serializeEndpoint(endpoint), secret, note: "Store the signing secret securely. It will not be shown again." });
      });
      m.patch<{ Params: { id: string } }>("/webhooks/endpoints/:id", async (req) => {
        need(req, "webhooks.manage");
        const body = parse(z.object({ url: z.string().url().max(2000).optional(), description: z.string().max(200).optional(), events: eventEnum.optional(), status: z.enum(["active", "disabled"]).optional() }), req.body);
        return serializeEndpoint(await updateEndpoint(db, { merchantId: merchantId(req), endpointId: req.params.id, ...body, actor: actorFromRequest(req) }));
      });
      m.delete<{ Params: { id: string } }>("/webhooks/endpoints/:id", async (req) => {
        need(req, "webhooks.manage");
        await deleteEndpoint(db, { merchantId: merchantId(req), endpointId: req.params.id, actor: actorFromRequest(req) });
        return { ok: true };
      });
      m.post<{ Params: { id: string } }>("/webhooks/endpoints/:id/rotate-secret", async (req) => {
        need(req, "webhooks.manage");
        const secret = await rotateEndpointSecret(db, { merchantId: merchantId(req), endpointId: req.params.id, actor: actorFromRequest(req) });
        return { secret, note: "Update your integration with the new secret. The old secret is no longer valid." };
      });
      m.post("/webhooks/test", async (req) => {
        need(req, "webhooks.manage");
        const body = parse(z.object({ project_id: z.string().optional(), event_type: z.string().default("payment.successful") }), req.body);
        const project = await projectOf(req, body.project_id);
        return sendTestEvent(db, { merchantId: merchantId(req), projectId: project.id, mode: req.dashboardMode }, body.event_type, actorFromRequest(req));
      });
      m.get("/webhooks/deliveries", async (req) => {
        need(req, "webhooks.read");
        const q = req.query as Record<string, string | undefined>;
        return listDeliveries(db, { merchantId: merchantId(req), mode: req.dashboardMode, endpointId: q.endpoint_id, status: q.status, eventType: q.event_type, limit: q.limit ? Number(q.limit) : undefined, cursor: q.cursor });
      });
      m.get<{ Params: { id: string } }>("/webhooks/deliveries/:id", async (req) => {
        need(req, "webhooks.read");
        const d = await getDeliveryDetail(db, req.params.id, { merchantId: merchantId(req) });
        if (!d) throw Errors.notFound("Webhook delivery", req.params.id);
        return d;
      });
      m.post<{ Params: { id: string } }>("/webhooks/deliveries/:id/resend", async (req) => {
        need(req, "webhooks.manage");
        await resendDelivery(db, { deliveryId: req.params.id, merchantId: merchantId(req), actor: actorFromRequest(req) });
        return { ok: true };
      });

      // ---------------------------------------------------------------- payments
      m.get("/payments", async (req) => {
        need(req, "payments.read");
        const q = parseQuery(listPaymentsQuerySchema.extend({ project_id: z.string().optional() }), req.query);
        return listPayments(db, {
          merchantId: merchantId(req),
          mode: req.dashboardMode,
          projectId: q.project_id,
          status: q.status,
          currency: q.currency,
          country: q.country,
          paymentMethod: q.payment_method,
          providerAccountId: q.provider_account_id,
          customerId: q.customer_id,
          reference: q.reference,
          search: q.search,
          from: dateOrUndefined(q.from),
          to: dateOrUndefined(q.to),
          limit: q.limit,
          cursor: q.cursor,
        });
      });
      m.post("/payments", async (req, reply) => {
        need(req, "payments.write");
        if (req.dashboardMode !== "test") throw Errors.forbidden("Payments can be created from the dashboard only in test mode. Use the API for live payments.");
        const body = parse(createPaymentObject.extend({ project_id: z.string().optional() }).superRefine(settlementRule), req.body);
        const project = await projectOf(req, body.project_id);
        const { project_id: _p, ...payload } = body;
        const payment = await createPayment(db, { merchantId: merchantId(req), projectId: project.id, mode: "test" }, payload, { actor: actorFromRequest(req), ip: req.ip });
        return reply.status(201).send((await getPaymentDetail(db, payment.id))!.serialized);
      });
      m.get("/payments/scenarios", async () => ({ data: Object.entries(TEST_SCENARIOS).map(([name, description]) => ({ name, description })) }));
      m.get<{ Params: { id: string } }>("/payments/:id", async (req) => {
        need(req, "payments.read");
        const detail = await getPaymentDetail(db, req.params.id, { merchantId: merchantId(req) });
        if (!detail) throw Errors.notFound("Payment", req.params.id);
        const [timeline, refunds, deliveries] = await Promise.all([
          getPaymentTimeline(db, req.params.id),
          listRefundsForPayment(db, req.params.id),
          listDeliveries(db, { merchantId: merchantId(req), limit: 50 }).then((r) => r.data.filter((x) => (x.payload as { data?: { object?: { id?: string } } })?.data?.object?.id === req.params.id)),
        ]);
        return { ...detail.serialized, timeline, refunds: refunds.map(serializeRefund), webhook_deliveries: deliveries };
      });
      const owned = async (req: FastifyRequest<{ Params: { id: string } }>) => {
        const p = await getPaymentRow(db, req.params.id);
        if (!p || p.merchantId !== merchantId(req)) throw Errors.notFound("Payment", req.params.id);
        return p;
      };
      m.post<{ Params: { id: string } }>("/payments/:id/capture", async (req) => {
        need(req, "payments.write");
        const body = parse(captureSchema, req.body);
        await capturePayment(db, await owned(req), body, actorFromRequest(req));
        return (await getPaymentDetail(db, req.params.id))!.serialized;
      });
      m.post<{ Params: { id: string } }>("/payments/:id/cancel", async (req) => {
        need(req, "payments.write");
        const body = parse(cancelSchema, req.body);
        await cancelPayment(db, await owned(req), body, actorFromRequest(req));
        return (await getPaymentDetail(db, req.params.id))!.serialized;
      });
      m.post<{ Params: { id: string } }>("/payments/:id/refund", async (req, reply) => {
        need(req, "refunds.create");
        const body = parse(refundSchema, req.body);
        const refund = await createRefund(db, await owned(req), body, actorFromRequest(req));
        return reply.status(201).send(serializeRefund(refund));
      });

      // ---------------------------------------------------------------- transactions
      m.get("/transactions", async (req) => {
        need(req, "transactions.read");
        const q = req.query as Record<string, string | undefined>;
        return listTransactions(db, {
          merchantId: merchantId(req),
          mode: req.dashboardMode,
          projectId: q.project_id,
          type: q.type,
          status: q.status,
          currency: q.currency,
          providerAccountId: q.provider_account_id,
          country: q.country,
          paymentMethodType: q.payment_method,
          search: q.search,
          from: dateOrUndefined(q.from),
          to: dateOrUndefined(q.to),
          limit: q.limit ? Number(q.limit) : undefined,
          cursor: q.cursor,
        });
      });

      // ---------------------------------------------------------------- payouts
      m.get("/payouts", async (req) => {
        need(req, "payouts.read");
        const q = req.query as Record<string, string | undefined>;
        return listPayouts(db, { merchantId: merchantId(req), mode: req.dashboardMode, status: q.status, currency: q.currency, search: q.search, from: dateOrUndefined(q.from), to: dateOrUndefined(q.to), limit: q.limit ? Number(q.limit) : undefined, cursor: q.cursor });
      });
      m.post("/payouts", async (req, reply) => {
        need(req, "payouts.create");
        const body = parse(createPayoutSchema.and(z.object({ project_id: z.string().optional() })), req.body);
        const project = await projectOf(req, body.project_id);
        const { project_id: _p, ...payload } = body;
        const payout = await createPayout(db, { merchantId: merchantId(req), projectId: project.id, mode: req.dashboardMode }, payload, { actor: actorFromRequest(req) });
        return reply.status(201).send(await getPayoutDetail(db, payout.id));
      });
      m.get<{ Params: { id: string } }>("/payouts/:id", async (req) => {
        need(req, "payouts.read");
        const p = await getPayoutDetail(db, req.params.id, { merchantId: merchantId(req) });
        if (!p) throw Errors.notFound("Payout", req.params.id);
        return p;
      });
      m.post<{ Params: { id: string } }>("/payouts/:id/cancel", async (req) => {
        need(req, "payouts.create");
        const p = await getPayout(db, req.params.id, { merchantId: merchantId(req) });
        if (!p) throw Errors.notFound("Payout", req.params.id);
        return serializePayout(await cancelPayout(db, p, actorFromRequest(req)));
      });

      // ---------------------------------------------------------------- settlements & balances
      m.get("/settlements", async (req) => {
        need(req, "settlements.read");
        const q = req.query as Record<string, string | undefined>;
        return { data: await listSettlements(db, { merchantId: merchantId(req), mode: req.dashboardMode, status: q.status, providerAccountId: q.provider_account_id, limit: q.limit ? Number(q.limit) : undefined }) };
      });
      m.get<{ Params: { id: string } }>("/settlements/:id", async (req) => {
        need(req, "settlements.read");
        const s = await getSettlementDetail(db, req.params.id, { merchantId: merchantId(req) });
        if (!s) throw Errors.notFound("Settlement", req.params.id);
        return s;
      });
      m.get("/balances", async (req) => {
        need(req, "settlements.read");
        return { custodian: false, data: await balances(db, { merchantId: merchantId(req), mode: req.dashboardMode }) };
      });

      // ---------------------------------------------------------------- reconciliation
      m.get("/reconciliation/batches", async (req) => {
        need(req, "reconciliation.read");
        return { data: await listBatches(db, { merchantId: merchantId(req), mode: req.dashboardMode }) };
      });
      m.get<{ Params: { id: string } }>("/reconciliation/batches/:id", async (req) => {
        need(req, "reconciliation.read");
        const q = req.query as Record<string, string | undefined>;
        const b = await getBatchDetail(db, req.params.id, { merchantId: merchantId(req) }, { status: q.status });
        if (!b) throw Errors.notFound("Reconciliation batch", req.params.id);
        return b;
      });
      m.post("/reconciliation/upload", async (req, reply) => {
        need(req, "reconciliation.manage");
        const file = await req.file();
        if (!file) throw Errors.badRequest("file_required", "Upload a CSV file in the `file` field");
        const fields = file.fields as Record<string, { value?: string } | undefined>;
        const providerAccountId = fields.provider_account_id?.value;
        if (!providerAccountId) throw Errors.badRequest("provider_account_required", "provider_account_id is required", "provider_account_id");
        await assertProviderAccountVisible(db, providerAccountId, merchantId(req));
        const text = (await file.toBuffer()).toString("utf8");
        const rows = parseProviderCsv(text);
        const batch = await runReconciliation(db, {
          merchantId: merchantId(req),
          mode: req.dashboardMode,
          providerAccountId,
          source: "csv",
          fileName: file.filename,
          rows,
          periodStart: dateOrUndefined(fields.period_start?.value),
          periodEnd: dateOrUndefined(fields.period_end?.value),
          actor: actorFromRequest(req),
        });
        return reply.status(201).send(await getBatchDetail(db, batch.id));
      });
      m.get<{ Params: { accountId: string } }>("/reconciliation/sandbox-report/:accountId", async (req, reply) => {
        need(req, "reconciliation.read");
        if (req.dashboardMode !== "test") throw Errors.forbidden("Sandbox reports exist only for test-mode demo providers");
        await assertProviderAccountVisible(db, req.params.accountId, merchantId(req));
        // Scoped to this merchant: a shared demo provider account also carries other merchants' traffic.
        const { csv } = await sandboxProviderReport(db, req.params.accountId, { merchantId: merchantId(req) });
        reply.header("content-type", "text/csv; charset=utf-8");
        reply.header("content-disposition", `attachment; filename="provider-report-${req.params.accountId}.csv"`);
        return reply.send(csv);
      });

      // ---------------------------------------------------------------- analytics
      const scope = (req: FastifyRequest) => {
        const q = req.query as Record<string, string | undefined>;
        const { from, to } = periodFromQuery(q, 7);
        const defaultCurrency = me(req).merchant.settings.defaultCurrency;
        return { merchantId: merchantId(req), mode: req.dashboardMode, from, to, currency: (q.currency ?? defaultCurrency)?.toUpperCase() };
      };
      m.get("/analytics/overview", async (req) => {
        need(req, "analytics.read");
        return overview(db, scope(req));
      });
      m.get("/analytics/timeseries", async (req) => {
        need(req, "analytics.read");
        const q = req.query as Record<string, string | undefined>;
        return timeseries(db, scope(req), q.bucket === "hour" ? "hour" : "day");
      });
      m.get("/analytics/breakdowns", async (req) => {
        need(req, "analytics.read");
        return breakdowns(db, scope(req));
      });
      m.get("/analytics/providers", async (req) => {
        need(req, "analytics.read");
        return providerComparison(db, scope(req));
      });

      // ---------------------------------------------------------------- providers, routing (read-only), status, audit
      m.get("/providers", async (req) => ({ data: await listProvidersWithAccounts(db, { mode: req.dashboardMode, merchantId: merchantId(req) }) }));
      m.get("/routing/rules", async (req) => ({ data: await listRulesAdmin(db, { mode: req.dashboardMode, merchantId: merchantId(req) }) }));
      m.get("/status", async (req) => {
        const providers = await listProvidersWithAccounts(db, { mode: req.dashboardMode, merchantId: merchantId(req) });
        const health = await providerHealth(db, 1);
        return {
          api: "operational",
          queue_driver: cfg.QUEUE_DRIVER,
          providers: providers.flatMap((p) =>
            p.accounts.map((a) => ({ provider: p.name, account: a.name, status: p.status === "active" && a.status === "active" ? "active" : "disabled", health_1h: health.find((h) => h.provider_account_id === a.id) ?? null, health_24h: a.health })),
          ),
        };
      });
      m.get("/audit", async (req) => {
        need(req, "audit.read");
        const q = req.query as Record<string, string | undefined>;
        const rows = await listAudit(db, { merchantId: merchantId(req), action: q.action, entityId: q.entity_id, limit: q.limit ? Number(q.limit) : undefined, before: dateOrUndefined(q.before) });
        return { data: rows.map((r) => ({ id: r.id, actor_type: r.actorType, actor_label: r.actorLabel, action: r.action, entity_type: r.entityType, entity_id: r.entityId, before: r.before, after: r.after, ip: r.ip, created_at: r.createdAt })) };
      });
    });
  }, { prefix: "/dashboard" });
}
