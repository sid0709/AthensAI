#!/usr/bin/env bash
# Pack Bid Monitor + Avalon Chrome extensions into Athens/dist/downloads/
# for the Apps & Plugins page. Invoked from the Docker image build.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${ROOT}/Athens/dist/downloads"
BID_ZIP_NAME="bid-monitor-extension.zip"
AVALON_ZIP_NAME="avalon-extension.zip"

PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-}"
if [[ -z "${PUBLIC_ORIGIN}" && -z "${WXT_AVALON_RELAY_URL:-}" && -z "${WXT_API_URL:-}" && -z "${ATHENS_API_URL:-}" ]]; then
  echo "error: set PUBLIC_ORIGIN (or WXT_*/ATHENS_API_URL) before packing extensions" >&2
  exit 1
fi
WXT_AVALON_RELAY_URL="${WXT_AVALON_RELAY_URL:-${PUBLIC_ORIGIN%/}/avalon}"
WXT_API_URL="${WXT_API_URL:-${PUBLIC_ORIGIN%/}/api}"
ATHENS_API_URL="${ATHENS_API_URL:-${PUBLIC_ORIGIN%/}/api}"

ENCODE_PY="${ROOT}/docker/encode-endpoint.py"
# Bake opaque tokens into Avalon so the zip has no plaintext VPS host.
WXT_AVALON_RELAY_ENC="enc:$(python3 "${ENCODE_PY}" "${WXT_AVALON_RELAY_URL}")"
WXT_API_ENC="enc:$(python3 "${ENCODE_PY}" "${WXT_API_URL}")"

mkdir -p "${OUT_DIR}"

echo "==> Packing Bid Monitor extension (endpoint encoded)"
PUBLIC_ORIGIN="${PUBLIC_ORIGIN}" \
ATHENS_API_URL="${ATHENS_API_URL}" \
  bash "${ROOT}/Bid-Monitor/pack-extension.sh"
cp -f "${ROOT}/Bid-Monitor/dist/${BID_ZIP_NAME}" "${OUT_DIR}/${BID_ZIP_NAME}"
BID_VERSION="$(python3 -c "import json; print(json.load(open('${ROOT}/Bid-Monitor/manifest.json'))['version'])")"

echo "==> Building & zipping Avalon extension (endpoints encoded)"
cd "${ROOT}/project-avalon"
# Install used --ignore-scripts, so scaffold WXT before zip.
npm exec -w @avalon/extension -- wxt prepare
WXT_AVALON_RELAY_URL="${WXT_AVALON_RELAY_ENC}" \
WXT_API_URL="${WXT_API_ENC}" \
  npm run zip -w @avalon/extension

AVALON_VERSION="$(python3 -c "import json; print(json.load(open('${ROOT}/project-avalon/packages/extension/package.json'))['version'])")"
AVALON_BUILT="$(ls -1 "${ROOT}/project-avalon/packages/extension/.output/"*-chrome.zip | head -n1)"
cp -f "${AVALON_BUILT}" "${OUT_DIR}/${AVALON_ZIP_NAME}"

BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
python3 - <<PY
import json
from pathlib import Path
manifest = {
  "builtAt": "${BUILT_AT}",
  "extensions": [
    {
      "id": "bid-monitor",
      "name": "Bid Monitor",
      "version": "${BID_VERSION}",
      "file": "${BID_ZIP_NAME}",
      "downloadUrl": "/downloads/${BID_ZIP_NAME}",
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
