/**
 * Re-encrypt every stored secret under a new NATIO_ENCRYPTION_KEY.
 *
 * This is the way out of the boot refusal in `lib/encryption-guard.ts`, and it
 * needs **both** keys: the one the data was written with and the one it should
 * be written with. That is the whole point — if the old key is gone, nothing
 * here can recover the ciphertext, and a tool that pretended otherwise would
 * only make the loss quieter. See `--abandon` below for that case.
 *
 *   NATIO_OLD_ENCRYPTION_KEY=<previous> NATIO_ENCRYPTION_KEY=<new> npm run db:rotate-key
 *
 * Everything moves in one transaction. A rotation that stopped halfway would
 * leave rows under two different keys with no record of which is which, which
 * is worse than either key being wrong.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isNotNull } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "./client.js";
import { providerAccounts, webhookEndpoints, walletAccounts } from "./schema/index.js";
import { decryptString, encryptString } from "../lib/crypto.js";
import { encryptionKeyFingerprint, recordRotatedEncryptionKey } from "../lib/encryption-guard.js";
import { logger } from "../lib/logger.js";

const HEX_32 = /^[0-9a-f]{64}$/i;

interface RotationCounts {
  providerAccounts: number;
  webhookEndpoints: number;
  walletAccounts: number;
}

/**
 * `encryptJson` is `encryptString` over JSON, so every column here is the same
 * problem: decrypt with the old key, encrypt with the new. AES-GCM
 * authenticates, so a wrong old key throws rather than producing plausible
 * rubbish — which is why no separate verification step is needed.
 */
export async function rotateEncryptionKey(oldKey: string, newKey: string): Promise<RotationCounts> {
  if (!HEX_32.test(oldKey) || !HEX_32.test(newKey)) throw new Error("both keys must be 32-byte hex strings");
  if (oldKey.toLowerCase() === newKey.toLowerCase()) throw new Error("old and new keys are identical — nothing to rotate");

  const db = getDb();
  const counts: RotationCounts = { providerAccounts: 0, webhookEndpoints: 0, walletAccounts: 0 };

  await db.transaction(async (tx) => {
    const accounts = await tx.select().from(providerAccounts).where(isNotNull(providerAccounts.credentialsEnc));
    for (const row of accounts) {
      if (!row.credentialsEnc) continue;
      const moved = encryptString(decryptString(row.credentialsEnc, oldKey), newKey);
      await tx.update(providerAccounts).set({ credentialsEnc: moved }).where(eq(providerAccounts.id, row.id));
      counts.providerAccounts += 1;
    }

    const endpoints = await tx.select().from(webhookEndpoints);
    for (const row of endpoints) {
      const moved = encryptString(decryptString(row.secretEnc, oldKey), newKey);
      await tx.update(webhookEndpoints).set({ secretEnc: moved }).where(eq(webhookEndpoints.id, row.id));
      counts.webhookEndpoints += 1;
    }

    const wallets = await tx.select().from(walletAccounts);
    for (const row of wallets) {
      const moved = encryptString(decryptString(row.extendedKey, oldKey), newKey);
      await tx.update(walletAccounts).set({ extendedKey: moved }).where(eq(walletAccounts.id, row.id));
      counts.walletAccounts += 1;
    }

    await recordRotatedEncryptionKey(tx, newKey);
  });

  return counts;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const oldKey = process.env.NATIO_OLD_ENCRYPTION_KEY ?? "";
  const newKey = process.env.NATIO_ENCRYPTION_KEY ?? "";

  if (!oldKey) {
    // The case where the old key is lost. There is no decryption without it,
    // so the honest options are both destructive and neither is this tool's to
    // choose silently.
    logger.error(
      [
        "NATIO_OLD_ENCRYPTION_KEY is not set.",
        "",
        "Rotation needs the key the data was written with. If that key is lost, the",
        "stored ciphertext cannot be recovered by any means, and what remains is:",
        "  · provider credentials must be re-entered by an administrator;",
        "  · webhook secrets must be regenerated and redistributed — every merchant's",
        "    signature verification breaks until they store the new secret;",
        "  · merchants must re-register their settlement extended public keys.",
        "",
        "Nothing about that is automatic, and none of it should happen because a",
        "command was run twice. Restore the key from backup if it exists.",
      ].join("\n"),
    );
    process.exit(1);
  }

  rotateEncryptionKey(oldKey, newKey)
    .then(async (counts) => {
      logger.info(
        { ...counts, fingerprint: encryptionKeyFingerprint(newKey).slice(0, 16) },
        "encryption key rotated — back up the new key before restarting the platform",
      );
      await closeDb();
    })
    .catch(async (err) => {
      logger.error({ err }, "rotation failed — nothing was changed");
      await closeDb();
      process.exit(1);
    });
}
