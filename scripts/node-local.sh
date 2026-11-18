#!/usr/bin/env bash
set -euo pipefail
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_node="${TIKTOK_NODE_BIN:-$(command -v node || true)}"
task_node_check='const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major>22||(major===22&&minor>=12)?0:1)'
if [[ -z "$task_node" ]] || ! "$task_node" -e "$task_node_check" 2>/dev/null; then
  task_node=""
  for candidate in "$HOME"/.nvm/versions/node/v*/bin/node; do
    if [[ -x "$candidate" ]] && "$candidate" -e "$task_node_check" 2>/dev/null; then task_node="$candidate"; fi
  done
fi
if [[ -z "$task_node" ]]; then echo 'Instale Node.js 22.12+ ou indique TIKTOK_NODE_BIN.' >&2; exit 1; fi
cd -- "$task_root"
exec "$task_node" --env-file-if-exists=.env --import tsx "$@"
