#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if (( $# > 1 )) || [[ -n "${1:-}" && "${1:-}" != '--ensure' ]]; then
  echo 'Uso: scripts/start-browser-agent.sh [--ensure]' >&2
  exit 2
fi
if [[ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
  echo 'Agente do Chrome: abra uma sessão gráfica no Ubuntu para usar o navegador pelo painel.'
  exit 0
fi
if [[ ! -d node_modules/tsx ]] || ! command -v google-chrome >/dev/null; then
  echo 'Agente do Chrome: instale as dependências locais (npm ci com Node 22+) e Google Chrome.'
  exit 0
fi
task_root=$(pwd)
task_units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
if [[ "$task_root" == *'"'* || "$task_root" == *'%'* ]]; then echo 'Caminho não suportado pelo serviço local.' >&2; exit 1; fi
mkdir -p "$task_units"
cat > "$task_units/drive-watcher-browser-agent.service" <<UNIT
[Unit]
Description=Drive Watcher - agente local do Chrome
After=graphical-session.target
PartOf=graphical-session.target

[Service]
Type=simple
WorkingDirectory=$task_root
ExecStart="$task_root/scripts/browser-agent.sh"
Restart=always
RestartSec=5
TimeoutStopSec=20
KillMode=mixed
UMask=0077

[Install]
WantedBy=graphical-session.target
UNIT
for variable in DISPLAY WAYLAND_DISPLAY XAUTHORITY DBUS_SESSION_BUS_ADDRESS XDG_RUNTIME_DIR; do
  if [[ -n "${!variable:-}" ]]; then systemctl --user import-environment "$variable"; fi
done
systemctl --user daemon-reload
systemctl --user enable drive-watcher-browser-agent.service
if [[ "${1:-}" == '--ensure' ]]; then
  systemctl --user start drive-watcher-browser-agent.service
else
  systemctl --user restart drive-watcher-browser-agent.service
fi
echo 'Agente do Chrome ativo; login e envios podem ser solicitados pelo painel.'
