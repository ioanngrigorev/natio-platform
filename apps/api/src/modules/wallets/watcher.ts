/**
 * The loop that turns "an address exists" into "the invoice is paid".
 *
 * It asks each chain what has arrived at the addresses currently worth
 * watching, and hands every answer to `recordObservation`, which is idempotent
 * — so this can run as often as it likes, overlap with itself, or replay an
 * entire day without double-crediting anything. That property lives in the
 * database constraint, not in this file's carefulness, which is the right
 * place for it.
 *
 * The guiding decision here is that one broken chain must not stop the others.
 * A public endpoint being rate-limited is an ordinary Tuesday, and a watcher
 * that gives up on the first error is a watcher that misses payments on a
 * chain that was working fine.
 */
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import { walletAccounts, walletAddresses } from "../../db/schema/index.js";
import { logger } from "../../lib/logger.js";
import type { ChainNetwork } from "./derivation.js";
import { assetSpec, chainClientFor, isObservable, type ChainClientOptions } from "./chains/index.js";
import { recordObservation } from "./service.js";
import { markCryptoPaymentSeen, settleCryptoPayment } from "../payments/service.js";

/** Statuses still worth asking a chain about. */
const WATCHED = ["reserved", "awaiting"] as const;

export interface WatchResult {
  addressesChecked: number;
  transfersSeen: number;
  settled: number;
  expired: number;
  errors: Array<{ network: string; address?: string; message: string }>;
}

/**
 * How long after expiry an address is still watched.
 *
 * A payer who sends five minutes late has still sent the money, and it still
 * arrives at the merchant's own wallet — nothing is lost either way. But
 * noticing it means the invoice can be reconciled instead of becoming a
 * support conversation, and the cost of looking is one request.
 */
const GRACE_MS = 60 * 60 * 1000;

export async function runWatchCycle(db: DbOrTx, opts: ChainClientOptions & { limit?: number } = {}): Promise<WatchResult> {
  const result: WatchResult = { addressesChecked: 0, transfersSeen: 0, settled: 0, expired: 0, errors: [] };
  const cutoff = new Date(Date.now() - GRACE_MS);

  const rows = await db
    .select({
      id: walletAddresses.id,
      merchantId: walletAddresses.merchantId,
      network: walletAddresses.network,
      asset: walletAddresses.asset,
      address: walletAddresses.address,
      status: walletAddresses.status,
      expiresAt: walletAddresses.expiresAt,
      paymentId: walletAddresses.paymentId,
    })
    .from(walletAddresses)
    .where(
      and(
        inArray(walletAddresses.status, [...WATCHED]),
        or(isNull(walletAddresses.expiresAt), sql`${walletAddresses.expiresAt} > ${cutoff}`),
      ),
    )
    .limit(opts.limit ?? 500);

  // Group by chain so one client serves many addresses and one chain's outage
  // is contained to its own group.
  const byNetwork = new Map<ChainNetwork, typeof rows>();
  for (const row of rows) {
    const network = row.network as ChainNetwork;
    if (!isObservable(network)) continue;
    const list = byNetwork.get(network) ?? [];
    list.push(row);
    byNetwork.set(network, list);
  }

  for (const [network, addresses] of byNetwork) {
    let client;
    try {
      client = chainClientFor(network, opts);
    } catch (err) {
      result.errors.push({ network, message: err instanceof Error ? err.message : "no client" });
      continue;
    }

    for (const row of addresses) {
      const spec = assetSpec(network, row.asset);
      if (!spec) {
        result.errors.push({ network, address: row.address, message: `asset ${row.asset} is not configured on ${network}` });
        continue;
      }

      try {
        const transfers = await client.getIncoming(row.address, spec);
        result.addressesChecked += 1;
        result.transfersSeen += transfers.length;

        for (const t of transfers) {
          const outcome = await recordObservation(db, {
            walletAddressId: row.id,
            merchantId: row.merchantId,
            network,
            txHash: t.txHash,
            outputIndex: t.outputIndex,
            asset: row.asset,
            amount: t.amount,
            blockNumber: t.blockNumber,
            confirmations: t.confirmations,
            raw: t.raw,
          });
          if (outcome.status === "awaiting" && row.paymentId) {
            await markCryptoPaymentSeen(db as never, row.paymentId, {
              amount: outcome.observedAmount,
              asset: row.asset,
              network,
              confirmations: t.confirmations,
              confirmationsRequired: 0,
            });
          }
          if (outcome.status === "settled" && row.status !== "settled") {
            result.settled += 1;
            // An address reserved for an invoice closes that invoice. One
            // settlement, one transition: settleCryptoPayment refuses to move
            // a payment that is no longer pending, so a replayed cycle cannot
            // emit a second webhook.
            if (row.paymentId) {
              await settleCryptoPayment(db as never, row.paymentId, {
                amount: outcome.confirmedAmount,
                asset: row.asset,
                network,
                confirmations: t.confirmations,
              });
            }
          }
        }
      } catch (err) {
        // One address failing says nothing about the next one. Record it and
        // carry on; the next cycle is three minutes away.
        result.errors.push({ network, address: row.address, message: err instanceof Error ? err.message : "lookup failed" });
      }
    }
  }

  result.expired = await expireStaleAddresses(db);

  if (result.errors.length > 0) {
    logger.warn({ watch: { checked: result.addressesChecked, errors: result.errors.slice(0, 5) } }, "chain watch cycle had errors");
  }
  return result;
}

/**
 * Close the window on addresses nobody paid.
 *
 * Only ones that were never seen on-chain: an address with any observation
 * against it is a conversation about amounts, not an abandonment, and marking
 * it expired would hide a real payment behind a tidy status.
 */
export async function expireStaleAddresses(db: DbOrTx): Promise<number> {
  const cutoff = new Date(Date.now() - GRACE_MS);
  const updated = await db
    .update(walletAddresses)
    .set({ status: "expired", updatedAt: new Date() })
    .where(
      and(
        eq(walletAddresses.status, "reserved"),
        isNull(walletAddresses.firstSeenAt),
        lt(walletAddresses.expiresAt, cutoff),
      ),
    )
    .returning({ id: walletAddresses.id });
  return updated.length;
}

/** Health probe for the admin provider-monitoring view. */
export async function chainHealth(opts: ChainClientOptions = {}): Promise<Array<{ network: ChainNetwork; ok: boolean; tip?: number; latencyMs: number; message?: string }>> {
  const networks: ChainNetwork[] = ["tron", "bitcoin"];
  return Promise.all(
    networks.map(async (network) => {
      const started = Date.now();
      try {
        const tip = await chainClientFor(network, opts).getTipHeight();
        return { network, ok: true, tip, latencyMs: Date.now() - started };
      } catch (err) {
        return { network, ok: false, latencyMs: Date.now() - started, message: err instanceof Error ? err.message : "unreachable" };
      }
    }),
  );
}

/** Exported for the worker registration and for tests. */
export const WATCH_INTERVAL_MS = 60_000;

export type { ChainClientOptions };
export { walletAccounts };
