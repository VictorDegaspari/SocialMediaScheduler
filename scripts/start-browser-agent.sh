#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
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
Restart=on-failure
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
systemctl --user disable drive-watcher-browser-agent.service >/dev/null 2>&1 || true
systemctl --user enable drive-watcher-browser-agent.service
systemctl --user restart drive-watcher-browser-agent.service
echo 'Agente do Chrome ativo; login e envios podem ser solicitados pelo painel.'
