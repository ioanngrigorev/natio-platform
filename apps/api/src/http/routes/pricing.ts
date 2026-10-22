import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { providerAccounts } from "../../db/schema/index.js";
import { requireAdmin } from "../guards.js";
import { parse } from "../validate.js";
import { Errors } from "../../lib/errors.js";
import { actorFromRequest } from "../context.js";
import {
  changePrice,
  createPrice,
  listPrices,
  loadPrices,
} from "../../modules/pricing/service.js";
import { quotePricing } from "../../modules/pricing/engine.js";
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const priceTermsSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    side: z.enum(["merchant", "provider"]),
    currency: z.string().regex(/^[A-Z]{3}$/),
    merchantId: z.string().max(100).nullable().default(null),
    providerAccountId: z.string().max(100).nullable().default(null),
    paymentMethod: z
      .enum([
        "card",
        "bank_transfer",
        "qr",
        "open_banking",
        "wallet",
        "instant",
        "local",
        "crypto",
      ])
      .nullable()
      .default(null),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable()
      .default(null),
    priority: z.number().int().min(0).max(10000).default(100),
    validFrom: z.string().datetime(),
    validUntil: z.string().datetime().nullable().default(null),
    tiers: z
      .array(
        z.object({
          from: minor,
          to: minor.nullable(),
          rateBps: z.number().int().min(0).max(10000),
          fixed: minor,
          minimum: minor.default(0),
          maximum: minor.nullable().default(null),
        }),
      )
      .min(1)
      .max(20),
  })
  .strict();
export async function registerPricingRoutes(app: FastifyInstance) {
  const db = getDb();
  app.get("/admin/pricing", { preHandler: requireAdmin() }, async (req) => ({
    data: await listPrices(db, req.dashboardMode!),
  }));
  app.post(
    "/admin/pricing",
    { preHandler: requireAdmin("providers.manage") },
    async (req, reply) => {
      const body = parse(
        z.object({ terms: priceTermsSchema, cloneId: z.string().optional() }),
        req.body,
      );
      return reply
        .code(201)
        .send(
          await createPrice(
            db,
            req.dashboardMode!,
            body.terms,
            actorFromRequest(req),
            body.cloneId,
          ),
        );
    },
  );
  app.patch(
    "/admin/pricing/:id",
    { preHandler: requireAdmin("providers.manage") },
    async (req) => {
      const { id } = parse(z.object({ id: z.string().max(100) }), req.params);
      const b = parse(
        z
          .object({
            version: z.number().int().positive(),
            terms: priceTermsSchema.optional(),
            action: z.enum(["publish", "retire"]).optional(),
            replacePrevious: z.boolean().optional(),
          })
          .refine((v) => v.terms || v.action, "Provide terms or an action"),
        req.body,
      );
      return changePrice(
        db,
        req.dashboardMode!,
        id,
        b.version,
        b,
        actorFromRequest(req),
      );
    },
  );
  app.post(
    "/admin/pricing/quote",
    { preHandler: requireAdmin() },
    async (req) => {
      const b = parse(
        z.object({
          merchantId: z.string(),
          providerAccountId: z.string(),
          amount: minor.positive(),
          currency: z.string().regex(/^[A-Z]{3}$/),
          paymentMethod: z.string().max(30),
          country: z.string().length(2).optional(),
          at: z.string().datetime().optional(),
          curve: z.array(minor.positive()).max(30).optional(),
        }),
        req.body,
      );
      const [account] = await db
        .select()
        .from(providerAccounts)
        .where(
          and(
            eq(providerAccounts.id, b.providerAccountId),
            eq(providerAccounts.mode, req.dashboardMode!),
          ),
        );
      if (
        !account ||
        (account.merchantId && account.merchantId !== b.merchantId)
      )
        throw Errors.notFound("Eligible provider account");
      try {
        const plans = await loadPrices(db, req.dashboardMode!);
        const ctx = {
          ...b,
          mode: req.dashboardMode!,
          at: b.at ? new Date(b.at) : new Date(),
        };
        return {
          ...quotePricing(plans, ctx, account),
          curve: (b.curve ?? []).map((amount) =>
            quotePricing(plans, { ...ctx, amount }, account),
          ),
        };
      } catch (e) {
        throw Errors.validation((e as Error).message);
      }
    },
  );
}
