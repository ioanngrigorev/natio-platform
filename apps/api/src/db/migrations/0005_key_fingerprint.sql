-- Records which encryption key the ciphertext in this database was written
-- under, so the application can refuse to start under a different one rather
-- than silently orphaning every provider credential, webhook secret and
-- merchant extended public key.
CREATE TABLE IF NOT EXISTS "platform_key_fingerprints" (
  "id"          text PRIMARY KEY,
  "fingerprint" text NOT NULL,
  "rotated_at"  timestamptz,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);
