import "./env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { loadConfig } from "../../src/config.js";
import { closeDb, getDb } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { runSeed } from "../../src/db/seed.js";
import { platformKeyFingerprints, providerAccounts, walletAccounts, webhookEndpoints } from "../../src/db/schema/index.js";
import { decryptString, encryptString } from "../../src/lib/crypto.js";
import { assertEncryptionKeyMatches, EncryptionKeyMismatchError, encryptionKeyFingerprint } from "../../src/lib/encryption-guard.js";
import { rotateEncryptionKey } from "../../src/db/rotate-key.js";
import { registerWalletAccount } from "../../src/modules/wallets/service.js";
import { createEndpoint } from "../../src/modules/webhooks/service.js";
import { HDKey } from "@scure/bip32";
import { eq } from "drizzle-orm";

/**
 * The guard exists to turn a silent catastrophe into a refusal to boot, so the
 * test that matters is the one where the key is wrong. A test that only proved
 * the happy path would pass with the whole check deleted.
 */

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const XPUB =
  "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8";

let merchantId = "";
let projectId = "";

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await runMigrations();
  const seed = await runSeed();
  merchantId = seed.merchantId;
  projectId = seed.projectId;
}, 180_000);

afterAll(async () => {
  await closeDb();
});

describe("the encryption key guard", () => {
  it("records the fingerprint the first time it sees a database", async () => {
    const db = getDb();
    await db.delete(platformKeyFingerprints);

    const outcome = await assertEncryptionKeyMatches(db, KEY_A);
    expect(outcome).toBe("recorded");

    const [row] = await db.select().from(platformKeyFingerprints);
    expect(row!.fingerprint).toBe(encryptionKeyFingerprint(KEY_A));
    // The key itself must not be recoverable from what is stored.
    expect(row!.fingerprint).not.toContain(KEY_A);
  });

  it("accepts the same key on every subsequent start", async () => {
    expect(await assertEncryptionKeyMatches(getDb(), KEY_A)).toBe("verified");
    expect(await assertEncryptionKeyMatches(getDb(), KEY_A)).toBe("verified");
  });

  it("is case-insensitive about the same key written differently", async () => {
    expect(await assertEncryptionKeyMatches(getDb(), KEY_A.toUpperCase())).toBe("verified");
  });

  it("REFUSES a different key — the whole point", async () => {
    await expect(assertEncryptionKeyMatches(getDb(), KEY_B)).rejects.toBeInstanceOf(EncryptionKeyMismatchError);
  });

  it("says what would have happened, not just that something is wrong", async () => {
    const err = await assertEncryptionKeyMatches(getDb(), KEY_B).then(
      () => null,
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(EncryptionKeyMismatchError);
    expect(err!.message).toMatch(/provider credential/i);
    expect(err!.message).toMatch(/webhook secret/i);
    expect(err!.message).toMatch(/db:rotate-key/);
    // An operator reading a boot log must not find the key in it.
    expect(err!.message).not.toContain(KEY_A);
    expect(err!.message).not.toContain(KEY_B);
  });
});

describe("rotating the key", () => {
  it("re-encrypts every stored secret and moves the fingerprint", async () => {
    const db = getDb();
    // The services encrypt with the configured key, so that is what the stored
    // material is actually under — rotating from an invented key would be
    // testing a scenario that cannot happen.
    const CONFIG_KEY = loadConfig().NATIO_ENCRYPTION_KEY;
    await db.delete(platformKeyFingerprints);
    await assertEncryptionKeyMatches(db, CONFIG_KEY);

    // Real encrypted material, written through the real services.
    const acct = await registerWalletAccount(db, {
      merchantId,
      mode: "test",
      label: "rotation subject",
      network: "tron",
      asset: "USDT",
      extendedKey: HDKey.fromExtendedKey(XPUB).deriveChild(910).publicExtendedKey,
    });
    const { endpoint: ep } = await createEndpoint(db, {
      merchantId,
      projectId,
      mode: "test",
      url: "https://example.invalid/hook",
      description: "rotation subject",
      events: [],
      actor: { type: "system", id: "test" },
    });

    const [walletBefore] = await db.select().from(walletAccounts).where(eq(walletAccounts.id, acct.id)).limit(1);
    const [epBefore] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, ep.id)).limit(1);
    const walletPlain = decryptString(walletBefore!.extendedKey, CONFIG_KEY);
    const epPlain = decryptString(epBefore!.secretEnc, CONFIG_KEY);

    const counts = await rotateEncryptionKey(CONFIG_KEY, KEY_B);
    expect(counts.walletAccounts).toBeGreaterThan(0);
    expect(counts.webhookEndpoints).toBeGreaterThan(0);

    const [walletAfter] = await db.select().from(walletAccounts).where(eq(walletAccounts.id, acct.id)).limit(1);
    const [epAfter] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, ep.id)).limit(1);

    // Same plaintext, different ciphertext, readable only under the new key.
    expect(decryptString(walletAfter!.extendedKey, KEY_B)).toBe(walletPlain);
    expect(decryptString(epAfter!.secretEnc, KEY_B)).toBe(epPlain);
    expect(walletAfter!.extendedKey).not.toBe(walletBefore!.extendedKey);
    expect(() => decryptString(walletAfter!.extendedKey, CONFIG_KEY)).toThrow();

    // And the platform now boots under the new key and refuses the old one.
    expect(await assertEncryptionKeyMatches(db, KEY_B)).toBe("verified");
    await expect(assertEncryptionKeyMatches(db, CONFIG_KEY)).rejects.toBeInstanceOf(EncryptionKeyMismatchError);

    const [fp] = await db.select().from(platformKeyFingerprints);
    expect(fp!.rotatedAt).toBeTruthy();
  }, 60_000);

  it("refuses a wrong previous key instead of writing rubbish", async () => {
    // AES-GCM authenticates, so this throws rather than producing plausible
    // nonsense — and the transaction means nothing is left half-rotated.
    const db = getDb();
    const [before] = await db.select().from(walletAccounts).limit(1);
    await expect(rotateEncryptionKey("c".repeat(64), "d".repeat(64))).rejects.toThrow();
    const [after] = await db.select().from(walletAccounts).limit(1);
    expect(after!.extendedKey).toBe(before!.extendedKey);
  }, 60_000);

  it("refuses to rotate a key onto itself", async () => {
    await expect(rotateEncryptionKey(KEY_B, KEY_B)).rejects.toThrow(/identical/i);
  });

  it("refuses keys that are not 32-byte hex", async () => {
    await expect(rotateEncryptionKey("too-short", KEY_A)).rejects.toThrow(/32-byte hex/i);
  });
});

describe("what the guard cannot do", () => {
  it("cannot verify a database that predates it, and records rather than guesses", async () => {
    // Honest limit: with no stored fingerprint there is nothing to compare
    // against, so the first key seen is trusted. Documented, not hidden.
    const db = getDb();
    await db.delete(platformKeyFingerprints);
    const wrongButUnverifiable = "e".repeat(64);
    expect(await assertEncryptionKeyMatches(db, wrongButUnverifiable)).toBe("recorded");
    expect(await assertEncryptionKeyMatches(db, wrongButUnverifiable)).toBe("verified");
  });
});
