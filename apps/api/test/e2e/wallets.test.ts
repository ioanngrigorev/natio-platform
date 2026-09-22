import "./env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { HDKey } from "@scure/bip32";
import { closeDb, getDb } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { runSeed } from "../../src/db/seed.js";
import { chainObservations, walletAccounts, walletAddresses } from "../../src/db/schema/index.js";
import {
  CONFIRMATION_THRESHOLDS,
  recordObservation,
  registerWalletAccount,
  reserveAddress,
  settleFromObservations,
} from "../../src/modules/wallets/service.js";

/**
 * These run against a real PostgreSQL because the properties under test are
 * database properties. `reserveAddress` claims two concurrent callers can never
 * receive the same address; that claim rests entirely on PostgreSQL's row lock,
 * so testing it against a mock would only prove the mock is single-threaded.
 */

const XPUB =
  "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8";
const ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";

let merchantId: string;

/**
 * A distinct, valid xpub per test account. The service refuses to register the
 * same key twice — deliberately, because a shared key means funds landing in
 * someone else's wallet — so the fixtures have to be genuinely different keys
 * rather than the same one relabelled. Child keys of a published test vector
 * are real extended public keys and cost nothing to make.
 */
let keyCounter = 0;
function distinctXpub(): string {
  const child = HDKey.fromExtendedKey(XPUB).deriveChild(keyCounter++);
  return child.publicExtendedKey;
}

beforeAll(async () => {
  // Start from an empty schema. Registering a key is deliberately one-shot, so
  // leftovers from an earlier run would make these tests fail for the wrong
  // reason — and a test that passes only on a fresh database is not a test.
  const db = getDb();
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await runMigrations();
  const seed = await runSeed();
  merchantId = seed.merchantId;
}, 120_000);

afterAll(async () => {
  await closeDb();
});

async function freshAccount(opts: { network?: string; asset?: string; key?: string; label?: string } = {}) {
  const db = getDb();
  return registerWalletAccount(db, {
    merchantId,
    mode: "test",
    label: opts.label ?? `acct-${Math.random().toString(36).slice(2, 8)}`,
    network: opts.network ?? "tron",
    asset: opts.asset ?? "USDT",
    // A distinct key per account: the service refuses duplicates on purpose.
    extendedKey: opts.key ?? distinctXpub(),
  });
}

describe("registering a settlement key", () => {
  it("stores the key encrypted and never in the clear", async () => {
    const db = getDb();
    const key = distinctXpub();
    const acct = await freshAccount({ key });
    const [row] = await db.select().from(walletAccounts).where(eq(walletAccounts.id, acct.id)).limit(1);
    expect(row).toBeTruthy();
    expect(row!.extendedKey).not.toContain(key);
    expect(row!.extendedKey).not.toContain("xpub");
    expect(row!.keyFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses an extended private key", async () => {
    const db = getDb();
    const xprv =
      "xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi";
    await expect(
      registerWalletAccount(db, { merchantId, mode: "test", label: "bad", network: "tron", asset: "USDT", extendedKey: xprv }),
    ).rejects.toThrow(/private/i);
    // Nothing may be persisted on the way to that refusal.
    const rows = await db.select().from(walletAccounts);
    expect(rows.every((r) => !r.extendedKey.includes("xprv"))).toBe(true);
  });

  it("refuses the same key twice", async () => {
    const db = getDb();
    const key = distinctXpub();
    await freshAccount({ key });
    await expect(freshAccount({ key })).rejects.toThrow(/already registered/i);
  });

  it("refuses a Bitcoin-shaped key on a non-Bitcoin network", async () => {
    const db = getDb();
    await expect(
      registerWalletAccount(db, { merchantId, mode: "test", label: "x", network: "tron", asset: "USDT", extendedKey: ZPUB }),
    ).rejects.toThrow(/Bitcoin script type/i);
  });
});

describe("reserving addresses", () => {
  it("hands out distinct addresses under concurrency", async () => {
    const db = getDb();
    const acct = await freshAccount();

    // Fire them at once. Each runs in its own transaction, which is exactly the
    // situation two simultaneous checkouts produce.
    const N = 25;
    const results = await Promise.all(
      Array.from({ length: N }, () => db.transaction((tx) => reserveAddress(tx, { walletAccountId: acct.id, merchantId }))),
    );

    const addresses = new Set(results.map((r) => r.address));
    const indices = new Set(results.map((r) => r.derivationIndex));
    expect(addresses.size).toBe(N);
    expect(indices.size).toBe(N);
    // Indices are a contiguous block starting at 0 — no gaps, no repeats.
    expect([...indices].sort((a, b) => a - b)).toEqual(Array.from({ length: N }, (_, i) => i));

    const [row] = await db.select().from(walletAccounts).where(eq(walletAccounts.id, acct.id)).limit(1);
    expect(row!.nextIndex).toBe(N);
  }, 60_000);

  it("derives the addresses the key actually owns", async () => {
    const db = getDb();
    const acct = await freshAccount({ network: "bitcoin", asset: "BTC", key: ZPUB });
    const first = await db.transaction((tx) => reserveAddress(tx, { walletAccountId: acct.id, merchantId }));
    // BIP84's published first receiving address for this account key.
    expect(first.address).toBe("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
    expect(first.confirmationsRequired).toBe(CONFIRMATION_THRESHOLDS.bitcoin);
  });
});

describe("observing the chain", () => {
  async function addressFor(expected: string) {
    const db = getDb();
    const acct = await freshAccount();
    return db.transaction((tx) => reserveAddress(tx, { walletAccountId: acct.id, merchantId, expectedAmount: expected }));
  }

  it("is idempotent across repeated polls", async () => {
    const db = getDb();
    const addr = await addressFor("1000000");

    const observe = (confirmations: number) =>
      db.transaction((tx) =>
        recordObservation(tx, {
          walletAddressId: addr.id,
          merchantId,
          network: "tron",
          txHash: "0xrepeat",
          asset: "USDT",
          amount: "1000000",
          confirmations,
        }),
      );

    await observe(1);
    await observe(5);
    const third = await observe(19);

    const rows = await db.select().from(chainObservations).where(eq(chainObservations.walletAddressId, addr.id));
    expect(rows).toHaveLength(1); // seen three times, recorded once
    expect(rows[0]!.confirmations).toBe(19);
    expect(third.status).toBe("settled");
    expect(third.confirmedAmount).toBe("1000000");
  });

  it("never walks confirmations backwards", async () => {
    const db = getDb();
    const addr = await addressFor("1000000");
    const obs = (confirmations: number) =>
      db.transaction((tx) =>
        recordObservation(tx, {
          walletAddressId: addr.id, merchantId, network: "tron", txHash: "0xflap",
          asset: "USDT", amount: "1000000", confirmations,
        }),
      );

    await obs(19);
    // A lagging node reports a lower count; a settled payment must not unsettle.
    await obs(2);
    const rows = await db.select().from(chainObservations).where(eq(chainObservations.walletAddressId, addr.id));
    expect(rows[0]!.confirmations).toBe(19);
  });

  it("holds at awaiting until the threshold is reached", async () => {
    const db = getDb();
    const addr = await addressFor("1000000");
    const r = await db.transaction((tx) =>
      recordObservation(tx, {
        walletAddressId: addr.id, merchantId, network: "tron", txHash: "0xslow",
        asset: "USDT", amount: "1000000", confirmations: 3,
      }),
    );
    expect(r.status).toBe("awaiting");
    expect(r.confirmedAmount).toBe("0");
    expect(r.observedAmount).toBe("1000000");
  });

  it("calls a short payment underpaid rather than settled", async () => {
    const db = getDb();
    const addr = await addressFor("1000000");
    const r = await db.transaction((tx) =>
      recordObservation(tx, {
        walletAddressId: addr.id, merchantId, network: "tron", txHash: "0xshort",
        asset: "USDT", amount: "999999", confirmations: 19,
      }),
    );
    expect(r.status).toBe("underpaid");
  });

  it("adds up several transactions to the same address", async () => {
    const db = getDb();
    const addr = await addressFor("1000000");
    for (const [hash, amount] of [["0xpart1", "400000"], ["0xpart2", "600000"]] as const) {
      await db.transaction((tx) =>
        recordObservation(tx, {
          walletAddressId: addr.id, merchantId, network: "tron", txHash: hash,
          asset: "USDT", amount, confirmations: 19,
        }),
      );
    }
    const [row] = await getDb().select().from(walletAddresses).where(eq(walletAddresses.id, addr.id)).limit(1);
    expect(row!.status).toBe("settled");
    expect(row!.observedAmount).toBe("1000000");
  });

  it("corrects the balance when a reorg orphans a transaction", async () => {
    const db = getDb();
    const addr = await addressFor("1000000");
    await db.transaction((tx) =>
      recordObservation(tx, {
        walletAddressId: addr.id, merchantId, network: "tron", txHash: "0xreorg",
        asset: "USDT", amount: "1000000", confirmations: 19,
      }),
    );
    let [row] = await db.select().from(walletAddresses).where(eq(walletAddresses.id, addr.id)).limit(1);
    expect(row!.status).toBe("settled");

    // The watcher marks the row orphaned; the total is derived, so it corrects
    // itself rather than needing a compensating entry.
    await db.update(chainObservations).set({ orphaned: true }).where(eq(chainObservations.txHash, "0xreorg"));
    const after = await db.transaction((tx) => settleFromObservations(tx, addr.id));
    expect(after.confirmedAmount).toBe("0");
    expect(after.observedAmount).toBe("0");
  });

  it("handles an amount far beyond what a JS number holds exactly", async () => {
    const db = getDb();
    // 1000 ETH in wei — past Number.MAX_SAFE_INTEGER by many orders of magnitude.
    const wei = "1000000000000000000000";
    const acct = await freshAccount({ network: "ethereum", asset: "ETH" });
    const addr = await db.transaction((tx) =>
      reserveAddress(tx, { walletAccountId: acct.id, merchantId, expectedAmount: wei }),
    );
    const r = await db.transaction((tx) =>
      recordObservation(tx, {
        walletAddressId: addr.id, merchantId, network: "ethereum", txHash: "0xbig",
        asset: "ETH", amount: wei, confirmations: 12,
      }),
    );
    expect(r.status).toBe("settled");
    expect(r.confirmedAmount).toBe(wei); // exact, not rounded
  });
});
