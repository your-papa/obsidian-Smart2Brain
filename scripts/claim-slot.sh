#!/usr/bin/env bash
# Claim a free parallel-agent slot (see scripts/setup-agent-slots.sh).
#
#   scripts/claim-slot.sh <label>     claim the first free slot; prints its
#                                     worktree dir and vault name
#   scripts/claim-slot.sh --status    list slots and who holds them
#
# Locks are plain files under ../agents/.locks/, created atomically via
# noclobber. Release with scripts/release-slot.sh when the task is done.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Anchor to the MAIN checkout so this works from the main repo and from
# inside any slot worktree alike.
MAIN_REPO="$(dirname "$(git -C "$SCRIPT_DIR" rev-parse --path-format=absolute --git-common-dir)")"
AGENTS_DIR="$(dirname "$MAIN_REPO")/agents"
LOCKS_DIR="$AGENTS_DIR/.locks"
SLOTS=(wt1 wt2 wt3)

if [[ ! -d "$LOCKS_DIR" ]]; then
  echo "ERROR: $LOCKS_DIR missing — run scripts/setup-agent-slots.sh first" >&2
  exit 1
fi

if [[ "${1:-}" == "--status" ]]; then
  for slot in "${SLOTS[@]}"; do
    lock="$LOCKS_DIR/$slot.lock"
    if [[ -f "$lock" ]]; then
      echo "$slot: CLAIMED — $(cat "$lock")"
    else
      echo "$slot: free"
    fi
  done
  exit 0
fi

label="${1:-}"
if [[ -z "$label" ]]; then
  echo "usage: claim-slot.sh <label> | --status   (label = task/branch name)" >&2
  exit 1
fi

for slot in "${SLOTS[@]}"; do
  lock="$LOCKS_DIR/$slot.lock"
  # noclobber makes the create atomic: exactly one claimer wins a slot.
  if (set -o noclobber; echo "$label ($(date '+%Y-%m-%d %H:%M'))" > "$lock") 2>/dev/null; then
    vault_name="S2B ${slot/wt/WT}"
    echo "slot: $slot"
    echo "worktree: $AGENTS_DIR/$slot"
    echo "vault: $vault_name"
    echo "vault_dir: $AGENTS_DIR/$vault_name"
    exit 0
  fi
done

echo "ERROR: no free slot — scripts/claim-slot.sh --status" >&2
exit 1
