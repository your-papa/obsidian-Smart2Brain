#!/usr/bin/env bash
# Release a parallel-agent slot claimed with scripts/claim-slot.sh.
#
#   scripts/release-slot.sh <wt1|wt2|wt3>
#   scripts/release-slot.sh --all
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Anchor to the MAIN checkout so this works from the main repo and from
# inside any slot worktree alike.
MAIN_REPO="$(dirname "$(git -C "$SCRIPT_DIR" rev-parse --path-format=absolute --git-common-dir)")"
AGENTS_DIR="$(dirname "$MAIN_REPO")/agents"
LOCKS_DIR="$AGENTS_DIR/.locks"
SLOTS=(wt1 wt2 wt3)

release() {
  local slot="$1"
  local lock="$LOCKS_DIR/$slot.lock"
  if [[ -f "$lock" ]]; then
    rm "$lock"
    echo "released $slot"
  else
    echo "$slot was already free"
  fi
}

case "${1:-}" in
  --all)
    for slot in "${SLOTS[@]}"; do release "$slot"; done
    ;;
  wt1|wt2|wt3)
    release "$1"
    ;;
  *)
    echo "usage: release-slot.sh <wt1|wt2|wt3|--all>" >&2
    exit 1
    ;;
esac
