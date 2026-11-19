#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
./scripts/node-local.sh node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.frontend.json
./scripts/node-local.sh node_modules/vite/bin/vite.js build
watcher_media_dir=$(docker compose config --format json | python3 -c "import json,sys; print(next(v['source'] for v in json.load(sys.stdin)['services']['app']['volumes'] if v['target']=='/media/local'))")
mkdir -p "$watcher_media_dir/.qa-ui-local-001"
cleanup() {
  docker compose exec -T postgres psql -q -U watcher -d watcher <<'SQL'
BEGIN;
DELETE FROM events WHERE watch_id IN(SELECT id FROM watches WHERE folder_id='qa-ui-drive-folder-001' OR (source_type='local' AND folder_url LIKE '%/.qa-ui-local-001'));
DELETE FROM content_claims WHERE delivery_id IN(SELECT d.id FROM deliveries d JOIN videos v ON v.id=d.video_id JOIN watches w ON w.id=v.watch_id WHERE w.folder_id='qa-ui-drive-folder-001' OR (w.source_type='local' AND w.folder_url LIKE '%/.qa-ui-local-001'));
DELETE FROM deliveries WHERE video_id IN(SELECT v.id FROM videos v JOIN watches w ON w.id=v.watch_id WHERE w.folder_id='qa-ui-drive-folder-001' OR (w.source_type='local' AND w.folder_url LIKE '%/.qa-ui-local-001'));
DELETE FROM videos WHERE watch_id IN(SELECT id FROM watches WHERE folder_id='qa-ui-drive-folder-001' OR (source_type='local' AND folder_url LIKE '%/.qa-ui-local-001'));
DELETE FROM watches WHERE folder_id='qa-ui-drive-folder-001' OR (source_type='local' AND folder_url LIKE '%/.qa-ui-local-001');
COMMIT;
SQL
}
trap cleanup EXIT
cleanup
./scripts/node-local.sh scripts/check-ui.mjs
./scripts/node-local.sh scripts/check-native-ui.mjs
./scripts/node-local.sh scripts/check-browser-panel.mjs
./scripts/node-local.sh scripts/check-requests-ui.mjs
./scripts/node-local.sh scripts/check-cuts-ui.mjs
./scripts/node-local.sh scripts/check-cuts-editor-regressions.mjs
./scripts/node-local.sh scripts/check-cuts-panel-sessions.mjs
./scripts/node-local.sh scripts/check-pagination-ui.mjs
rmdir "$watcher_media_dir/.qa-ui-local-001"
