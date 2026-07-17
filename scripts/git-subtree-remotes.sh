#!/usr/bin/env bash
# Register upstream remotes for git subtree push/pull.
# Run once after cloning the NextOffer monorepo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

git remote remove athens-upstream 2>/dev/null || true
git remote remove athens-server-upstream 2>/dev/null || true

git remote add athens-upstream https://github.com/omnimuh730/Athens.git
git remote add athens-server-upstream https://github.com/omnimuh730/Athens-server.git

echo "Subtree remotes registered:"
git remote -v | grep -E 'athens-upstream|athens-server-upstream'
