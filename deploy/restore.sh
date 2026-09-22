#!/usr/bin/env bash
# Restore a NATIO dump into an EMPTY database. Destructive — asks for confirmation.
#
#   DATABASE_URL=postgres://... ./deploy/restore.sh /var/backups/natio/natio-2026....dump
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
FILE="${1:?usage: restore.sh <dump file>}"
[ -f "$FILE" ] || { echo "no such file: $FILE" >&2; exit 1; }

echo "About to restore ${FILE} into ${DATABASE_URL%%\?*}"
read -r -p "This overwrites existing data. Type RESTORE to continue: " confirm
[ "$confirm" = "RESTORE" ] || { echo "aborted"; exit 1; }

pg_restore --dbname="$DATABASE_URL" --clean --if-exists --no-owner --no-privileges --exit-on-error --jobs=4 "$FILE"
echo "restore complete — run 'node dist/db/migrate.js' to apply any newer migrations"
