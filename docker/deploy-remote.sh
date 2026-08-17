#!/usr/bin/env bash
# Recreate the athens-backend NextOffer container on the VPS.
set -euo pipefail

IMAGE_DEFAULT="${DOCKER_IMAGE:-omnimuh730/nextoffer}"
TAG_OR_REF="${1:-latest}"
DEPLOY_ENV="${DEPLOY_ENV:-/opt/nextoffer/deploy.env}"
CONTAINER_NAME="${CONTAINER_NAME:-nextoffer}"
MONITORING_NETWORK="${MONITORING_NETWORK:-athens-monitoring}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8980/readyz}"
STATUS_URL="${STATUS_URL:-http://127.0.0.1:9030/api/status/current}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-36}"
HEALTH_SLEEP_SEC="${HEALTH_SLEEP_SEC:-5}"

[[ -f "$DEPLOY_ENV" ]] || { echo "Missing deploy env file: $DEPLOY_ENV" >&2; exit 1; }
# shellcheck disable=SC1090
set -a
source "$DEPLOY_ENV"
set +a

: "${API_KEYS_ENCRYPTION_KEY:?API_KEYS_ENCRYPTION_KEY must be set in $DEPLOY_ENV}"
: "${DATABASE_URL:?DATABASE_URL must be set in $DEPLOY_ENV}"
: "${FIREBASE_PROJECT_ID:?FIREBASE_PROJECT_ID must be set in $DEPLOY_ENV}"
: "${FIREBASE_STORAGE_BUCKET:?FIREBASE_STORAGE_BUCKET must be set in $DEPLOY_ENV}"
: "${FIREBASE_SECRET_HOST_PATH:?FIREBASE_SECRET_HOST_PATH must be set in $DEPLOY_ENV}"
: "${KMS_KEY_NAME:?KMS_KEY_NAME must be set in $DEPLOY_ENV}"
[[ -f "$FIREBASE_SECRET_HOST_PATH" ]] || { echo "Missing Firebase secret file: $FIREBASE_SECRET_HOST_PATH" >&2; exit 1; }

if [[ "$TAG_OR_REF" == *:* ]]; then IMAGE_REF="$TAG_OR_REF"; else IMAGE_REF="${IMAGE_DEFAULT}:${TAG_OR_REF}"; fi
docker network inspect "$MONITORING_NETWORK" >/dev/null 2>&1 || {
	echo "Monitoring network $MONITORING_NETWORK is unavailable." >&2
	exit 1
}

echo "Pulling $IMAGE_REF"
docker pull "$IMAGE_REF"
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

# 3g leaves RAM for OS + monitoring + a local mongod. Two Node heaps
# (768+512) plus nginx fit; the old 8GB V8 heap did not.
MEMORY_LIMIT="${ATHENS_CONTAINER_MEMORY:-3g}"

docker run -d \
	--name "$CONTAINER_NAME" \
	--restart unless-stopped \
	--memory="${MEMORY_LIMIT}" \
	--memory-swap="${MEMORY_LIMIT}" \
	--network "$MONITORING_NETWORK" \
	--add-host=host.docker.internal:host-gateway \
	--env-file "$DEPLOY_ENV" \
	-p 127.0.0.1:9030:80 \
	-p 127.0.0.1:8980:8980 \
	-v "${FIREBASE_SECRET_HOST_PATH}:/run/secrets/firebase-service-account.json:ro" \
	-e GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase-service-account.json \
	-e PORT=8980 \
	-e METRICS_PORT=9101 \
	"$IMAGE_REF"

wait_for_url() {
	local url="$1"
	for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++)); do
		if curl -fsS "$url" >/dev/null 2>&1; then return 0; fi
		sleep "$HEALTH_SLEEP_SEC"
	done
	echo "Health check failed: $url" >&2
	docker logs --tail 120 "$CONTAINER_NAME" || true
	return 1
}

wait_for_url "$HEALTH_URL"
wait_for_url "$STATUS_URL"
docker exec "$CONTAINER_NAME" node -e "require('http').get('http://127.0.0.1:8981/readyz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" || {
	echo "Worker health check failed" >&2
	docker logs --tail 80 "$CONTAINER_NAME" || true
	exit 1
}

# Local mongod only. Remote Atlas/hosts are skipped inside the script.
if [[ -x /opt/nextoffer/tune-mongod-cache.sh ]]; then
	/opt/nextoffer/tune-mongod-cache.sh || true
elif [[ -f "$(dirname "$0")/tune-mongod-cache.sh" ]]; then
	bash "$(dirname "$0")/tune-mongod-cache.sh" || true
fi

docker exec "$CONTAINER_NAME" node --input-type=module -e '
	const response = await fetch("http://127.0.0.1:8980/api/status/current", { signal: AbortSignal.timeout(5000) });
	const payload = await response.json();
	const required = ["athens-api"];
	const components = new Map((payload.components || []).map((item) => [item.component, item]));
	if (!response.ok || !required.every((id) => components.has(id))) process.exit(1);
'

echo "Deploy OK: $IMAGE_REF"
curl -sS "$HEALTH_URL" || true
echo
