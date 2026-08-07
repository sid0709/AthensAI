#!/usr/bin/env bash
# Pack Chrome extensions into Athens/dist/downloads/ for the Apps & Plugins page.
# Ships: Athens Lens, Extension (Avalon Scrapper), LI-scrapper.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${EXTENSION_OUTPUT_DIR:-${ROOT}/Athens/dist/downloads}"
LENS_ZIP_NAME="athens-lens-extension.zip"
EXTENSION_ZIP_NAME="extension.zip"
LI_ZIP_NAME="li-scrapper-extension.zip"

PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-}"
if [[ -z "${PUBLIC_ORIGIN}" && -z "${ATHENS_API_URL:-}" && -z "${WXT_ATHENS_API_URL:-}" && -z "${VITE_API_URL:-}" ]]; then
  echo "error: set PUBLIC_ORIGIN (or ATHENS_API_URL / VITE_API_URL) before packing extensions" >&2
  exit 1
fi

WXT_API_URL="${WXT_API_URL:-${PUBLIC_ORIGIN%/}/api}"
ATHENS_API_URL="${ATHENS_API_URL:-${WXT_ATHENS_API_URL:-${WXT_API_URL}}}"
VITE_API_URL="${VITE_API_URL:-${ATHENS_API_URL}}"
# Origin for LI-scrapper host_permissions (no /api suffix).
API_ORIGIN="${API_ORIGIN:-${PUBLIC_ORIGIN:-}}"
if [[ -z "${API_ORIGIN}" ]]; then
  # Derive origin from API URL (strip trailing /api).
  API_ORIGIN="$(python3 -c "from urllib.parse import urlparse; u=urlparse('${ATHENS_API_URL}'); print(f'{u.scheme}://{u.netloc}')")"
fi

ENCODE_PY="${ROOT}/docker/encode-endpoint.py"
WXT_ATHENS_API_ENC="enc:$(python3 "${ENCODE_PY}" "${ATHENS_API_URL}")"
# Extension (Vite) prefers a plain API URL; encode when packing for production.
VITE_API_ENC="enc:$(python3 "${ENCODE_PY}" "${VITE_API_URL}")"

mkdir -p "${OUT_DIR}"

echo "==> Building & zipping Athens Lens (API endpoint encoded)"
cd "${ROOT}/athens-lens"
npm exec -- wxt prepare
WXT_ATHENS_API_URL="${WXT_ATHENS_API_ENC}" npm run zip

LENS_VERSION="$(python3 -c "import json; print(json.load(open('${ROOT}/athens-lens/package.json'))['version'])")"
LENS_BUILT="$(ls -1 "${ROOT}/athens-lens/.output/"*-chrome.zip | head -n1)"
cp -f "${LENS_BUILT}" "${OUT_DIR}/${LENS_ZIP_NAME}"

echo "==> Building & zipping Extension (Avalon Scrapper)"
cd "${ROOT}/Extension"
if [[ ! -d node_modules ]]; then
  npm ci
fi
# Do NOT reuse SPA's relative VITE_API_URL=/api from the Docker Athens build.
# Extension has no enc: decoder — bake a plain absolute API base.
EXTENSION_API_URL="${PUBLIC_ORIGIN:+${PUBLIC_ORIGIN%/}/api}"
EXTENSION_API_URL="${EXTENSION_API_URL:-${ATHENS_API_URL}}"
if [[ -z "${EXTENSION_API_URL}" || "${EXTENSION_API_URL}" == "/api" || "${EXTENSION_API_URL}" == api ]]; then
  echo "error: Extension needs an absolute API URL (PUBLIC_ORIGIN or ATHENS_API_URL), got '${EXTENSION_API_URL:-empty}'" >&2
  exit 1
fi
if [[ "${EXTENSION_API_URL}" == enc:* ]]; then
  echo "error: Extension does not decode enc: tokens; pass a plain https://…/api URL" >&2
  exit 1
fi
echo "    Extension VITE_API_URL=${EXTENSION_API_URL}"
VITE_API_URL="${EXTENSION_API_URL}" npm run build
EXTENSION_VERSION="$(python3 -c "import json; print(json.load(open('${ROOT}/Extension/package.json'))['version'])")"
rm -f "${OUT_DIR}/${EXTENSION_ZIP_NAME}"
(
  cd "${ROOT}/Extension/dist"
  zip -r -q "${OUT_DIR}/${EXTENSION_ZIP_NAME}" .
)

echo "==> Packing LI-scrapper (rewrite API host to deploy origin)"
LI_STAGE="$(mktemp -d)"
trap 'rm -rf "${LI_STAGE}"' EXIT
cp -R "${ROOT}/LI-scrapper/." "${LI_STAGE}/"
python3 - <<PY
from pathlib import Path
import json
import re

stage = Path("${LI_STAGE}")
api_origin = "${API_ORIGIN}".rstrip("/")
api_base = f"{api_origin}/api"
legacy = "https://sid.remotepairnet.net"

for path in stage.rglob("*"):
    if not path.is_file():
        continue
    if path.suffix.lower() not in {".js", ".json", ".html", ".css"}:
        continue
    text = path.read_text(encoding="utf-8")
    updated = text.replace(f"{legacy}/api", api_base).replace(legacy, api_origin)
    if updated != text:
        path.write_text(updated, encoding="utf-8")

manifest_path = stage / "manifest.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
perms = [
    p for p in manifest.get("host_permissions", [])
    if "sid.remotepairnet.net" not in p
]
origin_perm = f"{api_origin}/*"
if origin_perm not in perms:
    perms.append(origin_perm)
manifest["host_permissions"] = perms
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(f"LI-scrapper API origin -> {api_origin}")
PY
LI_VERSION="$(python3 -c "import json; print(json.load(open('${LI_STAGE}/manifest.json'))['version'])")"
rm -f "${OUT_DIR}/${LI_ZIP_NAME}"
(
  cd "${LI_STAGE}"
  zip -r -q "${OUT_DIR}/${LI_ZIP_NAME}" . -x '*.map' -x '.*'
)

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
      "id": "extension",
      "name": "Extension",
      "version": "${EXTENSION_VERSION}",
      "file": "${EXTENSION_ZIP_NAME}",
      "downloadUrl": "/downloads/${EXTENSION_ZIP_NAME}",
    },
    {
      "id": "li-scrapper",
      "name": "LI-scrapper",
      "version": "${LI_VERSION}",
      "file": "${LI_ZIP_NAME}",
      "downloadUrl": "/downloads/${LI_ZIP_NAME}",
    },
  ],
}
Path("${OUT_DIR}/manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print("Wrote downloads manifest:")
print(json.dumps(manifest, indent=2))
PY

echo "==> Extension downloads ready in ${OUT_DIR}"
ls -lh "${OUT_DIR}"
