#!/usr/bin/env bash
#
# Pull the deployed branch and roll the stack forward if it moved.
#
# This exists because nothing outside the server can reach the server. The
# sandbox this platform is built in has no route to it — not on 443, not on 22
# — so there is no "ssh in and restart" step available to whoever is making
# changes. Without this, every fix, however small, costs a full reinstall.
#
# The shape is deliberately boring: check, build, and only then swap. A failed
# build leaves the running containers untouched, because a server serving the
# previous version is strictly better than one serving none.
#
# Installed by bootstrap.sh as a systemd timer. Logs to /var/log/natio-deploy.log.
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/natio}
REF=${NATIO_REPO_REF:-main}
LOG=/var/log/natio-deploy.log
LOCK=/var/lock/natio-deploy.lock

exec >>"$LOG" 2>&1

# Never let two rolls overlap. A build takes tens of minutes on a small host
# and the timer fires far more often than that.
exec 9>"$LOCK"
if ! flock -n 9; then
  exit 0
fi

cd "$APP_DIR"
COMPOSE="docker compose -f docker-compose.prod.yml"

git fetch --quiet origin "$REF"
local_head=$(git rev-parse HEAD)
remote_head=$(git rev-parse "origin/$REF")

if [ "$local_head" = "$remote_head" ]; then
  exit 0
fi

echo ""
echo "=== $(date -u +%FT%TZ) rolling ${local_head:0:8} -> ${remote_head:0:8} ==="
git log --oneline "${local_head}..${remote_head}" | sed 's/^/  /'

git reset --hard "origin/$REF"

# Build before touching anything that is currently serving traffic. If this
# fails the script exits here and the old containers keep running.
export NATIO_GIT_SHA="$(git rev-parse --short HEAD)"
for image in web api; do
  echo "--- building $image ---"
  $COMPOSE build "$image"
done

echo "--- migrating ---"
$COMPOSE --profile tools run --rm migrate

echo "--- restarting ---"
$COMPOSE up -d api worker web proxy

echo "--- state ---"
$COMPOSE ps
echo "=== $(date -u +%FT%TZ) rolled to $(git rev-parse --short HEAD) ==="
