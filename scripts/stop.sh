#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
systemctl --user stop drive-watcher-browser-agent.service 2>/dev/null || true
docker compose stop
echo 'Rotina parada. Seus dados foram preservados.'
