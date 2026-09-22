#!/usr/bin/env bash
# NATIO database backup.
#
# Two ways to run it, because the production host and a jump box are different
# situations and having two scripts meant the host quietly ran the weaker one:
#
#   direct     DATABASE_URL=postgres://... ./deploy/backup.sh
#   on the host (no postgres client installed; talks to the container)
#              APP_DIR=/opt/natio ./deploy/backup.sh
#
# Off-host copies need BACKUP_S3_URI, and BACKUP_S3_ENDPOINT for anything that
# is S3-compatible without being AWS (Vultr Object Storage, Backblaze, MinIO).
# Credentials come from the usual AWS_* variables or ~/.aws/credentials.
#
# Produces a custom-format dump, verifies it can be listed, copies it off the
# host if told where, prunes by age and prints one line for the log.
#
# What this does NOT contain: NATIO_ENCRYPTION_KEY. Restoring one of these
# dumps onto a host with a different key gives you rows nobody can decrypt —
# the platform will refuse to start rather than pretend otherwise. Back the key
# up separately with deploy/backup-secrets.sh.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/natio}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
APP_DIR="${APP_DIR:-}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${BACKUP_DIR}/natio-${STAMP}.dump"
# Written under a temporary name and only renamed once it has been verified.
# A half-written dump sitting in the backup directory under the real name is
# worse than no dump, because it is indistinguishable from a good one until
# the day it is needed.
TMP="${FILE}.partial"

mkdir -p "$BACKUP_DIR"
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

if [ -n "$APP_DIR" ]; then
  COMPOSE=(docker compose -f "$APP_DIR/docker-compose.prod.yml")
  dump() { "${COMPOSE[@]}" exec -T postgres pg_dump -U natio_migrator -d natio --format=custom --compress=9 --no-owner --no-privileges; }
  verify() { "${COMPOSE[@]}" exec -T postgres pg_restore --list > /dev/null; }
else
  : "${DATABASE_URL:?set DATABASE_URL, or APP_DIR to back up through the container}"
  dump() { pg_dump --dbname="$DATABASE_URL" --format=custom --compress=9 --no-owner --no-privileges; }
  verify() { pg_restore --list > /dev/null; }
fi

dump > "$TMP"

# A dump that cannot be listed is not a backup.
if ! verify < "$TMP"; then
  echo "natio-backup FAILED: dump at ${TMP} could not be listed; not keeping it" >&2
  exit 1
fi

if [ ! -s "$TMP" ]; then
  echo "natio-backup FAILED: dump is empty" >&2
  exit 1
fi

mv "$TMP" "$FILE"
SIZE="$(du -h "$FILE" | cut -f1)"
find "$BACKUP_DIR" -name 'natio-*.dump' -type f -mtime "+${RETENTION_DAYS}" -delete
find "$BACKUP_DIR" -name 'natio-*.dump.partial' -type f -mtime +1 -delete

echo "natio-backup ok file=${FILE} size=${SIZE} retention_days=${RETENTION_DAYS}"

# Off-host copy. A backup on the same host protects against a bad migration
# and against nothing else: the disk that holds the database holds the backup.
#
# BACKUP_S3_ENDPOINT exists because the obvious destination for a Vultr host is
# Vultr Object Storage, which speaks S3 but is not AWS. Without an endpoint the
# upload goes to Amazon, fails, and the operator is left reading a credentials
# error about a service they never configured.
if [ -n "${BACKUP_S3_URI:-}" ]; then
  if ! command -v aws >/dev/null 2>&1; then
    echo "natio-backup FAILED: BACKUP_S3_URI is set but the aws CLI is not installed;" >&2
    echo "                     the dump is on this host only. Install it with: apt-get install -y awscli" >&2
    exit 1
  fi
  aws s3 cp "$FILE" "${BACKUP_S3_URI%/}/natio-${STAMP}.dump" --only-show-errors \
    ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"}
  echo "natio-backup uploaded=${BACKUP_S3_URI%/}/natio-${STAMP}.dump"
else
  # Said every run rather than once at install, because this is the difference
  # between surviving a lost host and not, and nobody re-reads install output.
  echo "natio-backup WARNING: BACKUP_S3_URI is not set — this backup exists only on this host" >&2
fi
