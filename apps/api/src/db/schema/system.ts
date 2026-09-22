import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * Which key the ciphertext in this database was written under.
 *
 * `bootstrap.sh` generates NATIO_ENCRYPTION_KEY once and preserves it across
 * re-runs, but only because the `.env` file survives. Restore a database backup
 * onto a fresh host, lose the file, or rebuild from the startup script, and a
 * new key is generated while the old ciphertext is still sitting in the
 * database. Nothing about that looks wrong: the application boots, serves
 * traffic, and only fails when something first needs to decrypt — a webhook
 * signature weeks later, or a merchant taking their next on-chain payment.
 *
 * Provider credentials, webhook secrets and merchant extended public keys are
 * all encrypted with this key, so the blast radius is every integration on the
 * platform at once.
 *
 * Storing a fingerprint turns that silent, late failure into a refusal to
 * start. A wrong key should be discovered by an operator reading a boot log,
 * not by a merchant asking where their money went.
 *
 * The fingerprint is a domain-separated SHA-256 of the key, not the key and
 * not a bare hash of it, so this row discloses nothing usable.
 */
export const platformKeyFingerprints = pgTable("platform_key_fingerprints", {
  /** Stable identifier of the key being fingerprinted, e.g. "encryption". */
  id: text("id").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  /** Set when the key is deliberately rotated, so an audit can tell rotation from accident. */
  rotatedAt: ts("rotated_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
