#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if ! command -v docker >/dev/null; then
  echo 'Docker não encontrado. Instale Docker Engine e Docker Compose antes de iniciar.' >&2
  exit 1
fi
if [[ ! -f .env ]]; then
  umask 077
  watcher_key=$(openssl rand -hex 32)
  watcher_password=$(openssl rand -hex 24)
  cat > .env <<ENV
PORT=4317
APP_URL=http://localhost:4317
ENCRYPTION_KEY=$watcher_key
POSTGRES_PASSWORD=$watcher_password
DATABASE_URL=postgres://watcher:$watcher_password@localhost:5438/watcher
REDIS_URL=redis://localhost:6388
DATA_DIR=./data
ENV
  unset watcher_key watcher_password
  echo 'Configuração local criada em .env com segredos aleatórios.'
fi
chmod 600 .env
if ! grep -Eq '^BROWSER_AGENT_TOKEN=[a-f0-9]{64}$' .env; then
  watcher_agent_key=$(openssl rand -hex 32)
  sed -i '/^BROWSER_AGENT_TOKEN=/d' .env
  printf '\nBROWSER_AGENT_TOKEN=%s\n' "$watcher_agent_key" >> .env
  unset watcher_agent_key
fi
if ! grep -q '^LOCAL_MEDIA_DIR=' .env; then
  printf '\nLOCAL_MEDIA_DIR=%s/media\n' "$PWD" >> .env
  mkdir -p media
fi
docker compose up -d --build --wait --wait-timeout 180
if [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
  ./scripts/start-browser-agent.sh || echo 'Agente do Chrome não iniciou. Verifique scripts/start-browser-agent.sh no Ubuntu.'
fi
watcher_url=$(sed -n 's/^APP_URL=//p' .env)
echo "Drive Watcher disponível em ${watcher_url:-http://localhost:4317}"
echo 'Para acompanhar: docker compose logs -f --tail=100 app'
