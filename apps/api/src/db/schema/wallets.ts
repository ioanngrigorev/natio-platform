import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { chainNetworkEnum, modeEnum, walletAccountStatusEnum, walletAddressStatusEnum } from "./enums.js";
import { merchants } from "./merchants.js";
import { payments } from "./payments.js";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * On-chain amounts are stored as exact decimal strings in the asset's BASE
 * units, never as a JS number. An 18-decimal token balance exceeds what a
 * double can represent exactly, and "close enough" is not a property anyone
 * wants in a payment ledger. numeric(78,0) covers a full uint256.
 */
const baseUnits = (name: string) => numeric(name, { precision: 78, scale: 0 });

/**
 * A merchant's own settlement destination on one network.
 *
 * `extendedKey` is a WATCH-ONLY extended public key. It cannot sign, so this
 * table gives NATIO no ability to move funds — that is the entire point of the
 * design. It is still encrypted at rest, because an xpub reveals every address
 * the merchant will ever use and their whole balance history. That is a privacy
 * leak worth preventing even though it is not a custody risk.
 */
export const walletAccounts = pgTable(
  "wallet_accounts",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    mode: modeEnum("mode").notNull(),
    label: text("label").notNull(),
    network: chainNetworkEnum("network").notNull(),
    /** Asset ticker, e.g. "BTC", "USDT", "ETH". Contract details live in asset config. */
    asset: text("asset").notNull(),
    /** AES-256-GCM ciphertext of the xpub/ypub/zpub. Never a private key. */
    extendedKey: text("extended_key").notNull(),
    /**
     * sha256 of the plaintext key. Lets us detect "this xpub is already
     * registered" — including by a different merchant, which is a strong signal
     * of a copy-pasted key and of funds about to land in the wrong place —
     * without decrypting anything.
     */
    keyFingerprint: text("key_fingerprint").notNull(),
    /** Derived from the key's own SLIP-132 version bytes, stored for display. */
    scriptType: text("script_type").notNull(),
    /**
     * Next unused derivation index. Handing the same address to two invoices
     * would make attribution ambiguous, so this only ever moves forward, and
     * it moves inside the transaction that reserves the address.
     */
    nextIndex: integer("next_index").notNull().default(0),
    status: walletAccountStatusEnum("status").notNull().default("active"),
    /** Set once the merchant has confirmed an address from this key resolves in their wallet. */
    verifiedAt: ts("verified_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("wallet_accounts_merchant_idx").on(t.merchantId, t.mode, t.network),
    // One live registration per key per merchant. Re-adding a rotated key is
    // possible once the old account is archived.
    uniqueIndex("wallet_accounts_fingerprint_idx").on(t.merchantId, t.keyFingerprint, t.mode),
  ],
);

/**
 * One derived receiving address, reserved for at most one payment.
 *
 * The uniqueness constraints here are load-bearing rather than hygienic. Two
 * invoices sharing an address makes it impossible to say which customer paid,
 * and reusing an index silently rewrites an address a customer may already
 * have sent to.
 */
export const walletAddresses = pgTable(
  "wallet_addresses",
  {
    id: text("id").primaryKey(),
    walletAccountId: text("wallet_account_id")
      .notNull()
      .references(() => walletAccounts.id),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    mode: modeEnum("mode").notNull(),
    network: chainNetworkEnum("network").notNull(),
    asset: text("asset").notNull(),
    derivationIndex: integer("derivation_index").notNull(),
    /** Full relative path from the account key, e.g. "0/418". */
    derivationPath: text("derivation_path").notNull(),
    address: text("address").notNull(),
    paymentId: text("payment_id").references(() => payments.id),
    status: walletAddressStatusEnum("status").notNull().default("reserved"),
    /** What the payer was told to send, in base units. */
    expectedAmount: baseUnits("expected_amount"),
    /** What actually arrived, summed across confirmed observations. */
    observedAmount: baseUnits("observed_amount").notNull().default("0"),
    confirmationsRequired: integer("confirmations_required").notNull(),
    /**
     * An expired address is never handed out again. Funds sent late still
     * belong to the merchant — they arrive at the merchant's own wallet — but
     * they no longer settle an invoice automatically.
     */
    expiresAt: ts("expires_at"),
    firstSeenAt: ts("first_seen_at"),
    settledAt: ts("settled_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("wallet_addresses_index_idx").on(t.walletAccountId, t.derivationIndex),
    uniqueIndex("wallet_addresses_address_idx").on(t.network, t.address),
    uniqueIndex("wallet_addresses_payment_idx").on(t.paymentId),
    index("wallet_addresses_watch_idx").on(t.status, t.network),
    index("wallet_addresses_merchant_idx").on(t.merchantId, t.mode, t.createdAt),
  ],
);

/**
 * What the chain actually showed us.
 *
 * Confirmations accumulate and a reorg orphans a row, so these rows are not
 * frozen — but the financial fact is. A database trigger rejects any change to
 * the transaction hash, output index, asset or amount, and rejects deletes
 * outright. Without that, "the chain said so" would stop being evidence.
 */
export const chainObservations = pgTable(
  "chain_observations",
  {
    id: text("id").primaryKey(),
    walletAddressId: text("wallet_address_id")
      .notNull()
      .references(() => walletAddresses.id),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    network: chainNetworkEnum("network").notNull(),
    txHash: text("tx_hash").notNull(),
    /** Output index for UTXO chains; log index for token transfers; 0 otherwise. */
    outputIndex: integer("output_index").notNull().default(0),
    asset: text("asset").notNull(),
    amount: baseUnits("amount").notNull(),
    blockNumber: integer("block_number"),
    confirmations: integer("confirmations").notNull().default(0),
    /** Cleared by a reorg; a superseded observation stops counting toward the total. */
    orphaned: boolean("orphaned").notNull().default(false),
    raw: jsonb("raw"),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [
    // The watcher re-reads the same transaction on every poll, so this is what
    // makes repeated observation idempotent rather than cumulative.
    uniqueIndex("chain_observations_tx_idx").on(t.network, t.txHash, t.outputIndex),
    index("chain_observations_address_idx").on(t.walletAddressId),
  ],
);
