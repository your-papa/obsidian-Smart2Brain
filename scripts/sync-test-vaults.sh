#!/usr/bin/env bash
# Symlinks the dev build into every vault under ../test-vaults.
# Run from the repo root after `bun run dev` or `bun run build`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$REPO_ROOT/build/smart-second-brain"
TEST_VAULTS_DIR="$(cd "$REPO_ROOT/../test-vaults" && pwd)"
PLUGIN_ID="smart-second-brain"

if [[ ! -f "$BUILD_DIR/main.js" ]]; then
  echo "ERROR: $BUILD_DIR/main.js not found — run 'bun run dev' or 'bun run build' first" >&2
  exit 1
fi

linked=0
skipped=0

for vault_dir in "$TEST_VAULTS_DIR"/*/; do
  obsidian_dir="$vault_dir/.obsidian"

  if [[ ! -d "$obsidian_dir" ]]; then
    echo "SKIP  $(basename "$vault_dir") — no .obsidian dir (open it in Obsidian first)"
    ((skipped++))
    continue
  fi

  plugin_dir="$obsidian_dir/plugins/$PLUGIN_ID"

  # Remove whatever's there (could be a dir-symlink from an old setup)
  if [[ -L "$plugin_dir" ]]; then
    rm "$plugin_dir"
  fi
  mkdir -p "$plugin_dir"

  for file in main.js styles.css manifest.json; do
    target="$plugin_dir/$file"
    if [[ -L "$target" || -e "$target" ]]; then
      rm "$target"
    fi
    ln -s "$BUILD_DIR/$file" "$target"
  done

  # Ensure plugin is enabled in community-plugins.json
  cp_json="$obsidian_dir/community-plugins.json"
  if [[ ! -f "$cp_json" ]]; then
    echo '["smart-second-brain"]' > "$cp_json"
  elif ! grep -q '"smart-second-brain"' "$cp_json"; then
    # Insert into existing array
    content=$(cat "$cp_json")
    echo "${content/]/, \"smart-second-brain\"]}" > "$cp_json"
  fi

  echo "OK    $(basename "$vault_dir")"
  ((linked++))
done

echo ""
echo "Linked: $linked  Skipped: $skipped"
echo "Reload each vault with: obsidian vault=\"<name>\" command id=app:reload"
