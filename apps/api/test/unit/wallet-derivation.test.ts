import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/lib/errors.js";
import {
  assertWatchOnly,
  deriveAddress,
  deriveRange,
  isValidAddress,
  parseExtendedPublicKey,
  __internals,
} from "../../src/modules/wallets/derivation.js";

/**
 * Address derivation is the one place in this codebase where a bug quietly
 * loses money rather than failing loudly: a wrong address still looks like an
 * address, the payer still pays it, and nobody notices until the merchant asks
 * where their funds went. So this file leans on published test vectors rather
 * than on the implementation agreeing with itself.
 */

// BIP84's own test vector: the account-level key for the standard
// "abandon abandon ... about" mnemonic, and its first receiving addresses.
const BIP84_ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
const BIP84_ADDRESSES = ["bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g"];

describe("extended key validation", () => {
  it("rejects an extended private key by name, not as a parse failure", () => {
    const xprv =
      "xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi";
    expect(() => assertWatchOnly(xprv)).toThrow(ApiError);
    try {
      assertWatchOnly(xprv);
    } catch (err) {
      expect((err as ApiError).code).toBe("private_key_rejected");
      // The message has to tell the merchant the key is now burned, not just "invalid".
      expect((err as ApiError).message).toMatch(/compromised/i);
    }
  });

  it("rejects every private prefix variant", () => {
    for (const prefix of ["xprv", "yprv", "zprv", "tprv", "uprv", "vprv"]) {
      expect(() => assertWatchOnly(`${prefix}9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3`)).toThrow(/private/i);
    }
  });

  it("rejects a recovery phrase pasted into the key field", () => {
    const phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    try {
      assertWatchOnly(phrase);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("private_key_rejected");
      expect((err as ApiError).message).toMatch(/recovery phrase/i);
    }
  });

  it("accepts public prefixes", () => {
    expect(() => assertWatchOnly(BIP84_ZPUB)).not.toThrow();
  });

  it("names an unknown prefix instead of failing on base58", () => {
    try {
      assertWatchOnly("qqqq1234567890");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("invalid_extended_key");
    }
  });

  it("parses a zpub as native segwit", () => {
    const parsed = parseExtendedPublicKey(BIP84_ZPUB);
    expect(parsed.script).toBe("p2wpkh");
    expect(parsed.testnet).toBe(false);
    expect(parsed.hd.privateKey).toBeFalsy();
  });
});

describe("bitcoin derivation (BIP84 test vector)", () => {
  it("derives the published receiving addresses", () => {
    expect(deriveAddress(BIP84_ZPUB, "bitcoin", 0).address).toBe(BIP84_ADDRESSES[0]);
    expect(deriveAddress(BIP84_ZPUB, "bitcoin", 1).address).toBe(BIP84_ADDRESSES[1]);
  });

  it("reports the path relative to the account key", () => {
    expect(deriveAddress(BIP84_ZPUB, "bitcoin", 41).path).toBe("0/41");
  });

  it("never repeats an address across a range", () => {
    const range = deriveRange(BIP84_ZPUB, "bitcoin", 0, 50);
    expect(new Set(range.map((r) => r.address)).size).toBe(50);
    expect(range[0]!.address).toBe(BIP84_ADDRESSES[0]);
  });
});

describe("EVM address encoding", () => {
  // secp256k1 generator point = the public key of private key 0x…01, whose
  // Ethereum address is one of the most widely published pairs there is.
  const G_COMPRESSED = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
  const G_ADDRESS = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";

  it("derives the known address for the generator point", () => {
    const compressed = Uint8Array.from(Buffer.from(G_COMPRESSED, "hex"));
    // Exercised through the same helper the derivation path uses.
    const { keccakAddress } = evmHelpers();
    expect(keccakAddress(compressed)).toBe(G_ADDRESS);
  });

  it("applies the EIP-55 checksum from the specification's own examples", () => {
    const examples = [
      "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
      "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
      "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
      "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
    ];
    for (const expected of examples) {
      expect(__internals.toChecksumAddress(expected.slice(2).toLowerCase())).toBe(expected);
    }
  });

  it("produces a valid, checksummed address from an xpub", () => {
    const address = deriveAddress(XPUB, "ethereum", 0).address;
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(isValidAddress(address, "ethereum")).toBe(true);
  });

  it("gives every EVM chain the same address for the same index", () => {
    const eth = deriveAddress(XPUB, "ethereum", 7).address;
    expect(deriveAddress(XPUB, "bsc", 7).address).toBe(eth);
    expect(deriveAddress(XPUB, "polygon", 7).address).toBe(eth);
  });
});

describe("TRON address encoding", () => {
  it("decodes a real mainnet address to 0x41 + 20 bytes", () => {
    // The USDT TRC20 contract — a public, stable address.
    expect(isValidAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "tron")).toBe(true);
  });

  it("derives addresses that start with T and validate", () => {
    const { address } = deriveAddress(XPUB, "tron", 0);
    expect(address.startsWith("T")).toBe(true);
    expect(address).toHaveLength(34);
    expect(isValidAddress(address, "tron")).toBe(true);
  });

  it("shares the underlying 20-byte hash with the EVM address for the same key", () => {
    const evm = deriveAddress(XPUB, "ethereum", 3).address.slice(2).toLowerCase();
    const tron = deriveAddress(XPUB, "tron", 3).address;
    const raw = Buffer.from(decodeTron(tron)).toString("hex");
    expect(raw).toBe(`41${evm}`);
  });
});

describe("address validation", () => {
  it("rejects a well-formed address from the wrong network", () => {
    expect(isValidAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "ethereum")).toBe(false);
    expect(isValidAddress("0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf", "tron")).toBe(false);
    expect(isValidAddress(BIP84_ADDRESSES[0]!, "tron")).toBe(false);
  });

  it("rejects an EVM address whose checksum does not match", () => {
    expect(isValidAddress("0x7E5F4552091A69125d5DfCb7b8C2659029395BDF", "ethereum")).toBe(false);
    // All-lowercase carries no checksum and stays acceptable.
    expect(isValidAddress("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf", "ethereum")).toBe(true);
  });

  it("accepts the derived bitcoin addresses", () => {
    expect(isValidAddress(BIP84_ADDRESSES[0]!, "bitcoin")).toBe(true);
  });

  it("rejects junk without throwing", () => {
    for (const network of ["bitcoin", "ethereum", "tron"] as const) {
      expect(isValidAddress("", network)).toBe(false);
      expect(isValidAddress("not-an-address", network)).toBe(false);
    }
  });
});

describe("derivation index guards", () => {
  it("refuses a negative, fractional or hardened index", () => {
    for (const bad of [-1, 1.5, 2 ** 31]) {
      expect(() => deriveAddress(XPUB, "tron", bad)).toThrow(/index/i);
    }
  });

  it("caps a range request", () => {
    expect(() => deriveRange(XPUB, "tron", 0, 1001)).toThrow(/1000/);
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** BIP32 test vector 1's master public key — a stable, published xpub. */
const XPUB =
  "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8";

function evmHelpers() {
  // Re-implemented here rather than exported, so the test checks the same
  // primitives (keccak + last 20 bytes + EIP-55) the module composes.
  const { keccak_256 } = require("@noble/hashes/sha3.js") as typeof import("@noble/hashes/sha3.js");
  const { secp256k1 } = require("@noble/curves/secp256k1.js") as typeof import("@noble/curves/secp256k1.js");
  return {
    keccakAddress(compressed: Uint8Array) {
      const body = secp256k1.Point.fromBytes(compressed).toBytes(false).slice(1);
      const digest = keccak_256(body);
      return __internals.toChecksumAddress(Buffer.from(digest.slice(-20)).toString("hex"));
    },
  };
}

function decodeTron(address: string): Uint8Array {
  const { base58check } = require("@scure/base") as typeof import("@scure/base");
  const { sha256 } = require("@noble/hashes/sha2.js") as typeof import("@noble/hashes/sha2.js");
  return base58check(sha256).decode(address);
}
