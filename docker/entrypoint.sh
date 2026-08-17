#!/bin/bash
set -euo pipefail

for required in FIREBASE_PROJECT_ID FIREBASE_STORAGE_BUCKET GOOGLE_APPLICATION_CREDENTIALS DATABASE_URL API_KEYS_ENCRYPTION_KEY; do
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
export PORT="${PORT:-8980}"
export CORS_ORIGIN="${CORS_ORIGIN:-*}"
export METRICS_PORT="${METRICS_PORT:-9101}"
export MONITORING_ENABLED="${MONITORING_ENABLED:-true}"
export PROMETHEUS_URL="${PROMETHEUS_URL:-http://prometheus:9090}"

# Heap caps: V8 will not reclaim until it approaches max-old-space-size.
# 8192 on a 4–8GB VPS fills RAM in a few hours at idle. Override via deploy.env.
export NODE_MAX_OLD_SPACE_SIZE="${NODE_MAX_OLD_SPACE_SIZE:-768}"
export NODE_WORKER_MAX_OLD_SPACE_SIZE="${NODE_WORKER_MAX_OLD_SPACE_SIZE:-512}"
export WORKER_PORT="${WORKER_PORT:-8981}"
export WORKER_HEALTH_URL="${WORKER_HEALTH_URL:-http://127.0.0.1:${WORKER_PORT}/readyz}"

echo "[entrypoint] Firebase runtime configured for ${FIREBASE_PROJECT_ID}"

# Mongo indexes / unique constraints must match schema.prisma before Nest serves.
# Image build only runs prisma generate; db push needs DATABASE_URL at runtime.
echo "[entrypoint] syncing Prisma schema (prisma db push)"
npm run prisma:push --prefix athens-backend

echo "[entrypoint] starting athens-backend on :${PORT} (api heap=${NODE_MAX_OLD_SPACE_SIZE} worker heap=${NODE_WORKER_MAX_OLD_SPACE_SIZE} worker :${WORKER_PORT})"
exec supervisord -c /app/docker/supervisord.conf
