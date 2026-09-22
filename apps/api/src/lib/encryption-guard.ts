/**
 * Refuse to run against ciphertext written under a different encryption key.
 *
 * The failure this exists to prevent is not loud. `NATIO_ENCRYPTION_KEY` is
 * generated once by `deploy/bootstrap.sh` and kept only in the `.env` file on
 * the host. Restore a database backup onto a new machine, or rebuild a host
 * from the startup script while the database survives, and bootstrap generates
 * a fresh key against old data. The application starts normally. Nothing looks
 * wrong until the first decrypt: a provider call, a webhook signature, a
 * merchant taking their next on-chain payment. By then the wrong key has been
 * in place long enough that nobody connects the two events.
 *
 * So the check happens at boot, before the process serves anything, and it
 * fails hard. Refusing to start is recoverable in minutes by restoring the
 * right key; running for a week under the wrong one is not recoverable at all.
 */
import { eq } from "drizzle-orm";
import type { DbOrTx } from "../db/client.js";
import { platformKeyFingerprints } from "../db/schema/index.js";
import { sha256Hex } from "./crypto.js";
import { logger } from "./logger.js";

const ENCRYPTION_KEY_ID = "encryption";

/**
 * Domain-separated so the stored value is not a bare hash of the key and
 * cannot be compared against a hash captured from anywhere else.
 */
export function encryptionKeyFingerprint(keyHex: string): string {
  return sha256Hex(`natio-encryption-key-v1:${keyHex.toLowerCase()}`);
}

export class EncryptionKeyMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(
      [
        "NATIO_ENCRYPTION_KEY does not match the key this database was encrypted with.",
        `  expected fingerprint ${expected.slice(0, 16)}…`,
        `  current  fingerprint ${actual.slice(0, 16)}…`,
        "",
        "Starting anyway would leave every provider credential, webhook secret and",
        "merchant extended public key unreadable, and would not say so until the",
        "first decrypt failed.",
        "",
        "Restore the original key into the environment. If this is a deliberate",
        "rotation and you still hold the previous key, re-encrypt first:",
        "  NATIO_OLD_ENCRYPTION_KEY=<previous> NATIO_ENCRYPTION_KEY=<new> npm run db:rotate-key",
        "",
        "If the previous key is lost, the ciphertext cannot be recovered by any",
        "means; `npm run db:rotate-key` prints what that actually costs.",
      ].join("\n"),
    );
    this.name = "EncryptionKeyMismatchError";
  }
}

/**
 * Compare the configured key against the one this database was written with,
 * recording it on first run.
 *
 * On a database that predates this check there is no stored fingerprint, and
 * there is no way to verify retroactively — the current key is recorded and
 * guards every boot after this one. That is the honest limit of it: this
 * protects against the next accident, not the one that already happened.
 */
export async function assertEncryptionKeyMatches(db: DbOrTx, keyHex: string): Promise<"recorded" | "verified"> {
  const fingerprint = encryptionKeyFingerprint(keyHex);

  const [existing] = await db
    .select()
    .from(platformKeyFingerprints)
    .where(eq(platformKeyFingerprints.id, ENCRYPTION_KEY_ID))
    .limit(1);

  if (!existing) {
    // Races between two starting processes are resolved by the primary key:
    // whoever loses re-reads and verifies against the winner's row.
    await db
      .insert(platformKeyFingerprints)
      .values({ id: ENCRYPTION_KEY_ID, fingerprint })
      .onConflictDoNothing();

    const [stored] = await db
      .select()
      .from(platformKeyFingerprints)
      .where(eq(platformKeyFingerprints.id, ENCRYPTION_KEY_ID))
      .limit(1);

    if (stored && stored.fingerprint !== fingerprint) throw new EncryptionKeyMismatchError(stored.fingerprint, fingerprint);
    logger.info({ fingerprint: fingerprint.slice(0, 16) }, "encryption key fingerprint recorded");
    return "recorded";
  }

  if (existing.fingerprint !== fingerprint) throw new EncryptionKeyMismatchError(existing.fingerprint, fingerprint);
  return "verified";
}

/** Used by the rotation command once the ciphertext has actually been re-encrypted. */
export async function recordRotatedEncryptionKey(db: DbOrTx, keyHex: string): Promise<void> {
  const fingerprint = encryptionKeyFingerprint(keyHex);
  const now = new Date();
  await db
    .insert(platformKeyFingerprints)
    .values({ id: ENCRYPTION_KEY_ID, fingerprint, rotatedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: platformKeyFingerprints.id,
      set: { fingerprint, rotatedAt: now, updatedAt: now },
    });
}

export { ENCRYPTION_KEY_ID };
