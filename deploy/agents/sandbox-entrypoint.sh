#!/bin/sh
set -eu
umask 077
mkdir -p "$HOME"
# Permit the controller UID without requiring root inside the container.
if ! getent passwd "$(id -u)" >/dev/null; then
 cp /etc/passwd /tmp/agent-passwd
 cp /etc/group /tmp/agent-group
 printf 'agent:x:%s:%s:Agent:%s:/bin/sh\n' "$(id -u)" "$(id -g)" "$HOME" >> /tmp/agent-passwd
 export NSS_WRAPPER_PASSWD=/tmp/agent-passwd NSS_WRAPPER_GROUP=/tmp/agent-group
 export LD_PRELOAD="$(find /usr/lib -name libnss_wrapper.so -type f | head -1)"
fi
stage="$1"
# Tests start from the committed candidate, not ignored files or dependencies
# left behind by the coding agent. This is an isolated disposable checkout.
if [ "$stage" = test ]; then git clean -ffdx > /diagnostics/clean.log; fi
# Dependency versions belong to the trusted image, never to an agent command.
if [ "$stage" != review ] && [ ! -d /workspace/node_modules ]; then
 cp -a /opt/template/node_modules /workspace/node_modules
 cp -a /opt/template/apps/api/node_modules /workspace/apps/api/node_modules
 cp -a /opt/template/apps/web/node_modules /workspace/apps/web/node_modules
fi
model="${2:-}"
set --
if [ -n "$model" ]; then set -- --model "$model"; fi
if [ "$stage" = develop ] || [ "$stage" = review ]; then
 set -- "$@" -c 'web_search="disabled"' -c 'model_provider="natio_proxy"' -c 'model_providers.natio_proxy.name="NATIO temporary proxy"' -c "model_providers.natio_proxy.base_url=\"$NATIO_AGENT_PROXY_URL\"" -c 'model_providers.natio_proxy.env_key="NATIO_AGENT_PROXY_TOKEN"' -c 'model_providers.natio_proxy.wire_api="responses"'
fi
case "$stage" in
 develop)
  codex exec --sandbox danger-full-access -c 'approval_policy="never"' "$@" - > /diagnostics/develop.log 2>&1
  printf 'Coding stage completed\n'
  ;;
 review)
  printf '%s' '{"type":"object","properties":{"approved":{"type":"boolean"}},"required":["approved"],"additionalProperties":false}' > /tmp/review-schema.json
  codex exec --sandbox danger-full-access -c 'approval_policy="never"' "$@" --output-schema /tmp/review-schema.json --output-last-message /tmp/review.json - > /diagnostics/review.log 2>&1
  cat /tmp/review.json
  ;;
 test)
  exec > /diagnostics/test.log 2>&1
  export PATH="$(dirname "$(find /usr/lib/postgresql -name initdb -type f | head -1)"):$PATH"
  initdb -D /tmp/pg -U natio -A trust > /tmp/pg-init.log
  pg_ctl -D /tmp/pg -l /tmp/pg.log -o '-h 127.0.0.1 -k /tmp' start
  createdb -h 127.0.0.1 -U natio natio_test
  export NATIO_E2E_DATABASE_URL=postgres://natio@127.0.0.1:5432/natio_test
  export NEXT_TELEMETRY_DISABLED=1
  pnpm typecheck
  pnpm test
  API_INTERNAL_URL=http://api:4000 pnpm build
  ;;
 *) exit 64 ;;
esac
