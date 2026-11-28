#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
test_files=("$@")
if (( ${#test_files[@]} == 0 )); then test_files=(tests/*.integration.ts); fi
for test_file in "${test_files[@]}"; do
  if [[ ! "$test_file" =~ ^tests/[A-Za-z0-9_-]+\.integration\.ts$ || ! -f "$test_file" ]]; then
    printf 'Use caminhos exatos existentes: tests/nome.integration.ts (sem flags ou padrões).\n' >&2
    exit 2
  fi
done
docker compose exec -T postgres psql -U watcher -d postgres <<'SQL'
SELECT 'CREATE DATABASE watcher_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='watcher_test')\gexec
SELECT 'CREATE DATABASE watcher_native_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='watcher_native_test')\gexec
SELECT 'CREATE DATABASE watcher_browser_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='watcher_browser_test')\gexec
SELECT 'CREATE DATABASE watcher_cuts_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='watcher_cuts_test')\gexec
SELECT 'CREATE DATABASE watcher_cuts_files_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='watcher_cuts_files_test')\gexec
SELECT 'CREATE DATABASE watcher_pagination_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='watcher_pagination_test')\gexec
SELECT 'CREATE DATABASE watcher_requests_pages_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='watcher_requests_pages_test')\gexec
SELECT 'CREATE DATABASE watcher_youtube_channels_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='watcher_youtube_channels_test')\gexec
SELECT 'CREATE DATABASE watcher_channel_videos_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='watcher_channel_videos_test')\gexec
SQL
docker compose run --rm --no-deps -e LOG_LEVEL=silent -v "$PWD:/app" app node --import tsx --test "${test_files[@]}"
