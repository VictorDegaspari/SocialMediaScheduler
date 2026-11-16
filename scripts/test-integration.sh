#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
docker compose exec -T postgres psql -U watcher -d postgres <<'SQL'
SELECT 'CREATE DATABASE watcher_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='watcher_test')\gexec
SELECT 'CREATE DATABASE watcher_native_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='watcher_native_test')\gexec
SELECT 'CREATE DATABASE watcher_browser_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='watcher_browser_test')\gexec
SQL
docker compose run --rm --no-deps -e LOG_LEVEL=silent -v "$PWD:/app" app node --import tsx --test tests/*.integration.ts
