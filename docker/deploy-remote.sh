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
RANKING_COMPOSE_FILE="${RANKING_COMPOSE_FILE:-/opt/nextoffer/ranking-compose.yml}"
RANKING_COMPOSE_PROJECT="${RANKING_COMPOSE_PROJECT:-nextoffer-ranking}"
RANKING_AUTO_BACKFILL="${RANKING_AUTO_BACKFILL:-true}"
RANKING_BOOTSTRAP_KEY="${RANKING_BOOTSTRAP_KEY:-nextoffer:ranking-backfill:v3}"

if [[ ! -f "$DEPLOY_ENV" ]]; then
  echo "Missing deploy env file: $DEPLOY_ENV" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$DEPLOY_ENV"
set +a

: "${API_KEYS_ENCRYPTION_KEY:?API_KEYS_ENCRYPTION_KEY must be set in $DEPLOY_ENV}"

FIREBASE_AUTH_REQUIRED="${FIREBASE_AUTH_REQUIRED:-false}"
BACKGROUND_WORKERS_MODE="${BACKGROUND_WORKERS_MODE:-local}"
FIRESTORE_WRITES_ENABLED="${FIRESTORE_WRITES_ENABLED:-false}"
FIRESTORE_COMPAT_WARN_SCAN="${FIRESTORE_COMPAT_WARN_SCAN:-1000}"
FIRESTORE_COMPAT_MAX_SCAN="${FIRESTORE_COMPAT_MAX_SCAN:-20000}"
REDIS_ENABLED="${REDIS_ENABLED:-true}"
REDIS_URL="${REDIS_URL:-redis://redis:6379}"
QDRANT_URL="${QDRANT_URL:-http://qdrant:6333}"
QDRANT_API_KEY="${QDRANT_API_KEY:-}"
RECOMMENDATION_QUERY_TIME_MODE="${RECOMMENDATION_QUERY_TIME_MODE:-on}"
RANKING_BACKFILL_BATCH="${RANKING_BACKFILL_BATCH:-200}"

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

if docker compose version >/dev/null 2>&1; then
  compose_cmd=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  compose_cmd=(docker-compose)
else
  echo "Docker Compose is required to provision Redis and Qdrant." >&2
  exit 1
fi

if [[ ! -f "$RANKING_COMPOSE_FILE" ]]; then
  echo "Missing ranking infrastructure definition: ${RANKING_COMPOSE_FILE}" >&2
  exit 1
fi

ranking_compose=("${compose_cmd[@]}" -p "$RANKING_COMPOSE_PROJECT" -f "$RANKING_COMPOSE_FILE")
export ATHENS_DOCKER_NETWORK="$MONITORING_NETWORK"

for service in redis qdrant; do
  if [[ -n "$("${ranking_compose[@]}" ps -q "$service" 2>/dev/null || true)" ]]; then
    echo "${service} container exists; preserving its persistent volume."
  else
    echo "${service} container is missing; Docker Compose will create it."
  fi
done

echo "Validating Redis and Qdrant Compose configuration"
"${ranking_compose[@]}" config >/dev/null
echo "Pulling Redis and Qdrant images"
"${ranking_compose[@]}" pull
echo "Starting Redis and Qdrant"
"${ranking_compose[@]}" up -d

wait_for_ranking_service() {
  local service="$1"
  local id=""
  local health=""
  for ((attempt = 1; attempt <= 60; attempt++)); do
    id="$("${ranking_compose[@]}" ps -q "$service" 2>/dev/null || true)"
    if [[ -n "$id" ]]; then
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || true)"
      if [[ "$health" == "healthy" ]]; then
        echo "${service} is healthy."
        return 0
      fi
      if [[ "$health" == "unhealthy" || "$health" == "exited" || "$health" == "dead" ]]; then
        break
      fi
    fi
    sleep 2
  done
  echo "${service} failed to become healthy (state: ${health:-missing})." >&2
  "${ranking_compose[@]}" logs --tail 100 "$service" >&2 || true
  return 1
}

wait_for_ranking_service redis
wait_for_ranking_service qdrant

echo "Recreating container ${CONTAINER_NAME} ..."
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  "${network_args[@]}" \
  --add-host=host.docker.internal:host-gateway \
  -p 127.0.0.1:9030:80 \
  -p 127.0.0.1:8979:8979 \
  -p 127.0.0.1:3920:3920 \
  -v nextoffer-puppeteer:/data/puppeteer \
  "${volume_args[@]}" \
  -e "API_KEYS_ENCRYPTION_KEY=${API_KEYS_ENCRYPTION_KEY}" \
  -e "FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID:-}" \
  -e "FIREBASE_STORAGE_BUCKET=${FIREBASE_STORAGE_BUCKET:-}" \
  -e "GOOGLE_APPLICATION_CREDENTIALS=${GOOGLE_APPLICATION_CREDENTIALS:-}" \
  -e "KMS_KEY_NAME=${KMS_KEY_NAME:-}" \
  -e "FIREBASE_AUTH_REQUIRED=${FIREBASE_AUTH_REQUIRED}" \
  -e "BACKGROUND_WORKERS_MODE=${BACKGROUND_WORKERS_MODE}" \
  -e "FIRESTORE_WRITES_ENABLED=${FIRESTORE_WRITES_ENABLED}" \
  -e "DEEPSEEK_MAX_OUTPUT_TOKENS=${DEEPSEEK_MAX_OUTPUT_TOKENS:-131072}" \
  -e "FIRESTORE_COMPAT_WARN_SCAN=${FIRESTORE_COMPAT_WARN_SCAN}" \
  -e "FIRESTORE_COMPAT_MAX_SCAN=${FIRESTORE_COMPAT_MAX_SCAN}" \
  -e "REDIS_ENABLED=${REDIS_ENABLED}" \
  -e "REDIS_URL=${REDIS_URL}" \
  -e "QDRANT_URL=${QDRANT_URL}" \
  -e "QDRANT_API_KEY=${QDRANT_API_KEY}" \
  -e "RECOMMENDATION_QUERY_TIME_MODE=${RECOMMENDATION_QUERY_TIME_MODE}" \
  -e "RANKING_BACKFILL_BATCH=${RANKING_BACKFILL_BATCH}" \
  -e "SEARCH_OUTBOX_INTERVAL_MS=${SEARCH_OUTBOX_INTERVAL_MS:-5000}" \
  -e "SEARCH_OUTBOX_BATCH_SIZE=${SEARCH_OUTBOX_BATCH_SIZE:-100}" \
  -e "ALGOLIA_APP_ID=${ALGOLIA_APP_ID:-}" \
  -e "ALGOLIA_ADMIN_API_KEY=${ALGOLIA_ADMIN_API_KEY:-}" \
  -e "ALGOLIA_JOBS_INDEX=${ALGOLIA_JOBS_INDEX:-athens_jobs}" \
  -e "PROMETHEUS_URL=${PROMETHEUS_URL}" \
  -e "METRICS_PORT=9101" \
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
    const results = payload?.data?.result || [];
    const hasLiveNodeExporter = results.some((series) => series?.value?.[1] === "1");
    if (!response.ok || payload?.status !== "success" || !hasLiveNodeExporter) process.exit(1);
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

echo "Verifying application access to Redis and Qdrant"
docker exec -w /app/Athens-server "$CONTAINER_NAME" node --input-type=module -e '
  import { createClient } from "redis";
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();
  if (await redis.ping() !== "PONG") throw new Error("Redis ping failed");
  await redis.quit();
  const qdrantUrl = `${process.env.QDRANT_URL.replace(/\/+$/, "")}/readyz`;
  const headers = process.env.QDRANT_API_KEY ? { "api-key": process.env.QDRANT_API_KEY } : {};
  const response = await fetch(qdrantUrl, { headers, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Qdrant readiness failed: ${response.status}`);
'

echo "Waiting for the complete monitoring signal"
monitoring_ok=0
for ((i = 1; i <= 36; i++)); do
  if docker exec "$CONTAINER_NAME" node --input-type=module -e '
    const requiredComponents = ["athens-web", "athens-api", "ai-bff", "avalon-relay", "redis", "qdrant", "vps", "public-api"];
    const response = await fetch("http://127.0.0.1:8979/api/status/current", { signal: AbortSignal.timeout(5000) });
    const payload = await response.json();
    const byId = new Map((payload.components || []).map((item) => [item.component, item]));
    const now = Date.now();
    if (!response.ok || !requiredComponents.every((id) => byId.has(id))) process.exit(1);
    if (!requiredComponents.every((id) => byId.get(id).lastCheckedAt && now - new Date(byId.get(id).lastCheckedAt).getTime() < 180000)) process.exit(1);
  ' >/dev/null 2>&1; then
    monitoring_ok=1
    break
  fi
  sleep 5
done
if [[ "$monitoring_ok" -ne 1 ]]; then
  echo "The complete v2 monitoring signal did not become fresh." >&2
  docker logs --tail 120 "$CONTAINER_NAME" || true
  exit 1
fi

echo "Verifying VPS-local Prometheus targets and v2 Firestore snapshot"
targets_ok=0
for ((i = 1; i <= 24; i++)); do
  if docker exec "$CONTAINER_NAME" node --input-type=module -e '
    const base = process.env.PROMETHEUS_URL.replace(/\/+$/, "");
    const url = new URL("/api/v1/query", `${base}/`);
    url.searchParams.set("query", "up{job=~\"athens-server|redis|qdrant|node\"}");
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const payload = await response.json();
    const rows = payload?.data?.result || [];
    const jobs = new Map(rows.map((row) => [row.metric?.job, row.value?.[1]]));
    for (const job of ["athens-server", "redis", "qdrant", "node"]) {
      if (jobs.get(job) !== "1") process.exit(1);
    }
    const { getFirestoreDb } = await import("./Athens-server/src/services/firebase/firebaseAdmin.js");
    const snapshot = await getFirestoreDb().collection("monitor_status_v2").doc("production").get();
    if (!snapshot.exists || snapshot.data()?.version !== 2) process.exit(1);
  ' >/dev/null 2>&1; then
    targets_ok=1
    break
  fi
  sleep 5
done
if [[ "$targets_ok" -ne 1 ]]; then
  echo "A required Prometheus target or the Firestore v2 snapshot is unavailable." >&2
  exit 1
fi

if [[ "${RECOMMENDATION_QUERY_TIME_MODE,,}" == "on" || "${RECOMMENDATION_QUERY_TIME_MODE,,}" == "shadow" ]]; then
  bootstrap_state="$("${ranking_compose[@]}" exec -T redis redis-cli --raw GET "$RANKING_BOOTSTRAP_KEY" 2>/dev/null || true)"
  ranking_point_count="$(docker exec "$CONTAINER_NAME" node --input-type=module -e '
    const base = process.env.QDRANT_URL.replace(/\/+$/, "");
    const headers = { "Content-Type": "application/json" };
    if (process.env.QDRANT_API_KEY) headers["api-key"] = process.env.QDRANT_API_KEY;
    const response = await fetch(`${base}/collections/jobs_active/points/count`, {
      method: "POST",
      headers,
      body: JSON.stringify({ exact: true }),
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404) {
      console.log(0);
    } else {
      if (!response.ok) throw new Error(`Qdrant count failed: ${response.status}`);
      const payload = await response.json();
      console.log(Number(payload?.result?.count || 0));
    }
  ')"
  if [[ "$bootstrap_state" != "complete" || "$ranking_point_count" -eq 0 ]]; then
    if [[ "${RANKING_AUTO_BACKFILL,,}" == "true" || "$RANKING_AUTO_BACKFILL" == "1" ]]; then
      echo "Ranking index is missing or uninitialized; indexing authoritative jobs now."
      docker exec "$CONTAINER_NAME" npm run backfill-query-ranking -w Athens-server
      "${ranking_compose[@]}" exec -T redis redis-cli SET "$RANKING_BOOTSTRAP_KEY" complete >/dev/null
      echo "Initial Redis/Qdrant ranking backfill is complete."
    else
      echo "RANKING_AUTO_BACKFILL is disabled; Best Match may use fallback ordering until the ranking backfill is run." >&2
    fi
  else
    echo "Persistent ranking index is already initialized (${ranking_point_count} points); no backfill is needed."
  fi
fi

echo "Deploy OK: ${IMAGE_REF}"
curl -sS "$HEALTH_URL" || true
echo
