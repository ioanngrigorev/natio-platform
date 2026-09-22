/**
 * Sandbox seed: admin users, demo providers/accounts, routing & risk rules, a demo merchant
 * with a test API key. Optional demo traffic (real orchestration runs) with `--demo-traffic`.
 *
 * Idempotent: base entities are created only when missing.
 */
import { eq, sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { closeDb, getDb, type Db } from "./client.js";
import {
  adminUsers,
  apiKeys,
  merchantUsers,
  merchants,
  payments,
  projects,
  providerAccounts,
  providerRoutes,
  providers,
  riskRules,
  routingRules,
} from "./schema/index.js";
import { encryptJson, generateApiKey, hashPassword } from "../lib/crypto.js";
import { newId, randomString } from "../lib/ids.js";
import { logger } from "../lib/logger.js";
import { SUPPORTED_CURRENCIES } from "../lib/money.js";
import { createPayment } from "../modules/payments/service.js";
import { drainQueues } from "../lib/queue.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export interface SeedResult {
  adminEmail: string;
  merchantEmail: string;
  password: string;
  testApiKey?: string;
  merchantId: string;
  projectId: string;
}

async function ensureAdmins(db: Db, password: string, adminEmail: string) {
  const existing = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, adminEmail)).limit(1);
  if (existing.length) return;
  const hash = await hashPassword(password);
  await db.insert(adminUsers).values([
    { id: newId("adminUser"), email: adminEmail, name: "NATIO Superadmin", passwordHash: hash, role: "superadmin" },
    { id: newId("adminUser"), email: "ops@natio.local", name: "Operations", passwordHash: hash, role: "operations" },
    { id: newId("adminUser"), email: "support@natio.local", name: "Support", passwordHash: hash, role: "support" },
  ]);
  logger.info({ adminEmail }, "seed: admin users created");
}

async function ensureProviders(db: Db, encKey: string) {
  const existing = await db.select().from(providers);
  if (existing.length) {
    const accounts = await db.select().from(providerAccounts);
    return { providers: existing, accounts };
  }
  const allCurrencies = [...SUPPORTED_CURRENCIES];
  const asiaLatam = ["VND", "THB", "IDR", "PHP", "MYR", "SGD", "INR", "BRL", "MXN"];
  const provs = await db
    .insert(providers)
    .values([
      {
        id: newId("provider"),
        code: "demo_acquirer_a",
        name: "NATIO Demo Acquirer A",
        type: "acquirer",
        adapterKey: "mock_acquirer",
        supportedMethods: ["card", "bank_transfer", "wallet", "open_banking"],
        supportedCurrencies: allCurrencies,
        supportedCountries: [],
        capabilities: { payments: true, refunds: true, capture: true, payouts: false, hostedPage: true, tokenization: true },
        settlementEntity: "NATIO Demo Acquirer A (sandbox entity)",
        description: "Simulated card acquirer. Sandbox only — no real funds move.",
      },
      {
        id: newId("provider"),
        code: "demo_acquirer_b",
        name: "NATIO Demo Acquirer B",
        type: "psp",
        adapterKey: "mock_acquirer",
        supportedMethods: ["card", "bank_transfer", "wallet", "instant"],
        supportedCurrencies: allCurrencies,
        supportedCountries: [],
        capabilities: { payments: true, refunds: true, capture: true, payouts: true, hostedPage: true, tokenization: true },
        settlementEntity: "NATIO Demo Acquirer B (sandbox entity)",
        description: "Simulated PSP with payout capability. Sandbox only.",
      },
      {
        id: newId("provider"),
        code: "demo_qr",
        name: "NATIO Demo QR Provider",
        type: "qr",
        adapterKey: "mock_qr",
        supportedMethods: ["qr", "instant", "local"],
        supportedCurrencies: asiaLatam,
        supportedCountries: ["VN", "TH", "ID", "PH", "MY", "SG", "IN", "BR", "MX"],
        capabilities: { payments: true, refunds: true, capture: false, payouts: false },
        settlementEntity: "NATIO Demo QR Provider (sandbox entity)",
        description: "Simulated local QR / instant payment network with asynchronous confirmation.",
      },
    ])
    .returning();
  const byCode = Object.fromEntries(provs.map((p) => [p.code, p]));
  const cred = () => encryptJson({ apiKey: `demo_${randomString(24)}`, webhookSecret: `demo_whsec_${randomString(32)}` }, encKey);
  const accounts = await db
    .insert(providerAccounts)
    .values([
      { id: newId("providerAccount"), providerId: byCode.demo_acquirer_a!.id, mode: "test", name: "Acquirer A · Test", priority: 10, feePercent: "2.4", feeFixedMinor: 20, credentialsEnc: cred(), config: { simulation: { latencyMs: 45 } }, limits: { maxAmount: 2_000_000 } },
      { id: newId("providerAccount"), providerId: byCode.demo_acquirer_b!.id, mode: "test", name: "Acquirer B · Test", priority: 20, feePercent: "2.9", feeFixedMinor: 30, credentialsEnc: cred(), config: { simulation: { latencyMs: 80 } }, limits: {} },
      { id: newId("providerAccount"), providerId: byCode.demo_qr!.id, mode: "test", name: "QR Provider · Test", priority: 30, feePercent: "1.2", feeFixedMinor: 0, credentialsEnc: cred(), config: { simulation: { latencyMs: 60 } }, limits: {} },
      { id: newId("providerAccount"), providerId: byCode.demo_acquirer_a!.id, mode: "live", name: "Acquirer A · Live (awaiting credentials)", status: "disabled", priority: 10, feePercent: "2.4", feeFixedMinor: 20, config: {}, limits: {} },
      { id: newId("providerAccount"), providerId: byCode.demo_acquirer_b!.id, mode: "live", name: "Acquirer B · Live (awaiting credentials)", status: "disabled", priority: 20, feePercent: "2.9", feeFixedMinor: 30, config: {}, limits: {} },
    ])
    .returning();
  logger.info("seed: providers and accounts created");
  return { providers: provs, accounts };
}

async function ensureRules(db: Db, accounts: (typeof providerAccounts.$inferSelect)[], provs: (typeof providers.$inferSelect)[]) {
  const existing = await db.select({ id: routingRules.id }).from(routingRules).limit(1);
  if (existing.length) return;
  const byCode = Object.fromEntries(provs.map((p) => [p.code, p.id]));
  const acc = (code: string) => accounts.find((a) => a.providerId === byCode[code] && a.mode === "test")!.id;
  const rules: Array<{ name: string; description: string; priority: number; transactionType: "payment" | "payout"; conditions: unknown[]; strategy: "ordered" | "weighted" | "score"; routes: string[] }> = [
    {
      name: "VN · VND · QR → Demo QR Provider",
      description: "Example from the product brief: local QR rail for Vietnamese dong.",
      priority: 1,
      transactionType: "payment",
      conditions: [
        { field: "country", op: "eq", value: "VN" },
        { field: "currency", op: "eq", value: "VND" },
        { field: "payment_method", op: "eq", value: "qr" },
      ],
      strategy: "ordered",
      routes: [acc("demo_qr")],
    },
    {
      name: "High-value cards → Acquirer B first",
      description: "Card payments above 5,000.00 prefer Acquirer B (higher limits), fallback to A.",
      priority: 5,
      transactionType: "payment",
      conditions: [
        { field: "payment_method", op: "eq", value: "card" },
        { field: "amount", op: "gt", value: 500000 },
      ],
      strategy: "ordered",
      routes: [acc("demo_acquirer_b"), acc("demo_acquirer_a")],
    },
    {
      name: "Cards → Acquirer A, fallback Acquirer B",
      description: "Default card routing with automatic failover.",
      priority: 10,
      transactionType: "payment",
      conditions: [{ field: "payment_method", op: "eq", value: "card" }],
      strategy: "ordered",
      routes: [acc("demo_acquirer_a"), acc("demo_acquirer_b")],
    },
    {
      name: "QR / instant / local → Demo QR Provider",
      description: "Local payment methods go to the QR network.",
      priority: 20,
      transactionType: "payment",
      conditions: [{ field: "payment_method", op: "in", value: ["qr", "instant", "local"] }],
      strategy: "ordered",
      routes: [acc("demo_qr")],
    },
    {
      name: "Wallets → best score",
      description: "Wallet payments are ranked by cost, approval rate and uptime.",
      priority: 30,
      transactionType: "payment",
      conditions: [{ field: "payment_method", op: "eq", value: "wallet" }],
      strategy: "score",
      routes: [acc("demo_acquirer_a"), acc("demo_acquirer_b")],
    },
    {
      name: "Payouts → Acquirer B",
      description: "Only Acquirer B supports payouts in the sandbox.",
      priority: 10,
      transactionType: "payout",
      conditions: [],
      strategy: "ordered",
      routes: [acc("demo_acquirer_b")],
    },
  ];
  for (const r of rules) {
    const id = newId("routingRule");
    await db.insert(routingRules).values({
      id,
      merchantId: null,
      projectId: null,
      mode: "test",
      name: r.name,
      description: r.description,
      priority: r.priority,
      enabled: true,
      transactionType: r.transactionType,
      conditions: r.conditions as never,
      strategy: r.strategy,
      createdBy: "seed",
    });
    await db.insert(providerRoutes).values(r.routes.map((a, i) => ({ id: newId("providerRoute"), routingRuleId: id, providerAccountId: a, position: i, weight: 100 })));
  }
  await db.insert(riskRules).values([
    { id: newId("riskRule"), merchantId: null, mode: "test", name: "Block restricted countries (demo list)", description: "Illustrative list for the sandbox; replace with the compliance policy.", priority: 1, enabled: true, conditions: [{ field: "country", op: "in", value: ["KP", "IR", "SY", "CU"] }], action: "block", score: 100, createdBy: "seed" },
    { id: newId("riskRule"), merchantId: null, mode: "test", name: "Review amounts ≥ 10,000.00", description: "High-value payments are held for manual review.", priority: 10, enabled: true, conditions: [{ field: "amount", op: "gte", value: 1000000 }], action: "review", score: 60, createdBy: "seed" },
    { id: newId("riskRule"), merchantId: null, mode: "test", name: "Velocity > 10 payments / hour", description: "Same customer or IP creating many payments.", priority: 20, enabled: true, conditions: [{ field: "velocity_1h", op: "gt", value: 10 }], action: "review", score: 40, createdBy: "seed" },
    { id: newId("riskRule"), merchantId: null, mode: "test", name: "≥ 5 failed attempts in 24h", description: "Repeated failures from the same customer or IP.", priority: 30, enabled: true, conditions: [{ field: "failed_attempts_24h", op: "gte", value: 5 }], action: "block", score: 80, createdBy: "seed" },
  ]);
  logger.info("seed: routing and risk rules created");
}

async function ensureMerchant(db: Db, password: string, email: string): Promise<{ merchantId: string; projectId: string; apiKey?: string }> {
  const [existing] = await db.select().from(merchantUsers).where(eq(merchantUsers.email, email)).limit(1);
  if (existing) {
    const [project] = await db.select().from(projects).where(eq(projects.merchantId, existing.merchantId)).limit(1);
    return { merchantId: existing.merchantId, projectId: project!.id };
  }
  const hash = await hashPassword(password);
  const merchantId = newId("merchant");
  await db.insert(merchants).values({
    id: merchantId,
    name: "Demo Merchant Ltd",
    legalName: "Demo Merchant Limited",
    country: "GB",
    website: "https://demo-merchant.example",
    contactEmail: email,
    kybStatus: "approved",
    status: "active",
    settings: { industry: "digital_services", defaultCurrency: "USD", timezone: "Europe/London" },
  });
  const projectId = newId("project");
  await db.insert(projects).values({ id: projectId, merchantId, name: "Web Checkout", slug: "web-checkout", settings: { captureMethod: "automatic", defaultCurrency: "USD", retryPolicy: { maxAttempts: 3, retryOnSoftDecline: true, retryOnTimeout: true } } });
  await db.insert(merchantUsers).values([
    { id: newId("merchantUser"), merchantId, email, name: "Demo Owner", passwordHash: hash, role: "owner" },
    { id: newId("merchantUser"), merchantId, email: "developer@demo-merchant.local", name: "Dana Developer", passwordHash: hash, role: "developer" },
    { id: newId("merchantUser"), merchantId, email: "finance@demo-merchant.local", name: "Finn Finance", passwordHash: hash, role: "finance" },
    { id: newId("merchantUser"), merchantId, email: "viewer@demo-merchant.local", name: "Vera Viewer", passwordHash: hash, role: "viewer" },
  ]);
  const key = generateApiKey("test");
  await db.insert(apiKeys).values({ id: newId("apiKey"), merchantId, projectId, mode: "test", name: "Sandbox key (seed)", prefix: key.prefix, keyHash: key.hash, createdBy: "seed" });
  logger.info({ email }, "seed: demo merchant created");
  return { merchantId, projectId, apiKey: key.secret };
}

const DEMO_TRAFFIC: Array<{ amount: number; currency: string; method: "card" | "qr" | "wallet" | "bank_transfer" | "instant"; country: string; scenario?: string; weight: number }> = [
  { amount: 4999, currency: "USD", method: "card", country: "US", weight: 18 },
  { amount: 12900, currency: "EUR", method: "card", country: "DE", weight: 14 },
  { amount: 2500, currency: "GBP", method: "card", country: "GB", weight: 12 },
  { amount: 89000, currency: "USD", method: "card", country: "US", scenario: "failover", weight: 6 },
  { amount: 3400, currency: "EUR", method: "card", country: "FR", scenario: "soft_decline", weight: 5 },
  { amount: 7600, currency: "EUR", method: "card", country: "NL", scenario: "hard_decline", weight: 5 },
  { amount: 5900, currency: "USD", method: "card", country: "CA", scenario: "timeout", weight: 3 },
  { amount: 2100, currency: "USD", method: "card", country: "US", scenario: "unavailable", weight: 3 },
  { amount: 250000, currency: "VND", method: "qr", country: "VN", scenario: "success", weight: 10 },
  { amount: 45000, currency: "THB", method: "qr", country: "TH", scenario: "success", weight: 6 },
  { amount: 15900, currency: "BRL", method: "instant", country: "BR", scenario: "success", weight: 6 },
  { amount: 6900, currency: "USD", method: "wallet", country: "SG", weight: 5 },
  { amount: 19900, currency: "AED", method: "bank_transfer", country: "AE", weight: 4 },
  { amount: 1250000, currency: "USD", method: "card", country: "US", weight: 2 },
];

async function demoTraffic(db: Db, merchantId: string, projectId: string, count: number) {
  const total = DEMO_TRAFFIC.reduce((s, t) => s + t.weight, 0);
  const pick = () => {
    let r = Math.random() * total;
    for (const t of DEMO_TRAFFIC) {
      r -= t.weight;
      if (r <= 0) return t;
    }
    return DEMO_TRAFFIC[0]!;
  };
  const names = ["Ava", "Liam", "Mia", "Noah", "Zoe", "Ethan", "Lena", "Omar", "Sofia", "Kai"];
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = pick();
    const n = names[i % names.length]!;
    const p = await createPayment(
      db,
      { merchantId, projectId, mode: "test" },
      {
        amount: t.amount,
        currency: t.currency,
        payment_method: t.method,
        country: t.country,
        customer: { external_id: `cust_${n.toLowerCase()}_${i % 23}`, email: `${n.toLowerCase()}${i % 23}@example.com`, name: n, country: t.country },
        description: `Order #${10000 + i}`,
        reference: `ORD-${10000 + i}`,
        test_scenario: t.scenario,
        metadata: { seeded: true },
      },
      { actor: { type: "system", id: "seed", label: "seed" } },
    );
    ids.push(p.id);
  }
  // Spread seeded payments over the last 7 days so charts have shape (payments only; ledger rows keep their true time).
  for (const id of ids) {
    const ago = Math.floor(Math.random() * 7 * 24 * 60) * 60 * 1000;
    const when = new Date(Date.now() - ago);
    await db.update(payments).set({ createdAt: when, processedAt: when, updatedAt: when }).where(eq(payments.id, id));
    await db.execute(sql`update payment_attempts set created_at = ${when}, request_sent_at = ${when}, responded_at = ${when} where payment_id = ${id}`);
    await db.execute(sql`update payment_events set created_at = ${when} + (created_at - (select min(created_at) from payment_events where payment_id = ${id})) where payment_id = ${id}`).catch(() => undefined);
  }
  await drainQueues();
  logger.info({ count }, "seed: demo traffic generated through the orchestration engine");
}

export async function runSeed(opts: { demoTraffic?: number } = {}): Promise<SeedResult> {
  const cfg = loadConfig();
  const db = getDb();
  const password = cfg.SEED_DEMO_PASSWORD;
  await ensureAdmins(db, password, cfg.SEED_ADMIN_EMAIL);
  const { providers: provs, accounts } = await ensureProviders(db, cfg.NATIO_ENCRYPTION_KEY);
  await ensureRules(db, accounts, provs);
  const m = await ensureMerchant(db, password, cfg.SEED_MERCHANT_EMAIL);
  if (opts.demoTraffic) await demoTraffic(db, m.merchantId, m.projectId, opts.demoTraffic);
  const result: SeedResult = { adminEmail: cfg.SEED_ADMIN_EMAIL, merchantEmail: cfg.SEED_MERCHANT_EMAIL, password, testApiKey: m.apiKey, merchantId: m.merchantId, projectId: m.projectId };
  if (m.apiKey && !cfg.isProduction) {
    const out = path.resolve(here, "../../.sandbox-credentials.json");
    fs.writeFileSync(out, JSON.stringify({ ...result, note: "Development only. Never commit." }, null, 2));
    logger.info({ file: out }, "seed: sandbox credentials written");
  }
  return result;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const flag = process.argv.find((a) => a.startsWith("--demo-traffic"));
  const demo = flag ? Number(flag.split("=")[1] ?? 80) || 80 : process.env.SEED_DEMO_TRAFFIC ? Number(process.env.SEED_DEMO_TRAFFIC) : 0;
  runSeed({ demoTraffic: demo || undefined })
    .then(async (r) => {
      logger.info({ admin: r.adminEmail, merchant: r.merchantEmail, apiKey: r.testApiKey ? `${r.testApiKey.slice(0, 12)}…` : "(existing)" }, "seed complete");
      await closeDb();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error({ err }, "seed failed");
      await closeDb();
      process.exit(1);
    });
}
