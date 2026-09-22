import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { randomString } from "./ids.js";

function scryptAsync(password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, opts, (err, derived) => (err ? reject(err) : resolve(derived)));
  });
}

// ---------------------------------------------------------------------------
// Password hashing (scrypt, N=2^15, r=8, p=1). Format: scrypt$N$r$p$salt$hash
// ---------------------------------------------------------------------------
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 128 * 1024 * 1024 });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4]!, "base64");
  const expected = Buffer.from(parts[5]!, "base64");
  const derived = await scryptAsync(password, salt, expected.length, { N, r, p, maxmem: 128 * 1024 * 1024 });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

// ---------------------------------------------------------------------------
// Token hashing (API keys, session tokens). Tokens are high-entropy so SHA-256 is adequate.
// ---------------------------------------------------------------------------
export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacSha256Hex(secret: string | Buffer, value: string | Buffer): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ---------------------------------------------------------------------------
// API keys: natio_sk_test_<32 chars> / natio_sk_live_<32 chars>
//
// The vendor prefix is not decoration. A bare `sk_test_…` is byte-identical to
// Stripe's format, so every scanner that sees a leaked NATIO key attributes it
// to Stripe: the merchant is told to rotate the wrong credential, and NATIO can
// never be notified about its own leaked keys. A distinguishable prefix is what
// makes automated leak detection possible at all.
// ---------------------------------------------------------------------------
export const API_KEY_PATTERN = /^natio_sk_(test|live)_[0-9A-Za-z]{32}$/;

export function generateApiKey(mode: "test" | "live"): { secret: string; prefix: string; hash: string } {
  const body = randomString(32);
  const secret = `natio_sk_${mode}_${body}`;
  // "natio_sk_test_" + 4 body characters: enough for a human to tell two keys
  // apart in a list, far too little to reconstruct one.
  return { secret, prefix: secret.slice(0, 18), hash: sha256Hex(secret) };
}

export function generateWebhookSecret(): { secret: string; prefix: string } {
  const secret = `whsec_${randomString(40)}`;
  return { secret, prefix: secret.slice(0, 11) };
}

export function generateSessionToken(): string {
  return randomString(48);
}

// ---------------------------------------------------------------------------
// Symmetric encryption at rest (AES-256-GCM). Format: v1.<iv b64>.<tag b64>.<ciphertext b64>
// ---------------------------------------------------------------------------
export function encryptString(plain: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) throw new Error("encryption key must be 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

export function decryptString(payload: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const [version, ivB64, tagB64, ctB64] = payload.split(".");
  // The ciphertext segment is legitimately empty when the plaintext was "" (AES-GCM still produces an IV + tag).
  if (version !== "v1" || !ivB64 || !tagB64 || ctB64 === undefined) throw new Error("invalid encrypted payload");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]);
  return pt.toString("utf8");
}

export function encryptJson(value: unknown, keyHex: string): string {
  return encryptString(JSON.stringify(value), keyHex);
}

export function decryptJson<T = unknown>(payload: string, keyHex: string): T {
  return JSON.parse(decryptString(payload, keyHex)) as T;
}

// ---------------------------------------------------------------------------
// Webhook signatures: Natio-Signature: t=<unix seconds>,v1=<hex hmac sha256 of "<t>.<body>">
// ---------------------------------------------------------------------------
export function signWebhookPayload(secret: string, body: string, timestampSec = Math.floor(Date.now() / 1000)): string {
  const sig = hmacSha256Hex(secret, `${timestampSec}.${body}`);
  return `t=${timestampSec},v1=${sig}`;
}

export function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string | undefined,
  opts: { toleranceSec?: number; now?: number } = {},
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const idx = kv.indexOf("=");
      return [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()];
    }),
  ) as Record<string, string>;
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1) return false;
  const tolerance = opts.toleranceSec ?? 300;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > tolerance) return false;
  const expected = hmacSha256Hex(secret, `${t}.${body}`);
  return safeEqual(expected, v1);
}

/** Stable hash of a JSON body for idempotency comparison (key order independent). */
export function stableRequestHash(body: unknown): string {
  return sha256Hex(stableStringify(body));
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
