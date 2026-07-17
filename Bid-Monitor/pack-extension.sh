#!/usr/bin/env bash
# Pack Bid Monitor as a shareable Chrome extension (minified JS, no README/source docs).
# Output: dist/bid-monitor/ (load unpacked) and dist/bid-monitor-extension.zip
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="${ROOT}/dist"
OUT_DIR="${DIST_DIR}/bid-monitor"
ZIP_PATH="${DIST_DIR}/bid-monitor-extension.zip"
VERSION="$(python3 -c "import json; print(json.load(open('${ROOT}/manifest.json'))['version'])" 2>/dev/null || echo "unknown")"

echo "==> Packing Bid Monitor v${VERSION}"

rm -rf "${DIST_DIR}"
mkdir -p "${OUT_DIR}"

# Extension runtime files only (exclude docs, pack script, dist, git)
rsync -a \
  --exclude 'dist/' \
  --exclude 'pack-extension.sh' \
  --exclude 'README.md' \
  --exclude '.git/' \
  --exclude '.DS_Store' \
  --exclude '*.md' \
  --exclude '.cursor/' \
  "${ROOT}/" "${OUT_DIR}/"

if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm (Node.js) is required to minify JS before packing." >&2
  exit 1
fi

echo "==> Minifying JavaScript (terser)…"
TERSER_CACHE="${DIST_DIR}/.terser-cache"
mkdir -p "${TERSER_CACHE}"
npm install --silent --prefix "${TERSER_CACHE}" terser@5 >/dev/null
TERSER_BIN="${TERSER_CACHE}/node_modules/.bin/terser"

while IFS= read -r -d '' js; do
  "${TERSER_BIN}" "${js}" --compress --mangle --comments false --output "${js}"
done < <(find "${OUT_DIR}" -type f -name '*.js' -print0)

rm -rf "${TERSER_CACHE}"

echo "==> Creating zip…"
rm -f "${ZIP_PATH}"
(
  cd "${DIST_DIR}"
  zip -r -q "bid-monitor-extension.zip" "bid-monitor"
)

SIZE="$(du -h "${ZIP_PATH}" | awk '{print $1}')"
echo ""
echo "Done."
echo "  Folder: ${OUT_DIR}"
echo "  Zip:    ${ZIP_PATH} (${SIZE})"
echo ""
echo "Share the zip. Recipients should:"
echo "  1. Unzip bid-monitor-extension.zip"
echo "  2. chrome://extensions → Developer mode → Load unpacked → select the bid-monitor folder"
echo ""
echo "Note: minification obfuscates JS but does not fully hide it from determined inspection."
