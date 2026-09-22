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
import { assetSpec } from "../../src/modules/wallets/chains/index.js";

/**
 * The EVM path against a real PostgreSQL, with only the JSON-RPC boundary
 * stubbed — the payload shape is the one a live node returned.
 *
 * The test that earns its place is the reorg: until now nothing set the
 * `orphaned` flag, so a withdrawn transfer would have left a payment settled
 * on money that no longer exists.
 */

const XPUB =
  "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const TIP = 0x18d3bcc;

let merchantId = "";
let k = 700;
const nextXpub = () => HDKey.fromExtendedKey(XPUB).deriveChild(k++).publicExtendedKey;

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await runMigrations();
  merchantId = (await runSeed()).merchantId;
}, 180_000);

afterAll(async () => {
  await closeDb();
});

/** A node that reports the given transfers, in the shape a real one uses. */
function evmNode(
  transfers: Array<{ to: string; value: bigint; txid: string; logIndex?: number; removed?: boolean; contract?: string }>,
  opts: { confirmedDepth?: number; network?: "ethereum" | "bsc" } = {},
): FetchLike {
  const depth = opts.confirmedDepth ?? 40;
  // The real contract for the network under test: the client rejects anything
  // else, which is the counterfeit-token defence doing its job.
  const contractFor = assetSpec(opts.network ?? "ethereum", "USDT")!.contract!;
  return async (_url, init) => {
    const req = JSON.parse(init!.body!) as { method: string };
    const result =
      req.method === "eth_blockNumber"
        ? `0x${TIP.toString(16)}`
        : transfers.map((t) => ({
            address: (t.contract ?? contractFor).toLowerCase(),
            topics: [TRANSFER, `0x${"0".repeat(24)}3470447f3cecffac709d3e783a307790b0208d60`, `0x${"0".repeat(24)}${t.to.slice(2).toLowerCase()}`],
            data: `0x${t.value.toString(16).padStart(64, "0")}`,
            blockNumber: `0x${(TIP - depth + 1).toString(16)}`,
            transactionHash: t.txid,
            logIndex: `0x${(t.logIndex ?? 0).toString(16)}`,
            removed: t.removed ?? false,
          }));
    return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result }) };
  };
}

async function reserveOn(network: "ethereum" | "bsc", expected: string) {
  const db = getDb();
  const acct = await registerWalletAccount(db, {
    merchantId,
    mode: "test",
    label: `evm-${k}`,
    network,
    asset: "USDT",
    extendedKey: nextXpub(),
  });
  return db.transaction((tx) =>
    reserveAddress(tx, { walletAccountId: acct.id, merchantId, expectedAmount: expected, expiresAt: new Date(Date.now() + 30 * 60 * 1000) }),
  );
}

describe("an ERC-20 payment on Ethereum", () => {
  it("settles the invoice it was reserved for", async () => {
    const db = getDb();
    const addr = await reserveOn("ethereum", "1500000");

    const result = await runWatchCycle(db, {
      fetchImpl: evmNode([{ to: addr.address, value: 1_500_000n, txid: "0xeth-settle-1" }]),
      evmRpcUrls: { ethereum: "https://node.invalid" },
    });
    expect(result.transfersSeen).toBeGreaterThan(0);

    const [row] = await db.select().from(walletAddresses).where(eq(walletAddresses.id, addr.id)).limit(1);
    expect(row!.status).toBe("settled");
    expect(row!.observedAmount).toBe("1500000");
  }, 60_000);

  it("keeps two transfers in one transaction apart by log index", async () => {
    const db = getDb();
    const addr = await reserveOn("ethereum", "3000000");

    await runWatchCycle(db, {
      fetchImpl: evmNode([
        { to: addr.address, value: 1_000_000n, txid: "0xeth-two-logs", logIndex: 3 },
        { to: addr.address, value: 2_000_000n, txid: "0xeth-two-logs", logIndex: 7 },
      ]),
      evmRpcUrls: { ethereum: "https://node.invalid" },
    });

    const rows = await db.select().from(chainObservations).where(eq(chainObservations.walletAddressId, addr.id));
    // One hash, two payments. Keying on the hash alone would lose one.
    expect(rows).toHaveLength(2);
    const [row] = await db.select().from(walletAddresses).where(eq(walletAddresses.id, addr.id)).limit(1);
    expect(row!.observedAmount).toBe("3000000");
    expect(row!.status).toBe("settled");
  }, 60_000);

  it("does not credit a transfer from a counterfeit contract", async () => {
    const db = getDb();
    const addr = await reserveOn("ethereum", "5000000");
    await runWatchCycle(db, {
      fetchImpl: evmNode([{ to: addr.address, value: 5_000_000n, txid: "0xeth-fake", contract: "0x000000000000000000000000000000000000dEaD" }]),
      evmRpcUrls: { ethereum: "https://node.invalid" },
    });
    const [row] = await db.select().from(walletAddresses).where(eq(walletAddresses.id, addr.id)).limit(1);
    expect(row!.status).toBe("reserved");
    expect(row!.observedAmount).toBe("0");
  }, 60_000);
});

describe("BNB Smart Chain, where USDT has eighteen decimals", () => {
  it("settles an amount a six-decimal assumption would have got wrong", async () => {
    const db = getDb();
    // 100 USDT on BSC. Under a six-decimal assumption this same integer would
    // read as 100 trillion USDT.
    const hundred = 100n * 10n ** 18n;
    const addr = await reserveOn("bsc", hundred.toString());

    await runWatchCycle(db, {
      fetchImpl: evmNode([{ to: addr.address, value: hundred, txid: "0xbsc-1" }], { network: "bsc" }),
      evmRpcUrls: { bsc: "https://node.invalid" },
    });

    const [row] = await db.select().from(walletAddresses).where(eq(walletAddresses.id, addr.id)).limit(1);
    expect(row!.status).toBe("settled");
    expect(row!.observedAmount).toBe("100000000000000000000");
    expect(BigInt(row!.observedAmount)).toBe(hundred);
  }, 60_000);
});

describe("a reorg that withdraws a settled payment", () => {
  it("takes the money back off the invoice instead of leaving it settled", async () => {
    const db = getDb();
    const addr = await reserveOn("ethereum", "2500000");
    const paid = [{ to: addr.address, value: 2_500_000n, txid: "0xeth-reorg-1" }];

    await runWatchCycle(db, { fetchImpl: evmNode(paid), evmRpcUrls: { ethereum: "https://node.invalid" } });
    let [row] = await db.select().from(walletAddresses).where(eq(walletAddresses.id, addr.id)).limit(1);
    expect(row!.status).toBe("settled");
    expect(row!.observedAmount).toBe("2500000");

    // The chain now says that block is gone.
    const result = await runWatchCycle(db, {
      fetchImpl: evmNode([{ ...paid[0]!, removed: true }]),
      evmRpcUrls: { ethereum: "https://node.invalid" },
    });
    expect(result.reorged).toBe(1);

    [row] = await db.select().from(walletAddresses).where(eq(walletAddresses.id, addr.id)).limit(1);
    expect(row!.observedAmount).toBe("0");
    expect(row!.status).not.toBe("settled");

    // The observation is kept and flagged, not deleted: the history of what
    // the chain said stays intact.
    const [obs] = await db.select().from(chainObservations).where(eq(chainObservations.txHash, "0xeth-reorg-1"));
    expect(obs!.orphaned).toBe(true);
    expect(obs!.amount).toBe("2500000");
  }, 60_000);

  it("re-credits it if the chain includes it again", async () => {
    const db = getDb();
    const [obs] = await db.select().from(chainObservations).where(eq(chainObservations.txHash, "0xeth-reorg-1"));
    const addrId = obs!.walletAddressId;
    const [addr] = await db.select().from(walletAddresses).where(eq(walletAddresses.id, addrId)).limit(1);

    await runWatchCycle(db, {
      fetchImpl: evmNode([{ to: addr!.address, value: 2_500_000n, txid: "0xeth-reorg-1" }]),
      evmRpcUrls: { ethereum: "https://node.invalid" },
    });

    const [after] = await db.select().from(walletAddresses).where(eq(walletAddresses.id, addrId)).limit(1);
    expect(after!.observedAmount).toBe("2500000");
    const [again] = await db.select().from(chainObservations).where(eq(chainObservations.txHash, "0xeth-reorg-1"));
    expect(again!.orphaned).toBe(false);
  }, 60_000);

  it("shrugs at a withdrawn transfer it never recorded", async () => {
    const db = getDb();
    const addr = await reserveOn("ethereum", "9000000");
    const result = await runWatchCycle(db, {
      fetchImpl: evmNode([{ to: addr.address, value: 9_000_000n, txid: "0xnever-seen", removed: true }]),
      evmRpcUrls: { ethereum: "https://node.invalid" },
    });
    expect(result.reorged).toBe(0);
    const [row] = await db.select().from(walletAddresses).where(eq(walletAddresses.id, addr.id)).limit(1);
    expect(row!.status).toBe("reserved");
  }, 60_000);
});
