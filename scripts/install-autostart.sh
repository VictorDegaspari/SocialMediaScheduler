#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
watcher_root=$(pwd)
watcher_units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$watcher_units"
if [[ "$watcher_root" == *'"'* || "$watcher_root" == *'%'* ]]; then
  echo 'O caminho do projeto não pode conter aspas ou % para este instalador.' >&2
  exit 1
fi
cat > "$watcher_units/drive-watcher.service" <<UNIT
[Unit]
Description=Drive Watcher - rotina local de vídeos
After=default.target

[Service]
Type=oneshot
WorkingDirectory=$watcher_root
ExecStart=/usr/bin/docker compose up -d --wait
ExecStop=/usr/bin/docker compose stop
RemainAfterExit=yes
TimeoutStartSec=180
Restart=on-failure
RestartSec=20

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now drive-watcher.service
./scripts/start-browser-agent.sh --ensure
echo 'Início automático configurado para o login deste usuário.'
echo 'O Docker precisa estar disponível. Para remover: systemctl --user disable --now drive-watcher.service'
