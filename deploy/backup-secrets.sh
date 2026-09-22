#!/usr/bin/env bash
#
# Print the secrets that must exist somewhere other than this host, and the
# fingerprints to verify a backup against later.
#
# The one that matters is NATIO_ENCRYPTION_KEY. It is generated once, lives
# only in /opt/natio/.env, and decrypts every provider credential, every
# webhook secret and every merchant settlement key in the database. A database
# backup without it restores rows nobody can read.
#
# Since 0005_key_fingerprint the platform refuses to start against a database
# encrypted with a different key, so losing it is now a loud failure instead of
# a silent one — but loud is not the same as recoverable. Copy it into a
# password manager.
#
#   sudo bash /opt/natio/deploy/backup-secrets.sh
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/natio}"
ENV_FILE="$APP_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "no environment file at $ENV_FILE — is APP_DIR right?" >&2
  exit 1
fi

get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

ENC_KEY="$(get NATIO_ENCRYPTION_KEY)"
SESSION_SECRET="$(get NATIO_SESSION_SECRET)"
PG_PASSWORD="$(get POSTGRES_PASSWORD)"
APP_DB_PASSWORD="$(get NATIO_APP_DB_PASSWORD)"

# Same domain separation the application uses, so this can be compared against
# the fingerprint in the platform_key_fingerprints table and in the boot log.
fingerprint() { printf 'natio-encryption-key-v1:%s' "$(printf '%s' "$1" | tr 'A-F' 'a-f')" | sha256sum | cut -d' ' -f1; }

cat <<BANNER

  Back these up somewhere that is not this machine.
  Treat this output as secret material: it is not written to a file, and it
  should not stay in your terminal scrollback.

BANNER

printf '  NATIO_ENCRYPTION_KEY   %s\n' "$ENC_KEY"
printf '    fingerprint          %s\n' "$(fingerprint "$ENC_KEY")"
printf '    losing this          every provider credential, webhook secret and merchant\n'
printf '                         settlement key becomes permanently unreadable. The\n'
printf '                         platform will refuse to start rather than pretend\n'
printf '                         otherwise, and recovery means every merchant\n'
printf '                         re-registering and re-integrating.\n\n'

printf '  NATIO_SESSION_SECRET   %s\n' "$SESSION_SECRET"
printf '    losing this          every dashboard session is invalidated. Users sign in\n'
printf '                         again; nothing is lost.\n\n'

printf '  POSTGRES_PASSWORD      %s\n' "$PG_PASSWORD"
printf '  NATIO_APP_DB_PASSWORD  %s\n\n' "$APP_DB_PASSWORD"

cat <<'FOOTER'
  To verify a backup later, compare its fingerprint against the one the API
  logs on start, or against the stored value:

    docker compose -f /opt/natio/docker-compose.prod.yml exec -T postgres \
      psql -U natio -d natio -tAc \
      "select fingerprint from platform_key_fingerprints where id = 'encryption'"

FOOTER
