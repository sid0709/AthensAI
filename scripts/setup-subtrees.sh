#!/usr/bin/env bash
# Initialize separate git repos for new services, then subtree-add subprojects
# into the NextOffer monorepo (preserves each repo's commit history).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NEW_REPOS=(packages ai-bff)
ALL_SUBTREES=(Athens Athens-server Extension packages ai-bff)

echo "== Step 1: init git in new sub-repos =="
for d in "${NEW_REPOS[@]}"; do
  if [[ -d "$d/.git" ]]; then
    echo "  $d already has .git — skip init"
    continue
  fi
  echo "  initializing $d"
  git -C "$d" init -b main
  git -C "$d" add -A
  git -C "$d" commit -m "Initial commit: $d service"
done

echo "== Step 2: bare clones for subtree add =="
mkdir -p .bare
for d in "${ALL_SUBTREES[@]}"; do
  rm -rf ".bare/${d}.git"
  git clone --bare "$d" ".bare/${d}.git"
  echo "  bare: $d ($(git --git-dir=".bare/${d}.git" log -1 --oneline))"
done

echo "== Step 3: stage existing folders out of the way =="
mkdir -p .staging
for d in "${ALL_SUBTREES[@]}"; do
  if [[ -d "$d" ]]; then
    rm -rf ".staging/$d"
    mv "$d" ".staging/$d"
  fi
done

echo "== Step 4: subtree add (on branch cursor/subtree-monorepo) =="
git checkout -B cursor/subtree-monorepo

subtree_branch() {
  case "$1" in
    Athens) echo master ;;
    Athens-server) echo cursor/dev-setup-readme-and-npm-start ;;
    packages|ai-bff) echo main ;;
    Extension) echo master ;;
    *) echo main ;;
  esac
}

for d in "${ALL_SUBTREES[@]}"; do
  if git ls-tree -d "HEAD:$d" >/dev/null 2>&1; then
    echo "  skip $d — already in monorepo history"
    continue
  fi
  b="$(subtree_branch "$d")"
  echo "  subtree add $d ($b)"
  git subtree add --prefix="$d" ".bare/${d}.git" "$b" -m "Subtree add $d (preserve history)"
done

echo "== Step 5: verify staging matches subtree checkouts =="
MISMATCH=0
for d in "${ALL_SUBTREES[@]}"; do
  if diff -qr ".staging/$d" "$d" --exclude=.git >/dev/null 2>&1; then
    echo "  OK $d"
  else
    echo "  DIFF $d (review .staging/$d vs $d)"
    MISMATCH=1
  fi
done

if [[ "$MISMATCH" -eq 0 ]]; then
  rm -rf .staging
  echo "  staging removed (trees match)"
else
  echo "  .staging/ kept for manual review"
fi

echo "== Step 6: register known upstream remotes =="
bash "$ROOT/scripts/git-subtree-remotes.sh" || true

echo ""
echo "Done. Subtrees:"
git log --oneline --graph -15
