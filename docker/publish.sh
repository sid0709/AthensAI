#!/usr/bin/env bash
# Rebuild the NextOffer image and push it to Docker Hub (updates the live tags).
#
# Usage:
#   ./docker/publish.sh 1.2.3              # linux/amd64 + latest (default — for servers)
#   ./docker/publish.sh 1.2.3 --arm64      # Apple Silicon / ARM Linux only
#   ./docker/publish.sh 1.2.3 --native     # current machine arch only
#   ./docker/publish.sh 1.2.3 --multi      # amd64 + arm64 via buildx --push
#   ./docker/publish.sh 1.2.3 --no-push    # build only (no Hub update)
#   ./docker/publish.sh latest             # rebuild + overwrite :latest only
#
# Env overrides:
#   DOCKER_IMAGE=omnimuh730/nextoffer
#   DOCKER_PLATFORM=linux/amd64
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMAGE="${DOCKER_IMAGE:-omnimuh730/nextoffer}"
VERSION="${1:-}"
PUSH=1
MODE="amd64" # amd64 | arm64 | native | multi

usage() {
  cat <<'EOF'
Usage: ./docker/publish.sh <version> [--amd64|--arm64|--native|--multi] [--no-push]

Examples:
  ./docker/publish.sh 1.0.1
  ./docker/publish.sh 1.0.1 --multi
  ./docker/publish.sh latest --no-push
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "$VERSION" ]]; then
  usage >&2
  exit 1
fi

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --amd64)  MODE="amd64" ;;
    --arm64)  MODE="arm64" ;;
    --native) MODE="native" ;;
    --multi)  MODE="multi" ;;
    --no-push) PUSH=0 ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
  shift
done

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed or not on PATH" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running. Start Docker Desktop and retry." >&2
  exit 1
fi

SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)"
TAGS=()

if [[ "$VERSION" == "latest" ]]; then
  TAGS+=("${IMAGE}:latest")
else
  TAGS+=("${IMAGE}:${VERSION}")
  TAGS+=("${IMAGE}:${VERSION}-${SHA}")
  TAGS+=("${IMAGE}:latest")
fi

tag_args=()
for t in "${TAGS[@]}"; do
  tag_args+=(-t "$t")
done

echo "== NextOffer Docker publish =="
echo "  image:    $IMAGE"
echo "  version:  $VERSION"
echo "  commit:   $SHA"
echo "  mode:     $MODE"
echo "  push:     $PUSH"
echo "  tags:     ${TAGS[*]}"
echo

build_local() {
  local platform="$1"
  echo "→ docker build --platform $platform …"
  docker build --platform "$platform" "${tag_args[@]}" .
}

push_tags() {
  if [[ "$PUSH" -ne 1 ]]; then
    echo "Skipping push (--no-push)."
    return
  fi
  for t in "${TAGS[@]}"; do
    echo "→ docker push $t"
    docker push "$t"
  done
}

ensure_builder() {
  local name="nextoffer-builder"
  if ! docker buildx inspect "$name" >/dev/null 2>&1; then
    docker buildx create --name "$name" --use >/dev/null
  else
    docker buildx use "$name" >/dev/null
  fi
}

case "$MODE" in
  amd64)
    PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"
    build_local "$PLATFORM"
    # Convenience arch tag when publishing a numbered version
    if [[ "$VERSION" != "latest" ]]; then
      docker tag "${IMAGE}:${VERSION}" "${IMAGE}:amd64"
      TAGS+=("${IMAGE}:amd64")
    fi
    push_tags
    ;;
  arm64)
    PLATFORM="${DOCKER_PLATFORM:-linux/arm64}"
    build_local "$PLATFORM"
    if [[ "$VERSION" != "latest" ]]; then
      docker tag "${IMAGE}:${VERSION}" "${IMAGE}:arm64"
      TAGS+=("${IMAGE}:arm64")
    fi
    push_tags
    ;;
  native)
    PLATFORM="${DOCKER_PLATFORM:-linux/$(uname -m | sed 's/x86_64/amd64/; s/aarch64/arm64/; s/arm64/arm64/')}"
    build_local "$PLATFORM"
    push_tags
    ;;
  multi)
    if [[ "$PUSH" -ne 1 ]]; then
      echo "--multi requires push (buildx multi-arch cannot load both platforms locally)." >&2
      exit 1
    fi
    ensure_builder
    echo "→ docker buildx build --platform linux/amd64,linux/arm64 --push …"
    docker buildx build \
      --platform linux/amd64,linux/arm64 \
      "${tag_args[@]}" \
      --push \
      .
    ;;
esac

echo
echo "Done."
if [[ "$PUSH" -eq 1 ]]; then
  echo "Hub: https://hub.docker.com/r/${IMAGE%/*}/${IMAGE#*/}"
  echo "Pull: docker pull ${IMAGE}:latest"
fi
