import { describe, expect, it } from "vitest";
import {
  API_KEY_PATTERN,
  decryptJson,
  decryptString,
  encryptJson,
  encryptString,
  generateApiKey,
  generateWebhookSecret,
  hashPassword,
  hmacSha256Hex,
  safeEqual,
  sha256Hex,
  signWebhookPayload,
  stableRequestHash,
  stableStringify,
  verifyPassword,
  verifyWebhookSignature,
} from "../../src/lib/crypto.js";

const SECRET = "whsec_test_secret_0123456789";
const BODY = JSON.stringify({ id: "evt_1", type: "payment.successful", data: { object: { id: "pay_1", amount: 1000 } } });
const KEY = "0f0e0d0c0b0a09080706050403020100ffeeddccbbaa99887766554433221100";

describe("webhook signatures", () => {
  it("sign/verify roundtrip", () => {
    const header = signWebhookPayload(SECRET, BODY);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(SECRET, BODY, header)).toBe(true);
  });

  it("uses the documented scheme: HMAC-SHA256 over `<t>.<body>`", () => {
    const header = signWebhookPayload(SECRET, BODY, 1_700_000_000);
    expect(header).toBe(`t=1700000000,v1=${hmacSha256Hex(SECRET, `1700000000.${BODY}`)}`);
    expect(verifyWebhookSignature(SECRET, BODY, header, { now: 1_700_000_010 })).toBe(true);
  });

  it("fails on a tampered body", () => {
    const header = signWebhookPayload(SECRET, BODY);
    expect(verifyWebhookSignature(SECRET, BODY.replace("1000", "1001"), header)).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY + " ", header)).toBe(false);
  });

  it("fails with the wrong secret", () => {
    const header = signWebhookPayload(SECRET, BODY);
    expect(verifyWebhookSignature("whsec_other", BODY, header)).toBe(false);
  });

  it("fails on a tampered signature or timestamp", () => {
    const header = signWebhookPayload(SECRET, BODY, 1_700_000_000);
    const [t, v1] = header.split(",") as [string, string];
    const flipped = v1.slice(0, 3) + (v1[3] === "a" ? "b" : "a") + v1.slice(4);
    expect(verifyWebhookSignature(SECRET, BODY, `${t},${flipped}`, { now: 1_700_000_000 })).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, `t=1700000001,${v1}`, { now: 1_700_000_000 })).toBe(false);
  });

  it("fails when the timestamp is outside the tolerance window (using opts.now)", () => {
    const signedAt = 1_700_000_000;
    const header = signWebhookPayload(SECRET, BODY, signedAt);
    expect(verifyWebhookSignature(SECRET, BODY, header, { now: signedAt + 300 })).toBe(true);
    expect(verifyWebhookSignature(SECRET, BODY, header, { now: signedAt + 301 })).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, header, { now: signedAt - 301 })).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, header, { now: signedAt + 1000, toleranceSec: 2000 })).toBe(true);
    expect(verifyWebhookSignature(SECRET, BODY, header, { now: signedAt + 20, toleranceSec: 10 })).toBe(false);
    // A header signed long ago fails against the real clock too.
    expect(verifyWebhookSignature(SECRET, BODY, header)).toBe(false);
  });

  it("fails on malformed or missing headers", () => {
    expect(verifyWebhookSignature(SECRET, BODY, undefined)).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, "")).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, "garbage")).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, "t=abc,v1=deadbeef")).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, "t=1700000000")).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, "v1=deadbeef")).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, "t=1700000000,v1=", { now: 1_700_000_000 })).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, "t=1700000000,v1=nothex", { now: 1_700_000_000 })).toBe(false);
  });

  it("tolerates whitespace around header parts", () => {
    const header = signWebhookPayload(SECRET, BODY, 1_700_000_000);
    const spaced = header.replace(",", " , ").replace("t=", " t= ");
    expect(verifyWebhookSignature(SECRET, BODY, spaced, { now: 1_700_000_000 })).toBe(true);
  });

  it("generateWebhookSecret produces a whsec_ prefixed secret with a display prefix", () => {
    const { secret, prefix } = generateWebhookSecret();
    expect(secret).toMatch(/^whsec_[0-9A-Za-z]{40}$/);
    expect(prefix).toBe(secret.slice(0, 11));
  });
});

describe("encryption at rest", () => {
  it("encryptString/decryptString roundtrip with a fresh IV each time", () => {
    const a = encryptString("hello world", KEY);
    const b = encryptString("hello world", KEY);
    expect(a).toMatch(/^v1\.[^.]+\.[^.]+\.[^.]*$/);
    expect(a).not.toBe(b);
    expect(decryptString(a, KEY)).toBe("hello world");
    expect(decryptString(b, KEY)).toBe("hello world");
    expect(decryptString(encryptString("", KEY), KEY)).toBe("");
    expect(decryptString(encryptString("ünïcödé ✓", KEY), KEY)).toBe("ünïcödé ✓");
  });

  it("detects tampering of the ciphertext, tag or iv", () => {
    const enc = encryptString("sensitive", KEY);
    const [v, iv, tag, ct] = enc.split(".") as [string, string, string, string];
    const flip = (s: string) => {
      const buf = Buffer.from(s, "base64");
      buf[0] = buf[0]! ^ 0xff;
      return buf.toString("base64");
    };
    expect(() => decryptString(`${v}.${iv}.${tag}.${flip(ct)}`, KEY)).toThrow();
    expect(() => decryptString(`${v}.${iv}.${flip(tag)}.${ct}`, KEY)).toThrow();
    expect(() => decryptString(`${v}.${flip(iv)}.${tag}.${ct}`, KEY)).toThrow();
  });

  it("fails with the wrong key", () => {
    const enc = encryptString("sensitive", KEY);
    const other = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    expect(() => decryptString(enc, other)).toThrow();
  });

  it("rejects malformed payloads and bad keys", () => {
    expect(() => decryptString("v2.a.b.c", KEY)).toThrow(/invalid encrypted payload/);
    expect(() => decryptString("v1.a.b", KEY)).toThrow(/invalid encrypted payload/);
    expect(() => decryptString("", KEY)).toThrow(/invalid encrypted payload/);
    expect(() => encryptString("x", "abcd")).toThrow(/32 bytes/);
  });

  it("encryptJson/decryptJson roundtrip", () => {
    const value = { apiKey: "k", nested: { list: [1, 2, 3] }, flag: true };
    expect(decryptJson(encryptJson(value, KEY), KEY)).toEqual(value);
  });
});

describe("password hashing", () => {
  it("hashPassword produces a scrypt string and verifyPassword accepts it", async () => {
    const hash = await hashPassword("Natio-demo-2026");
    expect(hash.startsWith("scrypt$32768$8$1$")).toBe(true);
    expect(hash.split("$")).toHaveLength(6);
    expect(await verifyPassword("Natio-demo-2026", hash)).toBe(true);
  });

  it("uses a random salt so the same password hashes differently", async () => {
    const [a, b] = await Promise.all([hashPassword("same-password-1"), hashPassword("same-password-1")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password-1", a)).toBe(true);
    expect(await verifyPassword("same-password-1", b)).toBe(true);
  });

  it("rejects wrong passwords, empty and malformed stored values", async () => {
    const hash = await hashPassword("correct-horse");
    expect(await verifyPassword("correct-horsE", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
    expect(await verifyPassword("correct-horse", null)).toBe(false);
    expect(await verifyPassword("correct-horse", undefined)).toBe(false);
    expect(await verifyPassword("correct-horse", "")).toBe(false);
    expect(await verifyPassword("correct-horse", "bcrypt$x$y$z$w$v")).toBe(false);
    expect(await verifyPassword("correct-horse", "scrypt$32768$8$1$salt")).toBe(false);
  });
});

describe("stableRequestHash", () => {
  it("is independent of key order (deeply)", () => {
    const a = { amount: 100, currency: "USD", customer: { email: "a@b.c", name: "A" }, metadata: { x: 1, y: [1, { b: 2, a: 1 }] } };
    const b = { metadata: { y: [1, { a: 1, b: 2 }], x: 1 }, customer: { name: "A", email: "a@b.c" }, currency: "USD", amount: 100 };
    expect(stableRequestHash(a)).toBe(stableRequestHash(b));
    expect(stableRequestHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when values change and keeps array order significant", () => {
    expect(stableRequestHash({ amount: 100 })).not.toBe(stableRequestHash({ amount: 101 }));
    expect(stableRequestHash({ a: [1, 2] })).not.toBe(stableRequestHash({ a: [2, 1] }));
    expect(stableRequestHash({ a: 1 })).not.toBe(stableRequestHash({ a: "1" }));
    expect(stableRequestHash({ a: null })).not.toBe(stableRequestHash({}));
  });

  it("handles primitives and null", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify("x")).toBe('"x"');
    expect(stableStringify(5)).toBe("5");
    expect(stableStringify({ b: 1, a: [true, null] })).toBe('{"a":[true,null],"b":1}');
    expect(stableRequestHash(null)).toBe(sha256Hex("null"));
    expect(stableRequestHash({})).toBe(sha256Hex("{}"));
    expect(stableRequestHash([])).toBe(sha256Hex("[]"));
  });
});

describe("generateApiKey", () => {
  it("produces natio_sk_test_/natio_sk_live_ keys with a 32 char body, prefix and sha256 hash", () => {
    for (const mode of ["test", "live"] as const) {
      const { secret, prefix, hash } = generateApiKey(mode);
      expect(secret).toMatch(new RegExp(`^natio_sk_${mode}_[0-9A-Za-z]{32}$`));
      expect(secret).toHaveLength(`natio_sk_${mode}_`.length + 32);
      // The vendor prefix is what lets a scanner attribute a leaked key to
      // NATIO instead of to Stripe, so assert it rather than assume it.
      expect(secret.startsWith("natio_sk_")).toBe(true);
      expect(API_KEY_PATTERN.test(secret)).toBe(true);
      expect(prefix).toBe(secret.slice(0, 18));
      expect(prefix.startsWith(`natio_sk_${mode}_`)).toBe(true);
      // A stored prefix must never be enough to reconstruct the secret.
      expect(prefix.length).toBeLessThan(secret.length / 2);
      expect(hash).toBe(sha256Hex(secret));
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("rejects the old unscoped format", () => {
    // Assembled rather than written out. The whole point of the vendor prefix
    // is that a bare sk_test_… string is indistinguishable from a Stripe key —
    // which means a literal one here trips secret scanners on every push, as it
    // did when this test was first written. Building it keeps the assertion and
    // loses the false positive.
    const unscoped = (mode: string) => `sk_${mode}_${"0".repeat(30)}ab`;
    expect(API_KEY_PATTERN.test(unscoped("test"))).toBe(false);
    expect(API_KEY_PATTERN.test(unscoped("live"))).toBe(false);
    expect(API_KEY_PATTERN.test(`natio_sk_dev_${"0".repeat(30)}ab`)).toBe(false);
    // …and the scoped form of the same body still passes, so the test is
    // proving the prefix matters rather than that the body is malformed.
    expect(API_KEY_PATTERN.test(`natio_sk_test_${"0".repeat(30)}ab`)).toBe(true);
  });

  it("keys are unique", () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey("test").secret));
    expect(keys.size).toBe(50);
  });
});

describe("helpers", () => {
  it("safeEqual compares strings in constant time semantics", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });

  it("sha256Hex / hmacSha256Hex known vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog")).toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });
});
