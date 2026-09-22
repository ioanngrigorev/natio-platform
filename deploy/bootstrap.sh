#!/usr/bin/env bash
#
# NATIO server bootstrap — takes a bare Ubuntu 24.04 host to a running,
# TLS-terminated production stack. Safe to re-run: every step is idempotent.
#
# Used as a Vultr startup script (type: boot) or run by hand:
#   NATIO_REPO=https://github.com/you/natio.git SITE_DOMAIN=natio.me \
#   ACME_EMAIL=ops@natio.me NATIO_ADMIN_EMAIL=ops@natio.me bash bootstrap.sh
#
# Required:
#   NATIO_REPO         git URL of the NATIO repository
#   SITE_DOMAIN        apex domain, e.g. natio.me
#   ACME_EMAIL         address for Let's Encrypt expiry notices
# Optional:
#   NATIO_REPO_TOKEN   token for a private repo (injected into the clone URL)
#   NATIO_REPO_REF     branch or tag to deploy (default: main)
#   NATIO_ADMIN_EMAIL  first admin user; a password is generated and printed
#   SSH_PUBKEY         public key to install for the deploy user
#   BACKUP_S3_URI      s3://bucket/prefix for off-host backup copies
set -euo pipefail

LOG=/var/log/natio-bootstrap.log
exec > >(tee -a "$LOG") 2>&1
echo "=== NATIO bootstrap $(date -u +%FT%TZ) ==="

# An unattended boot has nobody watching the exit code, so make a failure loud
# and self-explanatory at the end of the log rather than a silent early exit.
on_error() {
  local line=$1
  echo ""
  echo "=== NATIO bootstrap FAILED at line ${line} ==="
  echo "Re-run after fixing:  bash /opt/natio/deploy/bootstrap.sh"
  echo "Full log:             ${LOG}"
  if [ -f /opt/natio/docker-compose.prod.yml ]; then
    echo "--- container state ---"
    docker compose -f /opt/natio/docker-compose.prod.yml ps 2>&1 | sed 's/^/  /' || true
  fi
}
trap 'on_error $LINENO' ERR

: "${NATIO_REPO:?NATIO_REPO is required}"
: "${SITE_DOMAIN:?SITE_DOMAIN is required}"
: "${ACME_EMAIL:?ACME_EMAIL is required}"
NATIO_REPO_REF="${NATIO_REPO_REF:-main}"
APP_DIR=/opt/natio
DEPLOY_USER=natio

# ---------------------------------------------------------------------------
# 1. Base system
# ---------------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git ufw fail2ban unattended-upgrades postgresql-client-16 || \
  apt-get install -y -qq ca-certificates curl git ufw fail2ban unattended-upgrades postgresql-client
# Needed only when BACKUP_S3_URI is configured, but installing it later means
# noticing that hourly backups have been failing to leave the host. Not fatal
# if the package is unavailable; backup.sh says so plainly when it is missing.
apt-get install -y -qq awscli || echo "warn: awscli not installed; off-host backup copies will be unavailable"

# Swap. The Next.js build is the memory peak of the whole install, and on a
# small host it is the difference between a deploy and an OOM kill. Size it
# against actual RAM rather than assuming: 2 GB of RAM needs more help than 4.
RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if ! swapon --show | grep -q .; then
  if [ "$RAM_MB" -lt 3000 ]; then SWAP_G=4; else SWAP_G=2; fi
  fallocate -l "${SWAP_G}G" /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Swapping during a build is the point here, so let the kernel do it freely.
  sysctl -q -w vm.swappiness=60 || true
  echo "swap: ${SWAP_G}G enabled (host has ${RAM_MB} MB RAM)"
fi

# ---------------------------------------------------------------------------
# 2. Firewall and SSH hardening
# ---------------------------------------------------------------------------
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp  >/dev/null
ufw allow 80/tcp  >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null   # HTTP/3
ufw --force enable >/dev/null
echo "firewall: 22, 80, 443 open; everything else denied"

install -d -m 755 /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/10-natio.conf <<'EOF'
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
X11Forwarding no
MaxAuthTries 3
EOF
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true

systemctl enable --now fail2ban >/dev/null 2>&1 || true
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 3. Docker
# ---------------------------------------------------------------------------
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
echo "docker: $(docker --version)"

# ---------------------------------------------------------------------------
# 4. Deploy user
# ---------------------------------------------------------------------------
id -u "$DEPLOY_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
if [ -n "${SSH_PUBKEY:-}" ]; then
  install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
  echo "$SSH_PUBKEY" > "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
fi

# ---------------------------------------------------------------------------
# 5. Source
# ---------------------------------------------------------------------------
CLONE_URL="$NATIO_REPO"
if [ -n "${NATIO_REPO_TOKEN:-}" ]; then
  CLONE_URL="$(printf '%s' "$NATIO_REPO" | sed -E "s#https://#https://x-access-token:${NATIO_REPO_TOKEN}@#")"
fi

if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" remote set-url origin "$CLONE_URL"
  git -C "$APP_DIR" fetch --depth 1 origin "$NATIO_REPO_REF"
  git -C "$APP_DIR" reset --hard "origin/$NATIO_REPO_REF"
else
  git clone --depth 1 --branch "$NATIO_REPO_REF" "$CLONE_URL" "$APP_DIR"
fi
# Never leave the token in the git config on disk.
git -C "$APP_DIR" remote set-url origin "$NATIO_REPO"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"
# The checkout now belongs to the deploy user while root still has to run git
# in it — for this script's own re-runs and for the update timer. Without this
# git refuses with "dubious ownership", and it does so quietly enough to look
# like the timer simply never fired.
git config --system --add safe.directory "$APP_DIR" 2>/dev/null || true
echo "source: $(git -C "$APP_DIR" rev-parse --short HEAD) on $NATIO_REPO_REF"

# ---------------------------------------------------------------------------
# 6. Secrets and environment (generated once, then preserved across re-runs)
# ---------------------------------------------------------------------------
ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
# Generated by deploy/bootstrap.sh on $(date -u +%FT%TZ). Treat as secret material.
NODE_ENV=production
SITE_DOMAIN=${SITE_DOMAIN}
ACME_EMAIL=${ACME_EMAIL}

API_PORT=4000
API_HOST=0.0.0.0
LOG_LEVEL=info

PUBLIC_WEB_URL=https://${SITE_DOMAIN}
PUBLIC_API_URL=https://api.${SITE_DOMAIN}
CORS_ORIGINS=https://${SITE_DOMAIN},https://app.${SITE_DOMAIN},https://docs.${SITE_DOMAIN}

POSTGRES_PASSWORD=$(openssl rand -hex 24)
NATIO_APP_DB_PASSWORD=$(openssl rand -hex 24)
DATABASE_POOL_MAX=10
DATABASE_SSL=disable

QUEUE_DRIVER=redis

NATIO_ENCRYPTION_KEY=$(openssl rand -hex 32)
NATIO_SESSION_SECRET=$(openssl rand -hex 32)

SESSION_TTL_HOURS=12
ADMIN_SESSION_TTL_HOURS=8
COOKIE_SECURE=true
COOKIE_DOMAIN=.${SITE_DOMAIN}

# Only the Caddy container fronts the API; trust X-Forwarded-For from the docker network only.
TRUST_PROXY=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16

RATE_LIMIT_API_PER_MINUTE=600
RATE_LIMIT_DASHBOARD_PER_MINUTE=300
RATE_LIMIT_AUTH_PER_MINUTE=10

DEFAULT_RETRY_MAX_ATTEMPTS=3
DEFAULT_RETRY_ON_SOFT_DECLINE=true
PROVIDER_TIMEOUT_MS=15000
IDEMPOTENCY_TTL_HOURS=24

WEBHOOK_TIMEOUT_MS=10000
WEBHOOK_MAX_ATTEMPTS=6
WEBHOOK_ALLOW_PRIVATE_URLS=false
EOF
  chmod 600 "$ENV_FILE"
  chown "$DEPLOY_USER:$DEPLOY_USER" "$ENV_FILE"
  echo "env: generated with fresh secrets"
else
  echo "env: existing .env kept (secrets not regenerated)"
fi

# ---------------------------------------------------------------------------
# 7. Build and start
# ---------------------------------------------------------------------------
cd "$APP_DIR"
COMPOSE="docker compose -f docker-compose.prod.yml"

# Build one image at a time. Compose builds in parallel by default, which on a
# small host means two Node toolchains competing for the same scarce memory and
# both losing. Sequential is slower on a big machine and the difference between
# working and not on a small one.
export NATIO_GIT_SHA="$(git rev-parse --short HEAD)"
for image in web api; do
  echo "building $image..."
  $COMPOSE build "$image"
done

$COMPOSE up -d postgres redis
echo "waiting for postgres..."
for i in $(seq 1 60); do
  $COMPOSE exec -T postgres pg_isready -U natio_migrator -d natio >/dev/null 2>&1 && break
  sleep 2
done

$COMPOSE --profile tools run --rm migrate
$COMPOSE up -d api worker web proxy

# ---------------------------------------------------------------------------
# 8. First admin user
# ---------------------------------------------------------------------------
if [ -n "${NATIO_ADMIN_EMAIL:-}" ]; then
  NATIO_ADMIN_EMAIL="$NATIO_ADMIN_EMAIL" $COMPOSE --profile tools run --rm create-admin | tee /root/natio-admin-credentials.txt
  chmod 600 /root/natio-admin-credentials.txt
  echo "admin credentials also written to /root/natio-admin-credentials.txt"
fi

# ---------------------------------------------------------------------------
# 8b. Self-update timer
#
# Nothing outside this host can reach it — the environment these changes are
# authored in has no route here on any port — so without a pull-based deploy
# every subsequent fix would cost a full reinstall. The server watches its own
# branch instead.
# ---------------------------------------------------------------------------
install -m 0755 "$APP_DIR/deploy/self-update.sh" /usr/local/bin/natio-self-update
cat > /etc/systemd/system/natio-deploy.service <<EOF
[Unit]
Description=Roll NATIO forward if its branch moved
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
# A build on this host takes tens of minutes. systemd's default start timeout
# is 90 seconds, so without this the unit is killed mid-build every single
# time — leaving a half-built image and no explanation.
TimeoutStartSec=0
Environment=APP_DIR=${APP_DIR}
Environment=NATIO_REPO_REF=${NATIO_REPO_REF}
ExecStart=/usr/local/bin/natio-self-update
EOF
cat > /etc/systemd/system/natio-deploy.timer <<'EOF'
[Unit]
Description=Check for NATIO updates

[Timer]
OnBootSec=5min
OnUnitInactiveSec=3min
AccuracySec=30s

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now natio-deploy.timer
echo "self-update: checking origin/${NATIO_REPO_REF} every 3 minutes (log: /var/log/natio-deploy.log)"

# Run it once, now, while there is a console to read the result on. The repo is
# already current so this is a no-op — which is the point: it proves the script
# executes cleanly rather than failing the first time nobody is watching.
if /usr/local/bin/natio-self-update; then
  echo "self-update: dry run completed cleanly"
else
  echo "self-update: DRY RUN FAILED (exit $?) — deploys will not roll automatically"
  tail -20 /var/log/natio-deploy.log 2>/dev/null | sed 's/^/    /'
fi

# ---------------------------------------------------------------------------
# 9. Backups
# ---------------------------------------------------------------------------
install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /var/backups/natio
# The cron job calls deploy/backup.sh rather than inlining its own pg_dump.
# It used to inline one, and the inlined copy skipped the two things that make
# a dump a backup: verifying it can be listed, and copying it off this host.
# It even exported BACKUP_S3_URI without ever using it, so configuring an
# off-host destination did nothing and said nothing.
cat > /etc/cron.hourly/natio-backup <<EOF
#!/bin/bash
set -euo pipefail
export APP_DIR=$APP_DIR
export BACKUP_DIR=/var/backups/natio
export RETENTION_DAYS=30
${BACKUP_S3_URI:+export BACKUP_S3_URI=$BACKUP_S3_URI}
${BACKUP_S3_ENDPOINT:+export BACKUP_S3_ENDPOINT=$BACKUP_S3_ENDPOINT}
exec $APP_DIR/deploy/backup.sh
EOF
chmod +x /etc/cron.hourly/natio-backup
if [ -n "${BACKUP_S3_URI:-}" ]; then
  echo "backups: hourly, verified, to /var/backups/natio and $BACKUP_S3_URI (30 day retention)"
else
  echo "backups: hourly, verified, to /var/backups/natio (30 day retention)"
  echo "backups: WARNING - no BACKUP_S3_URI, so backups live only on this host and die with it"
fi


# ---------------------------------------------------------------------------
# 10. Report
#
# On an unattended boot this output is the only channel back to whoever is
# watching, so each service is checked on its own terms. Port 80 is not a
# health probe: Caddy answers there only to redirect and to serve ACME
# challenges, so curling it would report a failure on a perfectly healthy
# stack. Ask each container directly instead.
# ---------------------------------------------------------------------------
probe() { # name, command...
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "  ok      $name"; else echo "  FAILED  $name"; fi
}

echo ""
echo "waiting for the API to come up..."
API_UP=no
for i in $(seq 1 60); do
  if $COMPOSE exec -T api curl -fsS http://127.0.0.1:4000/health >/dev/null 2>&1; then API_UP=yes; break; fi
  sleep 5
done

SERVER_IP="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"

echo ""
echo "=== NATIO bootstrap complete ==="
$COMPOSE ps
echo ""
echo "checks:"
probe "api /health"        $COMPOSE exec -T api curl -fsS http://127.0.0.1:4000/health
probe "web renders"        $COMPOSE exec -T api curl -fsS http://web:3000/
probe "postgres accepting" $COMPOSE exec -T postgres pg_isready -U natio_migrator -d natio
probe "redis responding"   $COMPOSE exec -T redis redis-cli ping
probe "caddy on 443"       bash -c "ss -lnt | grep -q ':443 '"

if [ "$API_UP" != "yes" ]; then
  echo ""
  echo "  the API never answered. Last 40 lines of its log:"
  $COMPOSE logs --tail 40 api 2>&1 | sed 's/^/    /'
fi

echo ""
echo "DNS - point every record at ${SERVER_IP}; Caddy then issues certificates within a minute or two:"
for h in "@" "www" "api" "app" "docs"; do printf '  A  %-5s -> %s\n' "$h" "$SERVER_IP"; done

echo ""
echo "once DNS resolves:  https://${SITE_DOMAIN}   https://app.${SITE_DOMAIN}   https://docs.${SITE_DOMAIN}"
echo "certificate status: docker compose -f docker-compose.prod.yml logs proxy | grep -i certificate"
echo "full log:           $LOG"
echo "admin credentials:  /root/natio-admin-credentials.txt"

# ---------------------------------------------------------------------------
# The one manual step this script cannot do for the operator.
#
# NATIO_ENCRYPTION_KEY exists only in this host's .env. A database backup
# without it restores rows that nobody can decrypt. The platform now refuses
# to start against a database encrypted under a different key, so the failure
# is loud rather than silent — but a loud failure is still a failure.
# ---------------------------------------------------------------------------
cat <<'BACKUP'

  ─────────────────────────────────────────────────────────────────────────
  DO THIS NOW: back up the encryption key off this machine.

      sudo bash /opt/natio/deploy/backup-secrets.sh

  It decrypts every provider credential, webhook secret and merchant
  settlement key. It is generated once and stored nowhere else. Losing it
  means every merchant re-registering and re-integrating — a database
  backup on its own does not cover this.
  ─────────────────────────────────────────────────────────────────────────
BACKUP
