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
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:9030/avalon/health}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-36}"
HEALTH_SLEEP_SEC="${HEALTH_SLEEP_SEC:-5}"

if [[ ! -f "$DEPLOY_ENV" ]]; then
  echo "Missing deploy env file: $DEPLOY_ENV" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$DEPLOY_ENV"
set +a

: "${MONGO_URL:?MONGO_URL must be set in $DEPLOY_ENV}"
: "${MONGO_DB:?MONGO_DB must be set in $DEPLOY_ENV}"
: "${API_KEYS_ENCRYPTION_KEY:?API_KEYS_ENCRYPTION_KEY must be set in $DEPLOY_ENV}"
: "${FIREBASE_PROJECT_ID:?FIREBASE_PROJECT_ID must be set in $DEPLOY_ENV}"
: "${FIREBASE_STORAGE_BUCKET:?FIREBASE_STORAGE_BUCKET must be set in $DEPLOY_ENV}"
: "${GOOGLE_APPLICATION_CREDENTIALS:?GOOGLE_APPLICATION_CREDENTIALS must be set in $DEPLOY_ENV}"
: "${FIREBASE_SECRET_HOST_PATH:?FIREBASE_SECRET_HOST_PATH must be set in $DEPLOY_ENV}"

EMBEDDED_MONGO="${EMBEDDED_MONGO:-false}"

if [[ "$TAG_OR_REF" == *:* ]]; then
  IMAGE_REF="$TAG_OR_REF"
else
  IMAGE_REF="${IMAGE_DEFAULT}:${TAG_OR_REF}"
fi

if [[ ! -f "$FIREBASE_SECRET_HOST_PATH" ]]; then
  echo "Missing Firebase secret file: $FIREBASE_SECRET_HOST_PATH" >&2
  exit 1
fi

echo "Pulling ${IMAGE_REF} ..."
docker pull "$IMAGE_REF"

echo "Recreating container ${CONTAINER_NAME} ..."
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -p 9030:80 \
  -p 8979:8979 \
  -p 3920:3920 \
  -v nextoffer-puppeteer:/data/puppeteer \
  -v "${FIREBASE_SECRET_HOST_PATH}:/run/secrets/firebase-service-account.json:ro" \
  -e "EMBEDDED_MONGO=${EMBEDDED_MONGO}" \
  -e "MONGO_URL=${MONGO_URL}" \
  -e "MONGO_DB=${MONGO_DB}" \
  -e "API_KEYS_ENCRYPTION_KEY=${API_KEYS_ENCRYPTION_KEY}" \
  -e "FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}" \
  -e "FIREBASE_STORAGE_BUCKET=${FIREBASE_STORAGE_BUCKET}" \
  -e "GOOGLE_APPLICATION_CREDENTIALS=${GOOGLE_APPLICATION_CREDENTIALS}" \
  "$IMAGE_REF"

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

echo "Deploy OK: ${IMAGE_REF}"
curl -sS "$HEALTH_URL" || true
echo
