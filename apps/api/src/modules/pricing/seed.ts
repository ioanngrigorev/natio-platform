/** Opt-in synthetic configuration only. Does not create or update financial records. */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  pricingPlans,
  providerAccounts,
  providers,
  routingRules,
} from "../../db/schema/index.js";
import { createRule } from "../routing/service.js";
import { recordAudit } from "../audit/service.js";
import { changePrice, createPrice } from "./service.js";
import type { PriceTerms, PriceTier } from "./engine.js";
const actor = {
  type: "system" as const,
  id: "synthetic-routing-pricing-demo-v1",
};
export async function seedPricingDemo(db: Db) {
  // Imported demo catalogs can contain only merchant-owned accounts. Reuse existing
  // mock providers for shared sandbox routes without widening any real integration.
  const [shared] = await db.select({ id: providerAccounts.id }).from(providerAccounts)
    .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
    .where(and(eq(providerAccounts.mode, "test"), isNull(providerAccounts.merchantId),
      eq(providerAccounts.status, "active"), eq(providers.status, "active"),
      sql`${providers.supportedMethods} ? 'card'`, sql`${providers.supportedCurrencies} ? 'EUR'`,
      sql`(${providerAccounts.currencies} = '[]'::jsonb or ${providerAccounts.currencies} ? 'EUR')`)).limit(1);
  let accountsCreated = 0;
  if (!shared) {
    const mockProviders = await db.select().from(providers).where(and(
      eq(providers.adapterKey, "mock_acquirer"), eq(providers.status, "active"),
      sql`${providers.supportedMethods} ? 'card'`, sql`${providers.supportedCurrencies} ? 'EUR'`,
      sql`(${providers.supportedCountries} = '[]'::jsonb or ${providers.supportedCountries} ? 'DE')`,
    )).orderBy(providers.id).limit(3);
    for (const [i, provider] of mockProviders.entries()) {
      const [created] = await db.insert(providerAccounts).values({
        id: `pa_routing_demo_${provider.id}`, providerId: provider.id, merchantId: null,
        mode: "test", name: `NATIO ${["Cedar", "Lumen", "Orbit"][i]} · EUR sandbox`,
        priority: i, currencies: ["EUR"], feePercent: "1.5000", feeFixedMinor: 10,
        config: { simulation: { latencyMs: 40 + i * 20, technicalErrorRate: 0 } },
        limits: { minAmount: 1, maxAmount: 100000000 },
      }).onConflictDoNothing().returning({ id: providerAccounts.id });
      if (created) {
        accountsCreated++;
        await recordAudit(db, { actor, action: "provider_account.demo_created", entityType: "provider_account", entityId: created.id, after: { mode: "test", providerId: provider.id, synthetic: true } });
      }
    }
  }
  const existing = await db
    .select()
    .from(pricingPlans)
    .where(eq(pricingPlans.mode, "test"));
  let prices = 0,
    rules = 0;
  const tiers = (
    rate: number,
    lowFixed: number,
    highRate: number,
    scale: number,
  ): PriceTier[] => [
    {
      from: 0,
      to: 100 * scale,
      rateBps: rate,
      fixed: lowFixed,
      minimum: 0,
      maximum: null,
    },
    {
      from: 100 * scale,
      to: 1000 * scale,
      rateBps: highRate,
      fixed: Math.floor(lowFixed / 2),
      minimum: 0,
      maximum: null,
    },
    {
      from: 1000 * scale,
      to: null,
      rateBps: Math.max(10, highRate - 25),
      fixed: 0,
      minimum: 0,
      maximum: null,
    },
  ];
  async function price(
    name: string,
    side: "merchant" | "provider",
    currency: string,
    t: PriceTier[],
    account: string | null = null,
  ) {
    if (existing.some((p) => p.terms.name === name)) return;
    const terms: PriceTerms = {
      name,
      side,
      currency,
      merchantId: null,
      providerAccountId: account,
      paymentMethod: null,
      country: null,
      priority: 100,
      validFrom: "2025-01-01T00:00:00Z",
      validUntil: null,
      tiers: t,
    };
    const p = await createPrice(db, "test", terms, actor);
    await changePrice(
      db,
      "test",
      p.id,
      p.version,
      { action: "publish" },
      actor,
    );
    prices++;
  }
  for (const currency of ["EUR", "USD", "GBP", "JPY", "INR", "VND"]) {
    const scale = ["JPY", "VND"].includes(currency) ? 1 : 100;
    await price(
      `NATIO ${currency} · Merchant Growth`,
      "merchant",
      currency,
      tiers(290, Math.round(scale * 0.2), 240, scale),
    );
    await price(
      `NATIO ${currency} · PSP Core`,
      "provider",
      currency,
      tiers(150, Math.round(scale * 0.1), 115, scale),
    );
  }
  const accounts = await db
    .select({ account: providerAccounts, provider: providers })
    .from(providerAccounts)
    .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
    .where(
      and(
        eq(providerAccounts.mode, "test"),
        eq(providerAccounts.status, "active"),
        sql`${providers.supportedMethods} ? 'card'`,
      ),
    )
    .orderBy(providerAccounts.priority)
    .limit(500);
  const eur = accounts
    .filter(
      (c) =>
        (c.account.currencies.length
          ? c.account.currencies
          : c.provider.supportedCurrencies
        ).includes("EUR") && !c.account.merchantId,
    )
    .slice(0, 3);
  for (const [i, c] of eur.entries())
    await price(
      `NATIO EUR · PSP ${["Cedar", "Lumen", "Orbit"][i]}`,
      "provider",
      "EUR",
      tiers([110, 165, 190][i]!, [12, 4, 0][i]!, [135, 90, 70][i]!, 100),
      c.account.id,
    );
  const existingRules = await db
    .select({ name: routingRules.name })
    .from(routingRules)
    .where(eq(routingRules.mode, "test"));
  for (const currency of ["EUR", "USD"]) {
    for (const high of [false, true]) {
      const name = `NATIO · ${currency} cards · ${high ? "Large ticket cost" : "Balanced growth"}`;
      if (existingRules.some((r) => r.name === name)) continue;
      await createRule(
        db,
        {
          name,
          description:
            "Synthetic demo policy. Currency and amount eligibility first; only proven-safe failures may cascade.",
          mode: "test",
          priority: 0,
          enabled: true,
          transactionType: "payment",
          conditions: [
            { field: "currency", op: "eq", value: currency },
            { field: "payment_method", op: "eq", value: "card" },
            { field: "amount", op: high ? "gte" : "lt", value: 100000 },
          ],
          strategy: "score",
          routes: [],
          policy: {
            profile: high ? "cost" : "balanced",
            maxAttempts: 2,
            maxElapsedMs: 30000,
            retryOnSoftDecline: true,
            retryOnTimeout: true,
            minSamples: 20,
            minUptime: 0.97,
            blockNegativeMargin: true,
          },
        },
        actor,
      );
      rules++;
    }
  }
  if (eur.length) {
    for (const strategy of ["ordered", "weighted"] as const) {
      const name = `NATIO · EUR · ${strategy} allocation template`;
      if (existingRules.some((r) => r.name === name)) continue;
      await createRule(
        db,
        {
          name,
          description:
            "Disabled example. Review scope and simulation before activation.",
          mode: "test",
          priority: 5,
          enabled: false,
          transactionType: "payment",
          conditions: [
            { field: "currency", op: "eq", value: "EUR" },
            { field: "payment_method", op: "eq", value: "card" },
          ],
          strategy,
          routes: eur.map((c, i) => ({
            providerAccountId: c.account.id,
            weight: [60, 30, 10][i],
          })),
          policy: { profile: "balanced", maxAttempts: 2, maxElapsedMs: 30000 },
        },
        actor,
      );
      rules++;
    }
  }
  return {
    synthetic: true,
    mode: "test",
    tariffsCreated: prices,
    rulesCreated: rules,
    accountsCreated,
    financialRecordsCreated: 0,
  };
}
