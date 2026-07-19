#!/bin/bash
set -euo pipefail

MONGO_URL="${MONGO_URL:-mongodb://127.0.0.1:27017}"
EMBEDDED_MONGO="${EMBEDDED_MONGO:-auto}"

should_start_embedded_mongo() {
  if [[ "${EMBEDDED_MONGO}" == "false" || "${EMBEDDED_MONGO}" == "0" ]]; then
    return 1
  fi
  if [[ "${EMBEDDED_MONGO}" == "true" || "${EMBEDDED_MONGO}" == "1" ]]; then
    return 0
  fi
  [[ "${MONGO_URL}" =~ ^mongodb://(127\.0\.0\.1|localhost)([:/]|$) ]]
}

wait_for_port() {
  local host="$1"
  local port="$2"
  local label="$3"
  local attempts="${4:-90}"

  for ((i = 1; i <= attempts; i++)); do
    if node -e "
      const net = require('net');
      const socket = net.connect({ host: '${host}', port: ${port} }, () => {
        socket.end();
        process.exit(0);
      });
      socket.on('error', () => process.exit(1));
      setTimeout(() => process.exit(1), 1000);
    " 2>/dev/null; then
      echo "[entrypoint] ${label} is ready on ${host}:${port}"
      return 0
    fi
    sleep 1
  done

  echo "[entrypoint] timed out waiting for ${label} on ${host}:${port}" >&2
  return 1
}

if should_start_embedded_mongo; then
  echo "[entrypoint] starting embedded MongoDB"
  mkdir -p /data/db /var/log/mongodb
  if ! pgrep -x mongod >/dev/null 2>&1; then
    mongod --fork --logpath /var/log/mongodb/mongod.log --bind_ip 127.0.0.1 --dbpath /data/db
  fi
  wait_for_port 127.0.0.1 27017 "MongoDB"
else
  echo "[entrypoint] using external MongoDB at ${MONGO_URL}"
  node -e "
    const { MongoClient } = require('mongodb');
    const url = process.env.MONGO_URL;
    (async () => {
      for (let i = 0; i < 90; i++) {
        try {
          const client = new MongoClient(url, { serverSelectionTimeoutMS: 1000 });
          await client.connect();
          await client.db().admin().ping();
          await client.close();
          process.exit(0);
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      console.error('timed out waiting for external MongoDB');
      process.exit(1);
    })();
  "
fi

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8979}"
export AVALON_PORT="${AVALON_PORT:-3847}"
export AI_BFF_URL="${AI_BFF_URL:-http://127.0.0.1:3920}"
export MONGO_DB="${MONGO_DB:-AthensDB}"
export CORS_ORIGIN="${CORS_ORIGIN:-*}"
export PUPPETEER_ARGS="${PUPPETEER_ARGS:---no-sandbox,--disable-setuid-sandbox}"
# Empty = use all CPU cores inside Athens-server cluster bootstrap.
export WEB_CONCURRENCY="${WEB_CONCURRENCY:-}"
# Persist Chrome on the VPS volume so recreating the container does not re-download.
export PUPPETEER_CACHE_DIR="${PUPPETEER_CACHE_DIR:-/data/puppeteer}"
# Allow install even if the image was built with skip flags.
unset PUPPETEER_SKIP_DOWNLOAD PUPPETEER_SKIP_CHROME_DOWNLOAD

mkdir -p "${PUPPETEER_CACHE_DIR}"
echo "[entrypoint] ensuring Puppeteer Chrome in ${PUPPETEER_CACHE_DIR}"
if ! (cd /app/Athens-server && node ./scripts/ensure-puppeteer-chrome.mjs); then
  echo "[entrypoint] WARNING: Puppeteer Chrome install failed — resume PDF rendering may not work until fixed." >&2
fi

echo "[entrypoint] starting NextOffer services"
exec supervisord -c /app/docker/supervisord.conf
