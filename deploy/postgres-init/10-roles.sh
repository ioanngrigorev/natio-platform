#!/bin/bash
# Runs once, on first initialisation of the data directory.
#
# Splits the database roles so the application cannot alter its own schema:
#   natio_migrator  owns the schema and runs migrations (POSTGRES_USER)
#   natio_app       the runtime role: DML only, no DDL, no ownership
#
# This is what stops the API from being able to drop the append-only triggers
# that protect audit_logs, state_transitions, payment_events, events and the
# financial fields of transactions (docs/SECURITY.md, finding I-1).
set -euo pipefail

if [ -z "${NATIO_APP_DB_PASSWORD:-}" ]; then
  echo "NATIO_APP_DB_PASSWORD is not set — refusing to create the runtime role" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
  CREATE ROLE natio_app LOGIN PASSWORD '${NATIO_APP_DB_PASSWORD}';

  GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO natio_app;
  GRANT USAGE ON SCHEMA public TO natio_app;

  -- Nothing exists yet; migrations run later as ${POSTGRES_USER}. Default
  -- privileges are recorded per creating role, so they must be granted FOR that
  -- role or the app will not see tables created afterwards.
  ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO natio_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO natio_app;

  -- Cover anything that already exists (none on a fresh volume, but this makes
  -- the script safe to re-run against a restored database).
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO natio_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO natio_app;

  -- No schema changes, ever.
  REVOKE CREATE ON SCHEMA public FROM natio_app;
  REVOKE ALL ON SCHEMA public FROM PUBLIC;
  GRANT USAGE ON SCHEMA public TO PUBLIC;
EOSQL

echo "natio_app role created with DML-only privileges"
