import "./env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HDKey } from "@scure/bip32";
import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client.js";
import { drainQueues } from "../../src/lib/queue.js";
import { payments, transactions, walletAddresses } from "../../src/db/schema/index.js";
import { registerWalletAccount } from "../../src/modules/wallets/service.js";
import { createEndpoint } from "../../src/modules/webhooks/service.js";
import { runWatchCycle } from "../../src/modules/wallets/watcher.js";
import type { FetchLike } from "../../src/modules/wallets/chains/types.js";
import { startTestEnv, stopTestEnv, type TestEnv } from "./setup.js";

/**
 * The on-chain payment, end to end and through the real API: a merchant
 * registers a settlement key, creates a payment over `/v1/payments`, is handed
 * an address to display, the chain reports the money arriving, and the payment
 * closes with the same webhook contract every other method uses.
 *
 * Only the chain's HTTP boundary is stubbed. Everything else — the route, the
 * schema, risk, the state machine, the ledger, the webhook signature — is the
 * code that serves production.
 */

let env: TestEnv;
let walletAccountId = "";
let paymentId = "";
let address = "";

const XPUB =
  "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8";
const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const EXPECTED = "1499000000"; // 1499 USDT, six decimals

const json = (res: { json(): unknown }) => res.json() as Record<string, any>;

function apiKey(method: "GET" | "POST", url: string, body?: unknown) {
  return env.app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${env.seed.testApiKey}`, "content-type": "application/json" },
    payload: body as never,
  });
}

/** A chain that reports the given transfers to the given address. */
function chainStub(to: string, value: string, txid: string): FetchLike {
  const payload = JSON.stringify({
    success: true,
    data: [
      {
        transaction_id: txid,
        token_info: { symbol: "USDT", address: USDT_CONTRACT, decimals: 6, name: "Tether USD" },
        block_timestamp: 1790061939000,
        from: "TFZqUnWVGbV6JvXKaeqihjgYRgjkBTHjrv",
        to,
        type: "Transfer",
        value,
      },
    ],
  });
  return async () => ({ ok: true, status: 200, text: async () => payload });
}

beforeAll(async () => {
  env = await startTestEnv();
  const acct = await registerWalletAccount(getDb(), {
    merchantId: env.seed.merchantId,
    mode: "test",
    label: "USDT settlement",
    network: "tron",
    asset: "USDT",
    extendedKey: HDKey.fromExtendedKey(XPUB).deriveChild(77).publicExtendedKey,
  });
  walletAccountId = acct.id;

  // Subscribe the test receiver. Created through the service rather than the
  // dashboard because this suite is about the payment path; dashboard auth is
  // covered elsewhere and would only add noise here.
  await createEndpoint(getDb(), {
    merchantId: env.seed.merchantId,
    projectId: env.seed.projectId,
    mode: "test",
    url: env.receiver.url,
    description: "crypto e2e receiver",
    events: [],
    actor: { type: "system", id: "test" },
  });
}, 180_000);

afterAll(async () => {
  await stopTestEnv(env);
});

describe("an on-chain payment, through the API", () => {
  it("refuses to take one before a settlement key exists", async () => {
    // The merchant in this suite has a TRON key but no Bitcoin one, so this
    // asks for a destination NATIO would have to invent.
    const res = await apiKey("POST", "/v1/payments", {
      amount: 100000,
      currency: "EUR",
      payment_method: "crypto",
      settlement: { asset: "BTC", network: "bitcoin", amount: "150000" },
    });
    expect(res.statusCode).toBe(422);
    expect(json(res).error.code).toBe("no_settlement_account");
  });

  it("rejects a settlement block on a method that has no settlement", async () => {
    const res = await apiKey("POST", "/v1/payments", {
      amount: 100000,
      currency: "EUR",
      payment_method: "card",
      settlement: { asset: "USDT", network: "tron", amount: "1000000" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("requires the amount the payer must actually send", async () => {
    const res = await apiKey("POST", "/v1/payments", {
      amount: 100000,
      currency: "EUR",
      payment_method: "crypto",
      settlement: { asset: "USDT", network: "tron" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("hands back an address derived from the merchant's own key", async () => {
    const res = await apiKey("POST", "/v1/payments", {
      amount: 149900,
      currency: "EUR",
      payment_method: "crypto",
      reference: "ORDER-CRYPTO-1",
      settlement: { asset: "USDT", network: "tron", amount: EXPECTED, account: walletAccountId },
    });
    expect(res.statusCode).toBe(201);
    const body = json(res);
    paymentId = body.id;

    expect(body.status).toBe("pending");
    expect(body.next_action?.type).toBe("display_details");
    address = body.next_action.details.address;
    expect(address.startsWith("T")).toBe(true);
    expect(body.next_action.details.amount).toBe(EXPECTED);
    expect(body.next_action.details.confirmations_required).toBe("19");
    expect(body.next_action.expires_at ?? body.next_action.expiresAt).toBeTruthy();

    // The address belongs to this payment and to no other.
    const [row] = await getDb().select().from(walletAddresses).where(eq(walletAddresses.address, address)).limit(1);
    expect(row!.paymentId).toBe(paymentId);
    expect(row!.expectedAmount).toBe(EXPECTED);
  }, 60_000);

  it("closes the payment when the money lands, with the usual webhook", async () => {
    const before = env.receiver.forObject(paymentId).length;

    await runWatchCycle(getDb(), { fetchImpl: chainStub(address, EXPECTED, "tx-e2e-crypto-1") });
    await drainQueues();

    const res = await apiKey("GET", `/v1/payments/${paymentId}`);
    expect(res.statusCode).toBe(200);
    expect(json(res).status).toBe("successful");
    // The instruction to pay is gone once there is nothing left to pay.
    expect(json(res).next_action).toBeNull();

    const hooks = env.receiver.forObject(paymentId);
    expect(hooks.length).toBeGreaterThan(before);
    expect(hooks.some((h) => h.json.type === "payment.successful")).toBe(true);
  }, 60_000);

  it("writes the same ledger row a card payment would", async () => {
    // The merchant-facing promise is that on-chain receipts reconcile
    // alongside everything else, so the row has to exist.
    const rows = await getDb().select().from(transactions).where(eq(transactions.paymentId, paymentId));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.status === "successful" && r.type === "payment")).toBe(true);
  });

  it("does not settle twice when the cycle replays", async () => {
    const hooksBefore = env.receiver.forObject(paymentId).filter((h) => h.json.type === "payment.successful").length;

    await runWatchCycle(getDb(), { fetchImpl: chainStub(address, EXPECTED, "tx-e2e-crypto-1") });
    await drainQueues();

    const hooksAfter = env.receiver.forObject(paymentId).filter((h) => h.json.type === "payment.successful").length;
    expect(hooksAfter).toBe(hooksBefore);

    const [p] = await getDb().select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    expect(p!.status).toBe("successful");
  }, 60_000);
});
