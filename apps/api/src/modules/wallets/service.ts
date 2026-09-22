/**
 * Wallet accounts and the addresses derived from them.
 *
 * The interesting part of this file is `reserveAddress`. Everything else is
 * bookkeeping; that function is where two requests arriving at the same moment
 * decide whether two customers are told to pay the same address — which would
 * make it impossible to say who paid what, on a ledger whose whole job is to
 * say exactly that.
 */
import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import { chainObservations, walletAccounts, walletAddresses } from "../../db/schema/index.js";
import { loadConfig } from "../../config.js";
import { decryptString, encryptString, sha256Hex } from "../../lib/crypto.js";
import { ApiError } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { type ChainNetwork, deriveAddress, isChainNetwork, parseExtendedPublicKey } from "./derivation.js";

/** Confirmations before a receipt is treated as final, per network. */
export const CONFIRMATION_THRESHOLDS: Record<ChainNetwork, number> = {
  bitcoin: 2,
  ethereum: 12,
  bsc: 15,
  polygon: 30,
  tron: 19,
};

export interface RegisterWalletAccountInput {
  merchantId: string;
  mode: "test" | "live";
  label: string;
  network: string;
  asset: string;
  extendedKey: string;
}

/**
 * Register a merchant's settlement key.
 *
 * Deriving index 0 here is not a formality. It is the only moment we can prove,
 * before any customer is ever shown an address, that this key produces
 * addresses on the network the merchant selected. A zpub registered against
 * TRON would otherwise sail through and fail at the worst possible time.
 */
export async function registerWalletAccount(db: DbOrTx, input: RegisterWalletAccountInput) {
  if (!isChainNetwork(input.network)) {
    throw new ApiError(400, "invalid_request_error", "unsupported_network", `Unsupported network "${input.network}".`);
  }
  const network = input.network;
  const key = input.extendedKey.trim();

  // Throws for a private key, a recovery phrase or an unusable prefix.
  const parsed = parseExtendedPublicKey(key);

  // Bitcoin script types come from the key prefix; the other networks do not
  // use one, so a bitcoin-shaped key on them is a mistake worth naming.
  if (network !== "bitcoin" && parsed.script !== "p2pkh") {
    throw new ApiError(
      400,
      "invalid_request_error",
      "key_network_mismatch",
      `A ${parsed.prefix} key describes a Bitcoin script type. For ${network}, register a standard xpub from that chain's account path.`,
    );
  }
  if (parsed.testnet && input.mode === "live") {
    throw new ApiError(
      400,
      "invalid_request_error",
      "key_network_mismatch",
      "That is a testnet key. Live payments settled to it would be unspendable.",
    );
  }

  // Prove the key derives before storing it.
  const probe = deriveAddress(key, network, 0);

  const fingerprint = sha256Hex(key);
  const existing = await db
    .select({ id: walletAccounts.id, merchantId: walletAccounts.merchantId })
    .from(walletAccounts)
    .where(and(eq(walletAccounts.keyFingerprint, fingerprint), eq(walletAccounts.status, "active")))
    .limit(1);

  if (existing[0]) {
    // The same key under two merchants means someone copied a key out of a
    // guide or out of another account, and funds are about to land somewhere
    // unexpected. Refuse rather than quietly accept.
    throw new ApiError(
      409,
      "invalid_request_error",
      "extended_key_already_registered",
      existing[0].merchantId === input.merchantId
        ? "This extended key is already registered on your account."
        : "This extended key is already registered. If you believe this is your key, contact support — do not reuse a key from an example or another account.",
    );
  }

  const id = newId("walletAccount");
  await db.insert(walletAccounts).values({
    id,
    merchantId: input.merchantId,
    mode: input.mode,
    label: input.label.trim(),
    network,
    asset: input.asset.trim().toUpperCase(),
    extendedKey: encryptString(key, loadConfig().NATIO_ENCRYPTION_KEY),
    keyFingerprint: fingerprint,
    scriptType: parsed.script,
    nextIndex: 0,
  });

  return { id, network, asset: input.asset.trim().toUpperCase(), scriptType: parsed.script, probeAddress: probe.address };
}

/**
 * Allocate the next unused address on an account, for one payment.
 *
 * Two concurrent calls must not receive the same index. The counter is bumped
 * with a single conditional UPDATE … RETURNING inside the caller's
 * transaction, so PostgreSQL's row lock does the serialising: the second
 * writer blocks on the first and reads the value the first committed. A
 * read-then-write would happily hand both callers the same number.
 *
 * The unique index on (wallet_account_id, derivation_index) is the backstop.
 * If this logic is ever wrong, the insert fails loudly instead of producing a
 * shared address, which is the failure mode worth having.
 */
export async function reserveAddress(
  tx: DbOrTx,
  input: { walletAccountId: string; merchantId: string; paymentId?: string; expectedAmount?: string; expiresAt?: Date },
) {
  const [account] = await tx
    .select()
    .from(walletAccounts)
    .where(and(eq(walletAccounts.id, input.walletAccountId), eq(walletAccounts.merchantId, input.merchantId)))
    .limit(1);

  if (!account) throw new ApiError(404, "not_found_error", "wallet_account_not_found", "Wallet account not found.");
  if (account.status !== "active") {
    throw new ApiError(409, "state_error", "wallet_account_archived", "That wallet account is archived and cannot receive new payments.");
  }

  const [bumped] = await tx
    .update(walletAccounts)
    .set({ nextIndex: sql`${walletAccounts.nextIndex} + 1`, updatedAt: new Date() })
    .where(eq(walletAccounts.id, account.id))
    .returning({ nextIndex: walletAccounts.nextIndex });

  if (!bumped) throw new ApiError(500, "internal_error", "index_allocation_failed", "Could not allocate a derivation index.");
  const index = bumped.nextIndex - 1; // RETURNING gives the post-increment value

  const network = account.network as ChainNetwork;
  const derived = deriveAddress(decryptString(account.extendedKey, loadConfig().NATIO_ENCRYPTION_KEY), network, index);

  const id = newId("walletAddress");
  await tx.insert(walletAddresses).values({
    id,
    walletAccountId: account.id,
    merchantId: account.merchantId,
    mode: account.mode,
    network,
    asset: account.asset,
    derivationIndex: index,
    derivationPath: derived.path,
    address: derived.address,
    paymentId: input.paymentId ?? null,
    status: "reserved",
    expectedAmount: input.expectedAmount ?? null,
    confirmationsRequired: CONFIRMATION_THRESHOLDS[network],
    expiresAt: input.expiresAt ?? null,
  });

  return {
    id,
    address: derived.address,
    derivationIndex: index,
    derivationPath: derived.path,
    network,
    asset: account.asset,
    confirmationsRequired: CONFIRMATION_THRESHOLDS[network],
    expiresAt: input.expiresAt ?? null,
  };
}

/**
 * Record what the chain showed, idempotently.
 *
 * The watcher re-reads the same transaction on every poll, so this must be safe
 * to call repeatedly with the same input: the first call inserts, later ones
 * only move the confirmation count forward. Amounts are compared as exact
 * decimal strings via PostgreSQL numeric, never parsed into a JS number.
 */
export async function recordObservation(
  tx: DbOrTx,
  input: {
    walletAddressId: string;
    merchantId: string;
    network: ChainNetwork;
    txHash: string;
    outputIndex?: number;
    asset: string;
    amount: string;
    blockNumber?: number;
    confirmations: number;
    raw?: unknown;
  },
) {
  if (!/^\d+$/.test(input.amount)) {
    throw new ApiError(400, "invalid_request_error", "invalid_amount", "On-chain amounts must be whole numbers of base units.");
  }

  await tx
    .insert(chainObservations)
    .values({
      id: newId("chainObservation"),
      walletAddressId: input.walletAddressId,
      merchantId: input.merchantId,
      network: input.network,
      txHash: input.txHash,
      outputIndex: input.outputIndex ?? 0,
      asset: input.asset,
      amount: input.amount,
      blockNumber: input.blockNumber ?? null,
      confirmations: input.confirmations,
      raw: (input.raw ?? null) as never,
    })
    .onConflictDoUpdate({
      target: [chainObservations.network, chainObservations.txHash, chainObservations.outputIndex],
      set: {
        // Confirmations only ever move forward. A node that briefly reports a
        // lower count must not walk a settled payment backwards.
        confirmations: sql`greatest(${chainObservations.confirmations}, excluded.confirmations)`,
        blockNumber: sql`coalesce(excluded.block_number, ${chainObservations.blockNumber})`,
        orphaned: sql`false`,
        lastSeenAt: new Date(),
      },
    });

  return settleFromObservations(tx, input.walletAddressId);
}

/**
 * Recompute an address's status from its observations.
 *
 * Derived rather than accumulated: the total is a SUM over the observation
 * rows, so a reorg that orphans a row corrects the balance automatically, and
 * replaying the watcher can never double-count.
 */
export async function settleFromObservations(tx: DbOrTx, walletAddressId: string) {
  const [addr] = await tx.select().from(walletAddresses).where(eq(walletAddresses.id, walletAddressId)).limit(1);
  if (!addr) throw new ApiError(404, "not_found_error", "wallet_address_not_found", "Derived address not found.");

  const [totals] = await tx
    .select({
      confirmed: sql<string>`coalesce(sum(${chainObservations.amount}) filter (where ${chainObservations.orphaned} = false and ${chainObservations.confirmations} >= ${addr.confirmationsRequired}), 0)::text`,
      seen: sql<string>`coalesce(sum(${chainObservations.amount}) filter (where ${chainObservations.orphaned} = false), 0)::text`,
      any: sql<number>`count(*) filter (where ${chainObservations.orphaned} = false)`,
    })
    .from(chainObservations)
    .where(eq(chainObservations.walletAddressId, walletAddressId));

  const confirmed = totals?.confirmed ?? "0";
  const seen = totals?.seen ?? "0";
  const sawSomething = Number(totals?.any ?? 0) > 0;

  let status = addr.status;
  let settledAt = addr.settledAt;

  if (confirmed !== "0" && addr.expectedAmount) {
    // Exact decimal comparison, done as BigInt so no amount is ever rounded.
    const enough = BigInt(confirmed) >= BigInt(addr.expectedAmount);
    status = enough ? "settled" : "underpaid";
    if (enough && !settledAt) settledAt = new Date();
  } else if (confirmed !== "0") {
    status = "settled";
    if (!settledAt) settledAt = new Date();
  } else if (sawSomething) {
    status = "awaiting";
  }

  await tx
    .update(walletAddresses)
    .set({ observedAmount: seen, status, settledAt, firstSeenAt: addr.firstSeenAt ?? (sawSomething ? new Date() : null), updatedAt: new Date() })
    .where(eq(walletAddresses.id, walletAddressId));

  return { status, confirmedAmount: confirmed, observedAmount: seen, expectedAmount: addr.expectedAmount };
}
