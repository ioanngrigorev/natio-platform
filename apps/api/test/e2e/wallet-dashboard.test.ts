import "./env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { HDKey } from "@scure/bip32";
import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client.js";
import { auditLogs, walletAccounts } from "../../src/db/schema/index.js";
import { startTestEnv, stopTestEnv, type TestEnv } from "./setup.js";

/**
 * The dashboard surface a merchant actually uses to say where their money
 * goes — through the real routes, with real sessions and real roles.
 *
 * The service layer is covered in wallets.test.ts. What is covered here is the
 * boundary around it, because the interesting failure is not a bad derivation:
 * it is a developer-role user quietly registering a key of their own. Every
 * payment would then settle correctly, to someone else, and no status anywhere
 * would look wrong. That is why the check gets a test of its own rather than
 * being trusted to a line in a route handler.
 */

let env: TestEnv;
let ownerCookie = "";
let ownerCsrf = "";
let devCookie = "";
let devCsrf = "";
let accountId = "";

const XPUB =
  "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8";

let keyCounter = 500;
const distinctXpub = () => HDKey.fromExtendedKey(XPUB).deriveChild(keyCounter++).publicExtendedKey;

type Json = Record<string, any>;
const json = (res: LightMyRequestResponse): Json => res.json() as Json;
type Method = InjectOptions["method"];

async function login(email: string): Promise<{ cookie: string; csrf: string }> {
  const res = await env.app.inject({
    method: "POST",
    url: "/dashboard/auth/login",
    payload: { email, password: env.seed.password },
  });
  if (res.statusCode !== 200) throw new Error(`login failed for ${email}: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === "natio_session");
  if (!cookie) throw new Error(`no session cookie for ${email}`);
  return { cookie: cookie.value, csrf: json(res).csrf_token ?? json(res).csrfToken };
}

function as(who: "owner" | "developer", method: Method, url: string, opts: { body?: unknown; csrf?: boolean } = {}) {
  const cookie = who === "owner" ? ownerCookie : devCookie;
  const csrf = who === "owner" ? ownerCsrf : devCsrf;
  const headers: Record<string, string> = {};
  if (opts.csrf !== false && method !== "GET") headers["x-csrf-token"] = csrf;
  return env.app.inject({
    method,
    url,
    headers,
    cookies: { natio_session: cookie },
    payload: opts.body as InjectOptions["payload"],
  });
}

beforeAll(async () => {
  env = await startTestEnv();
  ({ cookie: ownerCookie, csrf: ownerCsrf } = await login(env.seed.merchantEmail));
  ({ cookie: devCookie, csrf: devCsrf } = await login("developer@demo-merchant.local"));
}, 180_000);

afterAll(async () => {
  await stopTestEnv(env);
});

describe("registering a settlement key from the dashboard", () => {
  it("lets the owner register one and hands back an address to verify", async () => {
    const res = await as("owner", "POST", "/dashboard/wallets", {
      body: { label: "Main USDT treasury", network: "tron", asset: "USDT", extended_key: distinctXpub() },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = json(res);
    accountId = body.id;

    // The probe address is the whole point of the confirmation step in the UI:
    // a mistyped key derives addresses that look perfectly normal and belong
    // to nobody, and this is the only moment that is cheap to catch.
    expect(body.probe_address).toBeTruthy();
    expect(body.probe_address.startsWith("T")).toBe(true);
    expect(body.note).toMatch(/your own wallet/i);
  }, 60_000);

  it("never echoes the key back, in any field", async () => {
    const list = await as("owner", "GET", "/dashboard/wallets");
    expect(list.statusCode).toBe(200);
    const account = json(list).data.find((a: Json) => a.id === accountId);
    expect(account).toBeTruthy();

    // A public key cannot spend, but it maps the merchant's entire balance
    // history, so it does not travel back out of the API either.
    expect(list.body).not.toMatch(/[xyz]pub[0-9A-Za-z]{20}/);
    expect(account.key_fingerprint).toHaveLength(12);
    expect(account.status).toBe("active");
    expect(account.stats.received_base_units).toBe("0");
  });

  it("stores it encrypted, and keeps the key out of the audit log too", async () => {
    const db = getDb();
    const [row] = await db.select().from(walletAccounts).where(eq(walletAccounts.id, accountId)).limit(1);
    expect(row!.extendedKey).not.toMatch(/[xyz]pub/);

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.entityId, accountId));
    expect(audits.length).toBeGreaterThan(0);
    expect(audits.some((a) => a.action === "wallet_account.registered")).toBe(true);
    expect(JSON.stringify(audits)).not.toMatch(/[xyz]pub[0-9A-Za-z]{20}/);
  });

  it("refuses an extended private key through the route, not just the service", async () => {
    const res = await as("owner", "POST", "/dashboard/wallets", {
      body: {
        label: "Oops",
        network: "bitcoin",
        asset: "BTC",
        extended_key: "xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(json(res).error.code).toBe("private_key_rejected");
    // The rejection must not quote back what was sent: an error body is the
    // easiest place for a private key to end up in a log.
    expect(res.body).not.toMatch(/xprv/);
  });

  it("validates the shape before anything touches derivation", async () => {
    const res = await as("owner", "POST", "/dashboard/wallets", {
      body: { label: "x", network: "dogecoin", asset: "DOGE", extended_key: "nope" },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe("who is allowed to decide where the money goes", () => {
  it("lets a developer read the settlement keys", async () => {
    const res = await as("developer", "GET", "/dashboard/wallets");
    expect(res.statusCode).toBe(200);
    expect(json(res).data.some((a: Json) => a.id === accountId)).toBe(true);
  });

  it("refuses a developer registering one", async () => {
    const res = await as("developer", "POST", "/dashboard/wallets", {
      body: { label: "Dana's own key", network: "tron", asset: "USDT", extended_key: distinctXpub() },
    });
    expect(res.statusCode).toBe(403);
    // Pinned to the reason, not just the status: a broken CSRF token for this
    // user would also produce 403, and this test would then be checking
    // nothing while reading like it covers the boundary.
    expect(json(res).error.message).toMatch(/wallets\.manage/);

    // And it was refused, not merely reported as refused.
    const accounts = await getDb().select().from(walletAccounts);
    expect(accounts.some((a) => a.label === "Dana's own key")).toBe(false);
  });

  it("refuses a developer archiving one", async () => {
    const res = await as("developer", "POST", `/dashboard/wallets/${accountId}/archive`, { body: {} });
    expect(res.statusCode).toBe(403);
    expect(json(res).error.message).toMatch(/wallets\.manage/);
    const [row] = await getDb().select().from(walletAccounts).where(eq(walletAccounts.id, accountId)).limit(1);
    expect(row!.status).toBe("active");
  });

  it("still requires a CSRF token from the owner", async () => {
    const res = await as("owner", "POST", "/dashboard/wallets", {
      body: { label: "No CSRF", network: "tron", asset: "USDT", extended_key: distinctXpub() },
      csrf: false,
    });
    expect(res.statusCode).toBe(403);
    expect(json(res).error.message).toMatch(/CSRF/i);
  });

  it("refuses an anonymous caller outright", async () => {
    const res = await env.app.inject({ method: "GET", url: "/dashboard/wallets" });
    expect(res.statusCode).toBe(401);
  });
});

describe("reading a key's derived addresses", () => {
  it("returns an empty list before any payment, not an error", async () => {
    const res = await as("owner", "GET", `/dashboard/wallets/${accountId}/addresses`);
    expect(res.statusCode).toBe(200);
    expect(json(res).data).toEqual([]);
  });

  it("does not leak another merchant's account through a guessed id", async () => {
    const db = getDb();
    // An id belonging to nobody in this merchant: scoping is by merchant, so
    // the answer must be empty rather than another tenant's addresses.
    const res = await as("owner", "GET", "/dashboard/wallets/wa_000000000000000000000000/addresses");
    expect(res.statusCode).toBe(200);
    expect(json(res).data).toEqual([]);
    expect((await db.select().from(walletAccounts)).length).toBeGreaterThan(0);
  });
});

describe("archiving", () => {
  it("retires the key without deleting its history", async () => {
    const res = await as("owner", "POST", `/dashboard/wallets/${accountId}/archive`, { body: {} });
    expect(res.statusCode).toBe(200);

    const list = await as("owner", "GET", "/dashboard/wallets");
    const account = json(list).data.find((a: Json) => a.id === accountId);
    // Still listed, and still carrying its stats. Archiving is not deletion:
    // money that already settled to this key has to stay reconcilable.
    expect(account.status).toBe("archived");
    expect(account.key_fingerprint).toHaveLength(12);

    const audits = await getDb().select().from(auditLogs).where(eq(auditLogs.entityId, accountId));
    expect(audits.some((a) => a.action === "wallet_account.archived")).toBe(true);
  });

  it("404s on an account that is not this merchant's", async () => {
    const res = await as("owner", "POST", "/dashboard/wallets/wa_000000000000000000000000/archive", { body: {} });
    expect(res.statusCode).toBe(404);
  });
});
