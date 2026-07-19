#!/usr/bin/env bash
# Pack Bid Monitor + Avalon Chrome extensions into Athens/dist/downloads/
# for the Apps & Plugins page. Invoked from the Docker image build.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${ROOT}/Athens/dist/downloads"
BID_ZIP_NAME="bid-monitor-extension.zip"
AVALON_ZIP_NAME="avalon-extension.zip"

PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-http://83.229.67.146}"
WXT_AVALON_RELAY_URL="${WXT_AVALON_RELAY_URL:-${PUBLIC_ORIGIN}/avalon}"
WXT_API_URL="${WXT_API_URL:-${PUBLIC_ORIGIN}/api}"

mkdir -p "${OUT_DIR}"

echo "==> Packing Bid Monitor extension"
bash "${ROOT}/Bid-Monitor/pack-extension.sh"
cp -f "${ROOT}/Bid-Monitor/dist/${BID_ZIP_NAME}" "${OUT_DIR}/${BID_ZIP_NAME}"
BID_VERSION="$(python3 -c "import json; print(json.load(open('${ROOT}/Bid-Monitor/manifest.json'))['version'])")"

echo "==> Building & zipping Avalon extension"
cd "${ROOT}/project-avalon"
# Install used --ignore-scripts, so scaffold WXT before zip.
npm exec -w @avalon/extension -- wxt prepare
WXT_AVALON_RELAY_URL="${WXT_AVALON_RELAY_URL}" \
WXT_API_URL="${WXT_API_URL}" \
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
