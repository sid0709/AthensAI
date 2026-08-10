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
export BACKGROUND_WORKERS_MODE="${BACKGROUND_WORKERS_MODE:-embedded}"
export METRICS_PORT="${METRICS_PORT:-9101}"
export MONITORING_ENABLED="${MONITORING_ENABLED:-true}"
export PROMETHEUS_URL="${PROMETHEUS_URL:-http://prometheus:9090}"

echo "[entrypoint] Firebase runtime configured for ${FIREBASE_PROJECT_ID}"

# Mongo indexes / unique constraints must match schema.prisma before Nest serves.
# Image build only runs prisma generate; db push needs DATABASE_URL at runtime.
echo "[entrypoint] syncing Prisma schema (prisma db push)"
npm run prisma:push --prefix athens-backend

echo "[entrypoint] starting athens-backend on :${PORT} (workers=${BACKGROUND_WORKERS_MODE})"
exec supervisord -c /app/docker/supervisord.conf
