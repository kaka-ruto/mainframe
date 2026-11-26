#!/usr/bin/env bash
# OpenCode chat sync adapter
# Implements capture/restore/watch for OpenCode conversation data

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
source "$CONFIG_DIR/storage/backend.conf"

AGENT="opencode"
HOME_DIR="${HOME}"

capture() {
    echo "[$AGENT] Capturing chat data..."
    sqlite3 "$HOME_DIR/.opencode/opencode.db" 'PRAGMA wal_checkpoint(TRUNCATE);' 2>/dev/null || true
    echo "[$AGENT] Capture complete"
}

restore() {
    echo "[$AGENT] Restoring chat data..."
    "$CONFIG_DIR/storage/litestream-adapter.sh" restore "$HOME_DIR/.opencode/opencode.db" "opencode/db"
    echo "[$AGENT] Restore complete"
}

watch() {
    echo "[$AGENT] Starting watch mode..."
    nohup "$CONFIG_DIR/storage/litestream-adapter.sh" replicate "$HOME_DIR/.opencode/opencode.db" "opencode/db" >/dev/null 2>&1 &
    disown
    echo "[$AGENT] Watch mode started"
}

case "${1:-}" in
    capture) capture ;;
    restore) restore ;;
    watch) watch ;;
    *)
        echo "Usage: adapter.sh <capture|restore|watch>"
        exit 1
        ;;
esac
