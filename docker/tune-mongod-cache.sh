#!/usr/bin/env bash
# Best-effort WiredTiger cache cap for a mongod on this host.
# Safe to run when Mongo is remote — the command no-ops if mongosh cannot connect.
set -euo pipefail

CACHE_GB="${MONGODB_WIREDTIGER_CACHE_GB:-0.5}"
# wiredTigerEngineRuntimeConfig wants e.g. cache_size=512M
CACHE_MB="$(awk -v g="${CACHE_GB}" 'BEGIN { printf "%d", g * 1024 }')"
RUNTIME_CONFIG="cache_size=${CACHE_MB}M"
MONGO_URI="${MONGODB_ADMIN_URI:-}"

eval_js="try { printjson(db.adminCommand({ setParameter: 1, wiredTigerEngineRuntimeConfig: '${RUNTIME_CONFIG}' })); } catch (e) { print(e); quit(1); }"

run_eval() {
  if [[ -n "${MONGO_URI}" ]]; then
    "$1" "${MONGO_URI}" --quiet --eval "${eval_js}"
    return
  fi
  "$1" --quiet --eval "${eval_js}"
}

if command -v mongosh >/dev/null 2>&1; then
  run_eval mongosh && echo "WiredTiger cache set to ${RUNTIME_CONFIG}" && exit 0
fi
if command -v mongo >/dev/null 2>&1; then
  run_eval mongo && echo "WiredTiger cache set to ${RUNTIME_CONFIG}" && exit 0
fi

echo "mongosh/mongo not found; skip WiredTiger cache tune (Mongo is probably remote)."
exit 0
