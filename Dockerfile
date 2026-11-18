FROM node:22.23.4-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY public/cuts-split-layout.js public/cuts-split-layout.d.ts ./public/
RUN npm run build && npm prune --omit=dev

FROM node:22.23.4-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 python3-venv fonts-dejavu-core libgomp1 && rm -rf /var/lib/apt/lists/*
COPY requirements-cuts.txt /tmp/requirements-cuts.txt
RUN python3 -m venv /opt/cuts && /opt/cuts/bin/pip install --no-cache-dir -r /tmp/requirements-cuts.txt && rm /tmp/requirements-cuts.txt
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4317 DATA_DIR=/app/data CUTS_PYTHON=/opt/cuts/bin/python
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY public ./public
COPY scripts/transcribe-cuts.py ./scripts/transcribe-cuts.py
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 4317
CMD ["node", "dist/server.js"]
