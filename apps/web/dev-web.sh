#!/bin/bash
set -a; . "$(dirname "$0")/../../.env"; set +a
cd "$(dirname "$0")"
exec npx next dev -p 3000
