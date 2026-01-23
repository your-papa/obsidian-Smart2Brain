#!/bin/bash

# ralph.sh - Autonomous TDD development loop using OpenCode
# Runs until status.md shows "done" or "error"

set -e

STATUS_FILE="status.md"
PLAN_FILE="PLAN.md"
PROMPT_FILE="PROMPT.md"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }

get_status() {
    grep "Current Status:" "$STATUS_FILE" 2>/dev/null | sed 's/.*`\([^`]*\)`.*/\1/' || echo "unknown"
}

count_tasks() {
    local pattern=$1
    grep -c "^\s*- \[$pattern\]" "$PLAN_FILE" 2>/dev/null || echo "0"
}

commit_changes() {
    if jj status 2>/dev/null | grep -q "Working copy changes"; then
        log "${CYAN}Committing: $1${NC}"
        jj commit -m "$1"
    fi
}

# Check required files
for f in "$STATUS_FILE" "$PLAN_FILE" "$PROMPT_FILE"; do
    [ ! -f "$f" ] && echo -e "${RED}Error: $f not found${NC}" && exit 1
done

log "${GREEN}Starting Ralph loop${NC}"

iteration=0

while true; do
    iteration=$((iteration + 1))
    completed=$(count_tasks "x")
    remaining=$(count_tasks " ")
    
    echo ""
    log "${YELLOW}=== Iteration $iteration === ${NC}(${completed} done, ${remaining} remaining)"
    
    # Check exit conditions
    status=$(get_status)
    case "$status" in
        "done") log "${GREEN}All tasks complete!${NC}"; exit 0 ;;
        "error") log "${RED}Status is error. Check status.md${NC}"; exit 1 ;;
        "unknown") log "${RED}Cannot read status${NC}"; exit 1 ;;
    esac
    
    [ "$remaining" = "0" ] && [ "$completed" != "0" ] && {
        log "${GREEN}All tasks in PLAN.md complete!${NC}"
        sed -i '' 's/`running`/`done`/' "$STATUS_FILE" 2>/dev/null || sed -i 's/`running`/`done`/' "$STATUS_FILE"
        commit_changes "ralph: all tasks complete"
        exit 0
    }
    
    # Run opencode
    PROMPT_CONTENT=$(cat "$PROMPT_FILE")
    MODEL=${MODEL:-"sap-ai-proxy/anthropic--claude-4.5-opus"}
    PORT=${PORT:-4096}
    
    log "Running agent on port $PORT (attach with: opencode attach http://localhost:$PORT)"
    
    opencode run --model "$MODEL" --port "$PORT" "$PROMPT_CONTENT"
    
    commit_changes "ralph: iteration $iteration"
    
    new_completed=$(count_tasks "x")
    tasks_done=$((new_completed - completed))
    [ $tasks_done -gt 0 ] && log "${GREEN}+$tasks_done tasks completed${NC}"
    
    sleep 3
done
