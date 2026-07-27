#!/bin/bash
set -euo pipefail

for required in FIREBASE_PROJECT_ID FIREBASE_STORAGE_BUCKET GOOGLE_APPLICATION_CREDENTIALS; do
  if [[ -z "${!required:-}" ]]; then
    echo "[entrypoint] ${required} is required" >&2
    exit 1
  fi
done
if [[ ! -r "${GOOGLE_APPLICATION_CREDENTIALS}" ]]; then
  echo "[entrypoint] Firebase credential is not readable: ${GOOGLE_APPLICATION_CREDENTIALS}" >&2
  exit 1
fi

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8979}"
export AVALON_PORT="${AVALON_PORT:-3847}"
export AI_BFF_URL="${AI_BFF_URL:-http://127.0.0.1:3920}"
export CORS_ORIGIN="${CORS_ORIGIN:-*}"
export PUPPETEER_ARGS="${PUPPETEER_ARGS:---no-sandbox,--disable-setuid-sandbox}"
export WEB_CONCURRENCY="${WEB_CONCURRENCY:-}"
export PUPPETEER_CACHE_DIR="${PUPPETEER_CACHE_DIR:-/data/puppeteer}"
unset PUPPETEER_SKIP_DOWNLOAD PUPPETEER_SKIP_CHROME_DOWNLOAD

mkdir -p "${PUPPETEER_CACHE_DIR}"
echo "[entrypoint] ensuring Puppeteer Chrome in ${PUPPETEER_CACHE_DIR}"
if ! (cd /app/Athens-server && node ./scripts/ensure-puppeteer-chrome.mjs); then
  echo "[entrypoint] WARNING: Puppeteer Chrome install failed — resume PDF rendering may not work until fixed." >&2
fi

echo "[entrypoint] Firebase runtime configured for ${FIREBASE_PROJECT_ID}"
echo "[entrypoint] starting NextOffer services"
exec supervisord -c /app/docker/supervisord.conf
