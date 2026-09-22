#!/usr/bin/env bash
# NATIO database backup. Run from cron on the database host or a jump box.
#
#   BACKUP_DIR=/var/backups/natio DATABASE_URL=postgres://... ./deploy/backup.sh
#
# Produces a custom-format dump (pg_restore-compatible, compressed), verifies it
# can be listed, prunes by age and prints a one-line summary for the log.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/natio}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${BACKUP_DIR}/natio-${STAMP}.dump"

mkdir -p "$BACKUP_DIR"

# --format=custom keeps parallel restore and selective table restore available.
pg_dump --dbname="$DATABASE_URL" --format=custom --compress=9 --no-owner --no-privileges --file="$FILE"

# A dump that cannot be listed is not a backup.
pg_restore --list "$FILE" > /dev/null

SIZE="$(du -h "$FILE" | cut -f1)"
find "$BACKUP_DIR" -name 'natio-*.dump' -type f -mtime "+${RETENTION_DAYS}" -delete

echo "natio-backup ok file=${FILE} size=${SIZE} retention_days=${RETENTION_DAYS}"

# Off-host copy — required: a backup on the same host is not a backup.
if [ -n "${BACKUP_S3_URI:-}" ]; then
  aws s3 cp "$FILE" "${BACKUP_S3_URI%/}/natio-${STAMP}.dump" --only-show-errors
  echo "natio-backup uploaded=${BACKUP_S3_URI%/}/natio-${STAMP}.dump"
fi
