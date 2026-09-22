#!/bin/bash
# Local helper: run API in watch mode with the repo .env
set -a; . "$(dirname "$0")/../../.env"; set +a
export LOG_PRETTY=false LOG_LEVEL=${LOG_LEVEL:-warn}
cd "$(dirname "$0")"
exec npx tsx watch --clear-screen=false src/index.ts
