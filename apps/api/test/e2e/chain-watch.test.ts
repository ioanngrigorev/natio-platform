import "./env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { HDKey } from "@scure/bip32";
import { closeDb, getDb } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { runSeed } from "../../src/db/seed.js";
import { chainObservations, walletAddresses } from "../../src/db/schema/index.js";
import { registerWalletAccount, reserveAddress } from "../../src/modules/wallets/service.js";
import { runWatchCycle } from "../../src/modules/wallets/watcher.js";
import type { FetchLike } from "../../src/modules/wallets/chains/types.js";

/**
 * The whole path, against a real PostgreSQL, with only the network faked: an
 * address is reserved, a chain reports a transfer to it, and the invoice
 * settles. Everything between those points — derivation, the observation
 * write, the uniqueness constraints, the status derivation — is the real code
 * on real tables.
 *
 * Only the HTTP boundary is stubbed, because that is the only part that cannot
 * be exercised here: this sandbox has no route to any public chain endpoint.
 * The payloads the stub returns were captured from the live APIs.
 */

const XPUB =
  "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8";
const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

let merchantId: string;
let keyCounter = 0;
const distinctXpub = () => HDKey.fromExtendedKey(XPUB).deriveChild(keyCounter++).publicExtendedKey;

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await runMigrations();
  merchantId = (await runSeed()).merchantId;
}, 120_000);

afterAll(async () => {
  await closeDb();
});

/** A chain that reports exactly the transfers the test asks it to. */
function chainStub(transfers: Array<{ to: string; value: string; txid: string }>, opts: { confirmed?: boolean } = {}): FetchLike {
  const body = (list: typeof transfers) =>
    JSON.stringify({
      success: true,
      data: list.map((t) => ({
        transaction_id: t.txid,
        token_info: { symbol: "USDT", address: USDT_CONTRACT, decimals: 6, name: "Tether USD" },
        block_timestamp: 1790061939000,
        from: "TFZqUnWVGbV6JvXKaeqihjgYRgjkBTHjrv",
        to: t.to,
        type: "Transfer",
        value: t.value,
      })),
    });
  return async (url) => ({
    ok: true,
    status: 200,
    text: async () => body(/only_confirmed=true/.test(url) && opts.confirmed === false ? [] : transfers),
  });
}

async function reserveFor(expected: string) {
  const db = getDb();
  const acct = await registerWalletAccount(db, {
    merchantId,
    mode: "test",
    label: `watch-${keyCounter}`,
    network: "tron",
    asset: "USDT",
    extendedKey: distinctXpub(),
  });
  return db.transaction((tx) =>
    reserveAddress(tx, { walletAccountId: acct.id, merchantId, expectedAmount: expected, expiresAt: new Date(Date.now() + 30 * 60 * 1000) }),
  );
}

describe("a payment arriving on chain", () => {
  it("settles the invoice it was reserved for", async () => {
    const db = getDb();
    const addr = await reserveFor("1000000");

    const result = await runWatchCycle(db, {
      fetchImpl: chainStub([{ to: addr.address, value: "1000000", txid: "tx-settles-01" }]),
    });

    expect(result.addressesChecked).toBeGreaterThan(0);
    expect(result.transfersSeen).toBeGreaterThan(0);

    const [row] = await db.select().from(walletAddresses).where(eq(walletAddresses.id, addr.id)).limit(1);
    expect(row!.status).toBe("settled");
    expect(row!.observedAmount).toBe("1000000");
    expect(row!.settledAt).toBeTruthy();
  }, 60_000);

  it("holds at awaiting while the chain still calls it unconfirmed", async () => {
    const db = getDb();
    const addr = await reserveFor("2000000");

    await runWatchCycle(db, {
      fetchImpl: chainStub([{ to: addr.address, value: "2000000", txid: "tx-pending-01" }], { confirmed: false }),
    });

    const [row] = await db.select().from(walletAddresses).where(eq(walletAddresses.id, addr.id)).limit(1);
    expect(row!.status).toBe("awaiting");
    expect(row!.settledAt).toBeNull();
    // Seen, and recorded, just not final.
    expect(row!.observedAmount).toBe("2000000");
  }, 60_000);

  it("calls a short payment underpaid rather than settled", async () => {
    const db = getDb();
    const addr = await reserveFor("5000000");

    await runWatchCycle(db, { fetchImpl: chainStub([{ to: addr.address, value: "4999999", txid: "tx-short-01" }]) });

    const [row] = await db.select().from(walletAddresses).where(eq(walletAddresses.id, addr.id)).limit(1);
    expect(row!.status).toBe("underpaid");
  }, 60_000);

  it("records one observation however many times the cycle runs", async () => {
    const db = getDb();
    const addr = await reserveFor("3000000");
    const stub = chainStub([{ to: addr.address, value: "3000000", txid: "tx-repeat-01" }]);

    await runWatchCycle(db, { fetchImpl: stub });
    await runWatchCycle(db, { fetchImpl: stub });
    await runWatchCycle(db, { fetchImpl: stub });

    const rows = await db.select().from(chainObservations).where(eq(chainObservations.walletAddressId, addr.id));
    expect(rows).toHaveLength(1);
    const [row] = await db.select().from(walletAddresses).where(eq(walletAddresses.id, addr.id)).limit(1);
    // Three cycles, one credit — not three.
    expect(row!.observedAmount).toBe("3000000");
  }, 60_000);

  it("does not credit an invoice from somebody else's address", async () => {
    const db = getDb();
    const mine = await reserveFor("7000000");

    // The chain answers with a transfer to a different address entirely.
    await runWatchCycle(db, {
      fetchImpl: chainStub([{ to: "TSomeoneElse000000000000000000000000", value: "7000000", txid: "tx-wrong-01" }]),
    });

    const [row] = await db.select().from(walletAddresses).where(eq(walletAddresses.id, mine.id)).limit(1);
    expect(row!.status).toBe("reserved");
    expect(row!.observedAmount).toBe("0");
  }, 60_000);

  it("keeps working on one chain when another is failing", async () => {
    const db = getDb();
    const addr = await reserveFor("9000000");

    // Every request errors. The cycle must report it and survive, not throw.
    const broken: FetchLike = async () => ({ ok: false, status: 503, text: async () => "upstream down" });
    const result = await runWatchCycle(db, { fetchImpl: broken });

    expect(result.errors.length).toBeGreaterThan(0);
    const [row] = await db.select().from(walletAddresses).where(eq(walletAddresses.id, addr.id)).limit(1);
    // An outage must never look like "nothing arrived, expire it".
    expect(row!.status).toBe("reserved");
  }, 60_000);
});
