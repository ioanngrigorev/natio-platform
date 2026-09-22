/**
 * NATIO Universal Payment API — /v1
 * Auth: Authorization: Bearer natio_sk_test_... | natio_sk_live_...
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { Errors } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { paymentMethods } from "../../db/schema/index.js";
import { and, eq } from "drizzle-orm";
import { withIdempotency } from "../../modules/idempotency/service.js";
import { cancelSchema, captureSchema, createPaymentSchema, hasUnmaskedDigits, listPaymentsQuerySchema, looksLikeAccountNumber, paymentMethodTypeSchema, refundSchema, customerInputSchema } from "../../modules/payments/schemas.js";
import { cancelPayment, capturePayment, createPayment, getPaymentDetail, getPaymentRow, getPaymentTimeline, listPayments } from "../../modules/payments/service.js";
import { serializePayment } from "../../modules/payments/serialize.js";
import { createRefund, getRefund, listRefundsForPayment, serializeRefund } from "../../modules/refunds/service.js";
import { cancelPayout, createPayout, createPayoutSchema, getPayout, getPayoutDetail, listPayouts, serializePayout } from "../../modules/payouts/service.js";
import { listTransactions } from "../../modules/transactions/service.js";
import { balances, listSettlements, getSettlementDetail } from "../../modules/settlements/service.js";
import { sendTestEvent } from "../../modules/webhooks/service.js";
import { recordAudit } from "../../modules/audit/service.js";
import { TEST_SCENARIOS } from "../../modules/payments/scenarios.js";
import { actorFromRequest } from "../context.js";
import { requireApiKey } from "../guards.js";
import { dateOrUndefined, idempotencyKeyOf } from "../helpers.js";
import { parse, parseQuery } from "../validate.js";

export async function registerV1Routes(app: FastifyInstance) {
  const db = getDb();

  await app.register(async (v1) => {
    v1.addHook("preHandler", requireApiKey);
    // Rate limiting for /v1 (RATE_LIMIT_API_PER_MINUTE, own bucket) is applied by the global
    // limiter in server.ts. An onRoute hook here would run after @fastify/rate-limit has already
    // read route.config, so it would be silently ignored.

    const scopeOf = (req: { apiKey?: { merchant: { id: string }; project: { id: string }; mode: "test" | "live" } }) => ({
      merchantId: req.apiKey!.merchant.id,
      projectId: req.apiKey!.project.id,
      mode: req.apiKey!.mode,
    });

    // ------------------------------------------------------------------ payments
    v1.post("/payments", async (req, reply) => {
      const body = parse(createPaymentSchema, req.body);
      const scope = scopeOf(req);
      if (scope.mode === "live" && body.test_scenario) throw Errors.badRequest("test_scenario_not_allowed", "test_scenario is only accepted with test API keys", "test_scenario");
      const actor = actorFromRequest(req);
      const result = await withIdempotency(db, { ...scope, scope: "payments.create" }, idempotencyKeyOf(req), body, async () => {
        const payment = await createPayment(db, scope, body, { actor, ip: req.ip, userAgent: String(req.headers["user-agent"] ?? ""), idempotencyKey: idempotencyKeyOf(req) });
        const detail = await getPaymentDetail(db, payment.id);
        return { status: 201, body: detail!.serialized };
      });
      if (result.replayed) reply.header("idempotent-replayed", "true");
      return reply.status(result.status).send(result.body);
    });

    v1.get("/payments", async (req) => {
      const q = parseQuery(listPaymentsQuerySchema, req.query);
      const scope = scopeOf(req);
      return listPayments(db, {
        merchantId: scope.merchantId,
        mode: scope.mode,
        projectId: scope.projectId,
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

    v1.get<{ Params: { id: string } }>("/payments/:id", async (req) => {
      const scope = scopeOf(req);
      const detail = await getPaymentDetail(db, req.params.id, { merchantId: scope.merchantId, mode: scope.mode });
      if (!detail || detail.row.projectId !== scope.projectId) throw Errors.notFound("Payment", req.params.id);
      return detail.serialized;
    });

    v1.get<{ Params: { id: string } }>("/payments/:id/timeline", async (req) => {
      const scope = scopeOf(req);
      const p = await getPaymentRow(db, req.params.id);
      if (!p || p.merchantId !== scope.merchantId || p.mode !== scope.mode) throw Errors.notFound("Payment", req.params.id);
      return { payment_id: p.id, data: await getPaymentTimeline(db, p.id) };
    });

    async function ownedPayment(req: { params: { id: string }; apiKey?: { merchant: { id: string }; project: { id: string }; mode: "test" | "live" } }) {
      const scope = scopeOf(req);
      const p = await getPaymentRow(db, req.params.id);
      if (!p || p.merchantId !== scope.merchantId || p.projectId !== scope.projectId || p.mode !== scope.mode) throw Errors.notFound("Payment", req.params.id);
      return { p, scope };
    }

    v1.post<{ Params: { id: string } }>("/payments/:id/capture", async (req, reply) => {
      const body = parse(captureSchema, req.body);
      const { p, scope } = await ownedPayment(req);
      const result = await withIdempotency(db, { ...scope, scope: `payments.capture.${p.id}` }, idempotencyKeyOf(req), body, async () => {
        await capturePayment(db, p, body, actorFromRequest(req));
        return { status: 200, body: (await getPaymentDetail(db, p.id))!.serialized };
      });
      if (result.replayed) reply.header("idempotent-replayed", "true");
      return reply.status(result.status).send(result.body);
    });

    v1.post<{ Params: { id: string } }>("/payments/:id/cancel", async (req, reply) => {
      const body = parse(cancelSchema, req.body);
      const { p, scope } = await ownedPayment(req);
      const result = await withIdempotency(db, { ...scope, scope: `payments.cancel.${p.id}` }, idempotencyKeyOf(req), body, async () => {
        await cancelPayment(db, p, body, actorFromRequest(req));
        return { status: 200, body: (await getPaymentDetail(db, p.id))!.serialized };
      });
      if (result.replayed) reply.header("idempotent-replayed", "true");
      return reply.status(result.status).send(result.body);
    });

    v1.post<{ Params: { id: string } }>("/payments/:id/refund", async (req, reply) => {
      const body = parse(refundSchema, req.body);
      const { p, scope } = await ownedPayment(req);
      const result = await withIdempotency(db, { ...scope, scope: "refunds.create" }, idempotencyKeyOf(req), { payment_id: p.id, ...body }, async () => {
        const refund = await createRefund(db, p, { ...body, idempotencyKey: idempotencyKeyOf(req) }, actorFromRequest(req));
        return { status: 201, body: serializeRefund(refund) };
      });
      if (result.replayed) reply.header("idempotent-replayed", "true");
      return reply.status(result.status).send(result.body);
    });

    v1.get<{ Params: { id: string } }>("/payments/:id/refunds", async (req) => {
      const { p } = await ownedPayment(req);
      return { data: (await listRefundsForPayment(db, p.id)).map(serializeRefund) };
    });

    v1.get<{ Params: { id: string } }>("/refunds/:id", async (req) => {
      const scope = scopeOf(req);
      const r = await getRefund(db, req.params.id, { merchantId: scope.merchantId });
      if (!r || r.mode !== scope.mode) throw Errors.notFound("Refund", req.params.id);
      return serializeRefund(r);
    });

    // ------------------------------------------------------------------ payouts
    v1.post("/payouts", async (req, reply) => {
      const body = parse(createPayoutSchema, req.body);
      const scope = scopeOf(req);
      const result = await withIdempotency(db, { ...scope, scope: "payouts.create" }, idempotencyKeyOf(req), body, async () => {
        const payout = await createPayout(db, scope, body, { actor: actorFromRequest(req), idempotencyKey: idempotencyKeyOf(req) });
        return { status: 201, body: (await getPayoutDetail(db, payout.id))! };
      });
      if (result.replayed) reply.header("idempotent-replayed", "true");
      return reply.status(result.status).send(result.body);
    });

    v1.get("/payouts", async (req) => {
      const q = req.query as Record<string, string | undefined>;
      const scope = scopeOf(req);
      return listPayouts(db, { merchantId: scope.merchantId, mode: scope.mode, status: q.status, currency: q.currency, search: q.search, from: dateOrUndefined(q.from), to: dateOrUndefined(q.to), limit: q.limit ? Number(q.limit) : undefined, cursor: q.cursor });
    });

    v1.get<{ Params: { id: string } }>("/payouts/:id", async (req) => {
      const scope = scopeOf(req);
      const detail = await getPayoutDetail(db, req.params.id, { merchantId: scope.merchantId });
      if (!detail || detail.mode !== scope.mode) throw Errors.notFound("Payout", req.params.id);
      return detail;
    });

    v1.post<{ Params: { id: string } }>("/payouts/:id/cancel", async (req) => {
      const scope = scopeOf(req);
      const p = await getPayout(db, req.params.id, { merchantId: scope.merchantId });
      if (!p || p.mode !== scope.mode) throw Errors.notFound("Payout", req.params.id);
      const updated = await cancelPayout(db, p, actorFromRequest(req));
      return serializePayout(updated);
    });

    // ------------------------------------------------------------------ transactions / balances / settlements
    v1.get("/transactions", async (req) => {
      const q = req.query as Record<string, string | undefined>;
      const scope = scopeOf(req);
      return listTransactions(db, {
        merchantId: scope.merchantId,
        mode: scope.mode,
        projectId: scope.projectId,
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

    v1.get("/balances", async (req) => {
      const scope = scopeOf(req);
      return { object: "list", custodian: false, data: await balances(db, scope) };
    });

    v1.get("/settlements", async (req) => {
      const q = req.query as Record<string, string | undefined>;
      const scope = scopeOf(req);
      return { object: "list", data: await listSettlements(db, { merchantId: scope.merchantId, mode: scope.mode, status: q.status, providerAccountId: q.provider_account_id, limit: q.limit ? Number(q.limit) : undefined }) };
    });

    v1.get<{ Params: { id: string } }>("/settlements/:id", async (req) => {
      const scope = scopeOf(req);
      const s = await getSettlementDetail(db, req.params.id, { merchantId: scope.merchantId });
      if (!s || s.mode !== scope.mode) throw Errors.notFound("Settlement", req.params.id);
      return s;
    });

    // ------------------------------------------------------------------ payment methods (token references only)
    const createPaymentMethodSchema = z
      .object({
        type: paymentMethodTypeSchema,
        provider_token: z.string().min(4).max(255),
        provider_code: z.string().max(64).optional(),
        customer: customerInputSchema.optional(),
        display: z.record(z.string().max(64)).optional(),
      })
      .strict()
      .refine((v) => !looksLikeAccountNumber(v.provider_token), { message: "provider_token must be a provider token, never a card or account number", path: ["provider_token"] })
      .refine((v) => !v.display || Object.values(v.display).every((d) => !hasUnmaskedDigits(d, 6)), { message: "display values must be masked", path: ["display"] });

    v1.post("/payment-methods", async (req, reply) => {
      const body = parse(createPaymentMethodSchema, req.body);
      const scope = scopeOf(req);
      const id = newId("paymentMethod");
      await db.insert(paymentMethods).values({
        id,
        merchantId: scope.merchantId,
        projectId: scope.projectId,
        mode: scope.mode,
        customerId: body.customer?.id ?? null,
        type: body.type,
        providerId: body.provider_code ?? null,
        providerToken: body.provider_token,
        display: body.display ?? {},
      });
      await recordAudit(db, { actor: actorFromRequest(req), merchantId: scope.merchantId, action: "payment_method.created", entityType: "payment_method", entityId: id, after: { type: body.type, display: body.display } });
      const [pm] = await db.select().from(paymentMethods).where(eq(paymentMethods.id, id)).limit(1);
      return reply.status(201).send({ id: pm!.id, object: "payment_method", type: pm!.type, customer_id: pm!.customerId, display: pm!.display, status: pm!.status, created_at: pm!.createdAt });
    });

    v1.get<{ Params: { id: string } }>("/payment-methods/:id", async (req) => {
      const scope = scopeOf(req);
      const [pm] = await db
        .select()
        .from(paymentMethods)
        .where(and(eq(paymentMethods.id, req.params.id), eq(paymentMethods.merchantId, scope.merchantId), eq(paymentMethods.mode, scope.mode)))
        .limit(1);
      if (!pm) throw Errors.notFound("Payment method", req.params.id);
      return { id: pm.id, object: "payment_method", type: pm.type, customer_id: pm.customerId, display: pm.display, status: pm.status, created_at: pm.createdAt };
    });

    // ------------------------------------------------------------------ webhooks
    v1.post("/webhooks/test", async (req) => {
      const body = parse(z.object({ event_type: z.string().default("payment.successful") }), req.body);
      const scope = scopeOf(req);
      return sendTestEvent(db, scope, body.event_type, actorFromRequest(req));
    });

    // ------------------------------------------------------------------ sandbox helpers
    v1.get("/test/scenarios", async (req) => {
      if (scopeOf(req).mode !== "test") throw Errors.forbidden("Only available with test API keys");
      return { data: Object.entries(TEST_SCENARIOS).map(([name, description]) => ({ name, description })) };
    });

    v1.get("/me", async (req) => {
      const k = req.apiKey!;
      return { merchant: { id: k.merchant.id, name: k.merchant.name }, project: { id: k.project.id, name: k.project.name }, mode: k.mode, api_key: { id: k.apiKey.id, prefix: k.apiKey.prefix, name: k.apiKey.name } };
    });
  }, { prefix: "/v1" });

  void serializePayment;
}
