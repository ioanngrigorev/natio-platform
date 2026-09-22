/**
 * Deterministic address derivation from a merchant's own extended PUBLIC key.
 *
 * This is the load-bearing piece of the non-custodial design. NATIO never sees
 * a seed or a private key; it receives an extended public key, derives a fresh
 * receiving address per invoice, and watches it. Funds move payer → merchant
 * with no step in between, because there is no key here that could add one.
 *
 * Two failure modes are worth more attention than everything else combined:
 *
 *  1. Accepting a private key. An xprv looks almost exactly like an xpub and a
 *     merchant pasting the wrong one hands us custody we explicitly promise not
 *     to have. `assertWatchOnly` rejects it before anything is stored, in the
 *     same spirit as the platform's refusal to accept a raw card PAN.
 *
 *  2. Deriving the wrong ADDRESS TYPE. A zpub belongs to a native-segwit
 *     wallet; hand its owner a legacy P2PKH address and the coins land
 *     somewhere their wallet will never display. That is not a cosmetic bug,
 *     it is lost money. So the script type follows the key's own version bytes
 *     (SLIP-132) rather than a separate, forgettable setting.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, base58check, bech32 } from "@scure/base";
import { HDKey } from "@scure/bip32";
import { ApiError } from "../../lib/errors.js";

const b58check = base58check(sha256);

// ---------------------------------------------------------------------------
// Networks
// ---------------------------------------------------------------------------

export const CHAIN_NETWORKS = ["bitcoin", "ethereum", "bsc", "polygon", "tron"] as const;
export type ChainNetwork = (typeof CHAIN_NETWORKS)[number];

/** EVM chains share an address format, so they share a derivation path too. */
const EVM_NETWORKS: ReadonlySet<ChainNetwork> = new Set<ChainNetwork>(["ethereum", "bsc", "polygon"]);

export function isChainNetwork(value: string): value is ChainNetwork {
  return (CHAIN_NETWORKS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Extended key prefixes (SLIP-132)
//
// The prefix tells us three things at once: whether the key is public, which
// script type its owner's wallet expects, and which network it belongs to.
// ---------------------------------------------------------------------------

type ScriptType = "p2pkh" | "p2sh-p2wpkh" | "p2wpkh" | "account";

interface KeyKind {
  /** false for xprv/yprv/zprv/tprv and friends — these must never be accepted. */
  watchOnly: boolean;
  script: ScriptType;
  versions: { private: number; public: number };
  testnet: boolean;
}

const KEY_PREFIXES: Record<string, KeyKind> = {
  // Mainnet, public
  xpub: { watchOnly: true, script: "p2pkh", versions: { private: 0x0488ade4, public: 0x0488b21e }, testnet: false },
  ypub: { watchOnly: true, script: "p2sh-p2wpkh", versions: { private: 0x049d7878, public: 0x049d7cb2 }, testnet: false },
  zpub: { watchOnly: true, script: "p2wpkh", versions: { private: 0x04b2430c, public: 0x04b24746 }, testnet: false },
  // Testnet, public
  tpub: { watchOnly: true, script: "p2pkh", versions: { private: 0x04358394, public: 0x043587cf }, testnet: true },
  upub: { watchOnly: true, script: "p2sh-p2wpkh", versions: { private: 0x044a4e28, public: 0x044a5262 }, testnet: true },
  vpub: { watchOnly: true, script: "p2wpkh", versions: { private: 0x045f18bc, public: 0x045f1cf6 }, testnet: true },
  // Private counterparts, listed so the error can be specific rather than "malformed".
  xprv: { watchOnly: false, script: "p2pkh", versions: { private: 0x0488ade4, public: 0x0488b21e }, testnet: false },
  yprv: { watchOnly: false, script: "p2sh-p2wpkh", versions: { private: 0x049d7878, public: 0x049d7cb2 }, testnet: false },
  zprv: { watchOnly: false, script: "p2wpkh", versions: { private: 0x04b2430c, public: 0x04b24746 }, testnet: false },
  tprv: { watchOnly: false, script: "p2pkh", versions: { private: 0x04358394, public: 0x043587cf }, testnet: true },
  uprv: { watchOnly: false, script: "p2sh-p2wpkh", versions: { private: 0x044a4e28, public: 0x044a5262 }, testnet: true },
  vprv: { watchOnly: false, script: "p2wpkh", versions: { private: 0x045f18bc, public: 0x045f1cf6 }, testnet: true },
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Reject anything that could give NATIO spending power, loudly and before it
 * is persisted. Mirrors the PAN guard on the payments side: the safest way to
 * never leak a secret is to refuse to hold one.
 */
export function assertWatchOnly(key: string): void {
  const trimmed = key.trim();
  if (trimmed.length < 4) {
    throw new ApiError(400, "invalid_request_error", "invalid_extended_key", "That does not look like an extended public key.");
  }
  const prefix = trimmed.slice(0, 4).toLowerCase();
  const kind = KEY_PREFIXES[prefix];

  if (kind && !kind.watchOnly) {
    throw new ApiError(
      400,
      "invalid_request_error",
      "private_key_rejected",
      "That is an extended PRIVATE key. NATIO never accepts one and has no use for it — share the matching public key (xpub, ypub or zpub) instead, and treat the key you just pasted as compromised.",
    );
  }

  // Seed phrases get pasted into the wrong box too, and a 12/24-word string is
  // unmistakable. Better to name the mistake than to fail on base58 decoding.
  const words = trimmed.split(/\s+/);
  if (words.length >= 12 && words.every((w) => /^[a-z]{3,8}$/i.test(w))) {
    throw new ApiError(
      400,
      "invalid_request_error",
      "private_key_rejected",
      "That looks like a recovery phrase. NATIO never accepts one. Treat it as compromised and move your funds to a new wallet.",
    );
  }

  if (!kind) {
    throw new ApiError(
      400,
      "invalid_request_error",
      "invalid_extended_key",
      `Unrecognised extended key prefix "${trimmed.slice(0, 4)}". Expected one of: ${Object.entries(KEY_PREFIXES)
        .filter(([, k]) => k.watchOnly)
        .map(([p]) => p)
        .join(", ")}.`,
    );
  }
}

export interface ParsedExtendedKey {
  hd: HDKey;
  script: ScriptType;
  testnet: boolean;
  prefix: string;
}

/** Parse after validating. Throws ApiError for anything unusable. */
export function parseExtendedPublicKey(key: string): ParsedExtendedKey {
  assertWatchOnly(key);
  const trimmed = key.trim();
  const prefix = trimmed.slice(0, 4).toLowerCase();
  const kind = KEY_PREFIXES[prefix]!;

  let hd: HDKey;
  try {
    hd = HDKey.fromExtendedKey(trimmed, kind.versions);
  } catch (err) {
    throw new ApiError(400, "invalid_request_error", "invalid_extended_key", `Extended key failed to decode: ${err instanceof Error ? err.message : "malformed"}.`);
  }

  // Belt and braces: the prefix table should have caught a private key, but a
  // library that parsed one anyway must not get past this line.
  if (hd.privateKey) {
    throw new ApiError(400, "invalid_request_error", "private_key_rejected", "That key carries private material. NATIO never accepts one.");
  }
  if (!hd.publicKey) {
    throw new ApiError(400, "invalid_request_error", "invalid_extended_key", "Extended key carries no public key.");
  }

  return { hd, script: kind.script, testnet: kind.testnet, prefix };
}

// ---------------------------------------------------------------------------
// Address encoding
// ---------------------------------------------------------------------------

function hash160(pubkey: Uint8Array): Uint8Array {
  return ripemd160(sha256(pubkey));
}

/** secp256k1 compressed (33 bytes) → uncompressed body (64 bytes, no 0x04). */
function uncompressedBody(compressed: Uint8Array): Uint8Array {
  return secp256k1.Point.fromBytes(compressed).toBytes(false).slice(1);
}

/** EIP-55: mixed-case checksum. Wallets show it; comparing addresses ignores it. */
function toChecksumAddress(hexNoPrefix: string): string {
  const lower = hexNoPrefix.toLowerCase();
  const hash = keccak_256(new TextEncoder().encode(lower));
  let out = "";
  for (let i = 0; i < lower.length; i++) {
    const nibble = (hash[i >> 1]! >> (i % 2 === 0 ? 4 : 0)) & 0xf;
    out += nibble >= 8 ? lower[i]!.toUpperCase() : lower[i]!;
  }
  return `0x${out}`;
}

function evmAddress(compressed: Uint8Array): string {
  const digest = keccak_256(uncompressedBody(compressed));
  return toChecksumAddress(Buffer.from(digest.slice(-20)).toString("hex"));
}

/** TRON reuses the Ethereum hash and re-encodes it as base58check with a 0x41 prefix. */
function tronAddress(compressed: Uint8Array): string {
  const digest = keccak_256(uncompressedBody(compressed));
  const payload = new Uint8Array(21);
  payload[0] = 0x41;
  payload.set(digest.slice(-20), 1);
  return b58check.encode(payload);
}

function bitcoinAddress(compressed: Uint8Array, script: ScriptType, testnet: boolean): string {
  const h160 = hash160(compressed);
  switch (script) {
    case "p2wpkh": {
      const words = [0, ...bech32.toWords(h160)];
      return bech32.encode(testnet ? "tb" : "bc", words);
    }
    case "p2sh-p2wpkh": {
      // P2SH wrapping a P2WPKH: redeem script is OP_0 PUSH20 <hash160>.
      const redeem = new Uint8Array(22);
      redeem[0] = 0x00;
      redeem[1] = 0x14;
      redeem.set(h160, 2);
      const payload = new Uint8Array(21);
      payload[0] = testnet ? 0xc4 : 0x05;
      payload.set(hash160(redeem), 1);
      return b58check.encode(payload);
    }
    case "p2pkh":
    default: {
      const payload = new Uint8Array(21);
      payload[0] = testnet ? 0x6f : 0x00;
      payload.set(h160, 1);
      return b58check.encode(payload);
    }
  }
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

export interface DerivedAddress {
  index: number;
  address: string;
  /** Relative to the account-level key the merchant supplied, e.g. "0/41". */
  path: string;
}

/**
 * Merchants supply an ACCOUNT-level key (the level wallets export: m/84'/0'/0'
 * for Bitcoin, m/44'/60'/0' for EVM, m/44'/195'/0' for TRON), so the remaining
 * derivation is the non-hardened `change/index` pair — which is exactly the
 * part an extended public key can do on its own.
 *
 * `change` is 0 for receiving addresses. We never derive change addresses; the
 * merchant's own wallet owns that side.
 */
export function deriveAddress(extendedKey: string, network: ChainNetwork, index: number): DerivedAddress {
  if (!Number.isInteger(index) || index < 0 || index > 0x7fffffff) {
    throw new ApiError(400, "invalid_request_error", "invalid_derivation_index", "Derivation index must be a non-negative integer below 2^31.");
  }
  const parsed = parseExtendedPublicKey(extendedKey);

  const child = parsed.hd.deriveChild(0).deriveChild(index);
  const compressed = child.publicKey;
  if (!compressed) {
    throw new ApiError(500, "internal_error", "derivation_failed", "Child key produced no public key.");
  }

  let address: string;
  if (network === "bitcoin") {
    address = bitcoinAddress(compressed, parsed.script, parsed.testnet);
  } else if (network === "tron") {
    address = tronAddress(compressed);
  } else if (EVM_NETWORKS.has(network)) {
    address = evmAddress(compressed);
  } else {
    throw new ApiError(400, "invalid_request_error", "unsupported_network", `No address encoding for network "${network}".`);
  }

  return { index, address, path: `0/${index}` };
}

/** Derive a contiguous range. Used when pre-filling an address pool. */
export function deriveRange(extendedKey: string, network: ChainNetwork, from: number, count: number): DerivedAddress[] {
  if (count < 0 || count > 1000) {
    throw new ApiError(400, "invalid_request_error", "invalid_range", "Derive at most 1000 addresses at a time.");
  }
  const out: DerivedAddress[] = [];
  for (let i = 0; i < count; i++) out.push(deriveAddress(extendedKey, network, from + i));
  return out;
}

// ---------------------------------------------------------------------------
// Address validation (for merchant-supplied payout destinations)
// ---------------------------------------------------------------------------

export function isValidAddress(address: string, network: ChainNetwork): boolean {
  const value = address.trim();
  try {
    if (network === "tron") {
      const raw = b58check.decode(value);
      return raw.length === 21 && raw[0] === 0x41;
    }
    if (EVM_NETWORKS.has(network)) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return false;
      // A mixed-case address carries a checksum; an all-one-case one does not.
      const body = value.slice(2);
      if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
      return toChecksumAddress(body.toLowerCase()) === value;
    }
    if (network === "bitcoin") {
      if (/^(bc1|tb1)/i.test(value)) {
        const decoded = bech32.decode(value as `${string}1${string}`);
        return decoded.words.length > 1 && decoded.words[0] === 0;
      }
      const raw = b58check.decode(value);
      return raw.length === 21 && [0x00, 0x05, 0x6f, 0xc4].includes(raw[0]!);
    }
    return false;
  } catch {
    return false;
  }
}

/** Exported for tests and for the admin tooling that inspects a stored key. */
export const __internals = { toChecksumAddress, hash160, base58 };
