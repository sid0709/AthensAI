#!/usr/bin/env bash
# Recreate the nextoffer container on the VPS.
#
# Installed on the server as /opt/nextoffer/deploy.sh (CI copies this file).
# Secrets live in /opt/nextoffer/deploy.env (not in git).
#
# Usage:
#   /opt/nextoffer/deploy.sh              # omnimuh730/nextoffer:latest
#   /opt/nextoffer/deploy.sh sha-abc1234  # tag only
#   /opt/nextoffer/deploy.sh omnimuh730/nextoffer:sha-abc1234
#
set -euo pipefail

IMAGE_DEFAULT="${DOCKER_IMAGE:-omnimuh730/nextoffer}"
TAG_OR_REF="${1:-latest}"
DEPLOY_ENV="${DEPLOY_ENV:-/opt/nextoffer/deploy.env}"
CONTAINER_NAME="${CONTAINER_NAME:-nextoffer}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8979/readyz}"
STATUS_URL="${STATUS_URL:-http://127.0.0.1:9030/api/status/current}"
AI_BFF_HEALTH_URL="${AI_BFF_HEALTH_URL:-http://127.0.0.1:3920/health}"
AVALON_HEALTH_URL="${AVALON_HEALTH_URL:-http://127.0.0.1:9030/avalon/health}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-36}"
HEALTH_SLEEP_SEC="${HEALTH_SLEEP_SEC:-5}"
MONITORING_NETWORK="${MONITORING_NETWORK:-athens-monitoring}"
PROMETHEUS_URL="${PROMETHEUS_URL:-http://prometheus:9090}"

if [[ ! -f "$DEPLOY_ENV" ]]; then
  echo "Missing deploy env file: $DEPLOY_ENV" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$DEPLOY_ENV"
set +a

: "${API_KEYS_ENCRYPTION_KEY:?API_KEYS_ENCRYPTION_KEY must be set in $DEPLOY_ENV}"

DATABASE_BACKEND="${DATABASE_BACKEND:-mongo}"
EMBEDDED_MONGO="${EMBEDDED_MONGO:-false}"
FIREBASE_AUTH_REQUIRED="${FIREBASE_AUTH_REQUIRED:-false}"
BACKGROUND_WORKERS_MODE="${BACKGROUND_WORKERS_MODE:-local}"
FIRESTORE_WRITES_ENABLED="${FIRESTORE_WRITES_ENABLED:-false}"
FIRESTORE_COMPAT_WARN_SCAN="${FIRESTORE_COMPAT_WARN_SCAN:-1000}"
FIRESTORE_COMPAT_MAX_SCAN="${FIRESTORE_COMPAT_MAX_SCAN:-20000}"

volume_args=()
if [[ "${DATABASE_BACKEND,,}" == "firestore" ]]; then
  : "${FIREBASE_PROJECT_ID:?FIREBASE_PROJECT_ID must be set in $DEPLOY_ENV}"
  : "${FIREBASE_STORAGE_BUCKET:?FIREBASE_STORAGE_BUCKET must be set in $DEPLOY_ENV}"
  : "${GOOGLE_APPLICATION_CREDENTIALS:?GOOGLE_APPLICATION_CREDENTIALS must be set in $DEPLOY_ENV}"
  : "${FIREBASE_SECRET_HOST_PATH:?FIREBASE_SECRET_HOST_PATH must be set in $DEPLOY_ENV}"
  : "${KMS_KEY_NAME:?KMS_KEY_NAME must be set in $DEPLOY_ENV}"
  if [[ ! -f "$FIREBASE_SECRET_HOST_PATH" ]]; then
    echo "Missing Firebase secret file: $FIREBASE_SECRET_HOST_PATH" >&2
    exit 1
  fi
  if [[ "${GOOGLE_APPLICATION_CREDENTIALS}" != "/run/secrets/firebase-service-account.json" ]]; then
    echo "GOOGLE_APPLICATION_CREDENTIALS must be /run/secrets/firebase-service-account.json" >&2
    exit 1
  fi
  volume_args=(-v "${FIREBASE_SECRET_HOST_PATH}:/run/secrets/firebase-service-account.json:ro")
  EMBEDDED_MONGO=false
else
  : "${MONGO_URL:?MONGO_URL must be set in $DEPLOY_ENV when DATABASE_BACKEND= mongo}"
  : "${MONGO_DB:?MONGO_DB must be set in $DEPLOY_ENV when DATABASE_BACKEND= mongo}"
fi

if [[ "$TAG_OR_REF" == *:* ]]; then
  IMAGE_REF="$TAG_OR_REF"
else
  IMAGE_REF="${IMAGE_DEFAULT}:${TAG_OR_REF}"
fi

echo "Pulling ${IMAGE_REF} ..."
docker pull "$IMAGE_REF"

if ! docker network inspect "$MONITORING_NETWORK" >/dev/null 2>&1; then
  echo "Monitoring network ${MONITORING_NETWORK} is unavailable; refusing to replace the healthy application with an unmonitored deployment." >&2
  exit 1
fi
network_args=(--network "$MONITORING_NETWORK")

echo "Recreating container ${CONTAINER_NAME} ..."
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  "${network_args[@]}" \
  --add-host=host.docker.internal:host-gateway \
  -p 9030:80 \
  -p 8979:8979 \
  -p 3920:3920 \
  -v nextoffer-puppeteer:/data/puppeteer \
  "${volume_args[@]}" \
  -e "DATABASE_BACKEND=${DATABASE_BACKEND}" \
  -e "EMBEDDED_MONGO=${EMBEDDED_MONGO}" \
  -e "MONGO_URL=${MONGO_URL:-}" \
  -e "MONGO_DB=${MONGO_DB:-AthensDB}" \
  -e "API_KEYS_ENCRYPTION_KEY=${API_KEYS_ENCRYPTION_KEY}" \
  -e "FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID:-}" \
  -e "FIREBASE_STORAGE_BUCKET=${FIREBASE_STORAGE_BUCKET:-}" \
  -e "GOOGLE_APPLICATION_CREDENTIALS=${GOOGLE_APPLICATION_CREDENTIALS:-}" \
  -e "KMS_KEY_NAME=${KMS_KEY_NAME:-}" \
  -e "FIREBASE_AUTH_REQUIRED=${FIREBASE_AUTH_REQUIRED}" \
  -e "BACKGROUND_WORKERS_MODE=${BACKGROUND_WORKERS_MODE}" \
  -e "FIRESTORE_WRITES_ENABLED=${FIRESTORE_WRITES_ENABLED}" \
  -e "FIRESTORE_COMPAT_WARN_SCAN=${FIRESTORE_COMPAT_WARN_SCAN}" \
  -e "FIRESTORE_COMPAT_MAX_SCAN=${FIRESTORE_COMPAT_MAX_SCAN}" \
  -e "SEARCH_OUTBOX_INTERVAL_MS=${SEARCH_OUTBOX_INTERVAL_MS:-5000}" \
  -e "SEARCH_OUTBOX_BATCH_SIZE=${SEARCH_OUTBOX_BATCH_SIZE:-100}" \
  -e "ALGOLIA_APP_ID=${ALGOLIA_APP_ID:-}" \
  -e "ALGOLIA_ADMIN_API_KEY=${ALGOLIA_ADMIN_API_KEY:-}" \
  -e "ALGOLIA_JOBS_INDEX=${ALGOLIA_JOBS_INDEX:-athens_jobs}" \
  -e "PROMETHEUS_URL=${PROMETHEUS_URL}" \
  "$IMAGE_REF"

echo "Verifying private Prometheus and node-exporter connectivity"
prometheus_ok=0
for ((i = 1; i <= 24; i++)); do
  if docker exec "$CONTAINER_NAME" node --input-type=module -e '
    const base = process.env.PROMETHEUS_URL;
    const url = new URL("/api/v1/query", `${base.replace(/\/+$/, "")}/`);
    url.searchParams.set("query", "up{job=\"node\"}");
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const payload = await response.json();
    if (!response.ok || payload?.status !== "success" || payload?.data?.result?.[0]?.value?.[1] !== "1") process.exit(1);
  ' >/dev/null 2>&1; then
    prometheus_ok=1
    break
  fi
  sleep 5
done
if [[ "$prometheus_ok" -ne 1 ]]; then
  echo "Athens cannot read current VPS metrics from Prometheus/node-exporter." >&2
  docker logs --tail 80 "$CONTAINER_NAME" || true
  exit 1
fi

echo "Waiting for health: ${HEALTH_URL}"
ok=0
for ((i = 1; i <= HEALTH_ATTEMPTS; i++)); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep "$HEALTH_SLEEP_SEC"
done

if [[ "$ok" -ne 1 ]]; then
  echo "Health check failed after ${HEALTH_ATTEMPTS} attempts" >&2
  docker logs --tail 80 "$CONTAINER_NAME" || true
  exit 1
fi

for required_url in "$AI_BFF_HEALTH_URL" "$AVALON_HEALTH_URL" "$STATUS_URL"; do
  echo "Verifying ${required_url}"
  ok=0
  for ((i = 1; i <= HEALTH_ATTEMPTS; i++)); do
    if curl -fsS "$required_url" >/dev/null 2>&1; then ok=1; break; fi
    sleep "$HEALTH_SLEEP_SEC"
  done
  if [[ "$ok" -ne 1 ]]; then
    echo "Required post-deploy check failed: ${required_url}" >&2
    docker logs --tail 80 "$CONTAINER_NAME" || true
    exit 1
  fi
done

echo "Deploy OK: ${IMAGE_REF}"
curl -sS "$HEALTH_URL" || true
echo
