#!/usr/bin/env bash
# Pack Chrome extensions into Athens/dist/downloads/ for the Apps & Plugins page.
# Invoked from the Docker image build.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${EXTENSION_OUTPUT_DIR:-${ROOT}/Athens/dist/downloads}"
AVALON_ZIP_NAME="avalon-extension.zip"
LENS_ZIP_NAME="athens-lens-extension.zip"

PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-}"
if [[ -z "${PUBLIC_ORIGIN}" && -z "${WXT_AVALON_RELAY_URL:-}" && -z "${WXT_API_URL:-}" && -z "${ATHENS_API_URL:-}" && -z "${WXT_ATHENS_API_URL:-}" ]]; then
  echo "error: set PUBLIC_ORIGIN (or WXT_*/ATHENS_API_URL) before packing extensions" >&2
  exit 1
fi
WXT_AVALON_RELAY_URL="${WXT_AVALON_RELAY_URL:-${PUBLIC_ORIGIN%/}}"
WXT_API_URL="${WXT_API_URL:-${PUBLIC_ORIGIN%/}/api}"
# Athens Lens API base — same host as Avalon (`https://athensai.remotepairnet.net/api` in prod).
ATHENS_API_URL="${ATHENS_API_URL:-${WXT_ATHENS_API_URL:-${WXT_API_URL}}}"
FIREBASE_WEB_API_KEY="${FIREBASE_WEB_API_KEY:-}"

ENCODE_PY="${ROOT}/docker/encode-endpoint.py"
# Bake opaque tokens into zips so they have no plaintext VPS host.
# Relay URL must be origin-only (no /avalon path) — Socket.IO treats URL path as a namespace.
WXT_AVALON_RELAY_ENC="enc:$(python3 "${ENCODE_PY}" "${WXT_AVALON_RELAY_URL}")"
WXT_API_ENC="enc:$(python3 "${ENCODE_PY}" "${WXT_API_URL}")"
WXT_ATHENS_API_ENC="enc:$(python3 "${ENCODE_PY}" "${ATHENS_API_URL}")"

mkdir -p "${OUT_DIR}"

echo "==> Building & zipping Avalon extension (endpoints encoded)"
cd "${ROOT}/project-avalon"
# Install used --ignore-scripts, so scaffold WXT before zip.
npm exec -w @avalon/extension -- wxt prepare
WXT_AVALON_RELAY_URL="${WXT_AVALON_RELAY_ENC}" \
WXT_API_URL="${WXT_API_ENC}" \
WXT_FIREBASE_WEB_API_KEY="${FIREBASE_WEB_API_KEY}" \
  npm run zip -w @avalon/extension

AVALON_VERSION="$(python3 -c "import json; print(json.load(open('${ROOT}/project-avalon/packages/extension/package.json'))['version'])")"
AVALON_BUILT="$(ls -1 "${ROOT}/project-avalon/packages/extension/.output/"*-chrome.zip | head -n1)"
cp -f "${AVALON_BUILT}" "${OUT_DIR}/${AVALON_ZIP_NAME}"

echo "==> Building & zipping Athens Lens (API endpoint encoded)"
cd "${ROOT}/athens-lens"
# Dockerfile runs npm ci --ignore-scripts style may skip prepare; ensure WXT scaffold.
npm exec -- wxt prepare
WXT_ATHENS_API_URL="${WXT_ATHENS_API_ENC}" npm run zip

LENS_VERSION="$(python3 -c "import json; print(json.load(open('${ROOT}/athens-lens/package.json'))['version'])")"
LENS_BUILT="$(ls -1 "${ROOT}/athens-lens/.output/"*-chrome.zip | head -n1)"
cp -f "${LENS_BUILT}" "${OUT_DIR}/${LENS_ZIP_NAME}"

BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
python3 - <<PY
import json
from pathlib import Path
manifest = {
  "builtAt": "${BUILT_AT}",
  "extensions": [
    {
      "id": "athens-lens",
      "name": "Athens Lens",
      "version": "${LENS_VERSION}",
      "file": "${LENS_ZIP_NAME}",
      "downloadUrl": "/downloads/${LENS_ZIP_NAME}",
    },
    {
      "id": "avalon",
      "name": "Project Avalon",
      "version": "${AVALON_VERSION}",
      "file": "${AVALON_ZIP_NAME}",
      "downloadUrl": "/downloads/${AVALON_ZIP_NAME}",
    },
  ],
}
Path("${OUT_DIR}/manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print("Wrote downloads manifest:")
print(json.dumps(manifest, indent=2))
PY

echo "==> Extension downloads ready in ${OUT_DIR}"
ls -lh "${OUT_DIR}"
