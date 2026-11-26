#!/usr/bin/env bash
# ZCode chat sync adapter
# Implements capture/restore/watch for ZCode conversation data

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
source "$CONFIG_DIR/storage/backend.conf"

AGENT="zcode"
HOME_DIR="${HOME}"

capture() {
    echo "[$AGENT] Capturing chat data..."
    # Checkpoint WAL files first
    sqlite3 "$HOME_DIR/.zcode/v2/tasks-index.sqlite" 'PRAGMA wal_checkpoint(TRUNCATE);' 2>/dev/null || true
    sqlite3 "$HOME_DIR/.zcode/cli/db.sqlite" 'PRAGMA wal_checkpoint(TRUNCATE);' 2>/dev/null || true
    echo "[$AGENT] Capture complete"
}

restore() {
    echo "[$AGENT] Restoring chat data..."
    # Restore tasks-index.sqlite from MinIO
    "$CONFIG_DIR/storage/litestream-adapter.sh" restore "$HOME_DIR/.zcode/v2/tasks-index.sqlite" "zcode/tasks-index"
    # Restore cli db.sqlite from MinIO
    "$CONFIG_DIR/storage/litestream-adapter.sh" restore "$HOME_DIR/.zcode/cli/db.sqlite" "zcode/cli-db"
    echo "[$AGENT] Restore complete"
}

watch() {
    echo "[$AGENT] Starting watch mode..."
    # Start Litestream replication for both DBs
    "$CONFIG_DIR/storage/litestream-adapter.sh" replicate "$HOME_DIR/.zcode/v2/tasks-index.sqlite" "zcode/tasks-index"
    "$CONFIG_DIR/storage/litestream-adapter.sh" replicate "$HOME_DIR/.zcode/cli/db.sqlite" "zcode/cli-db"
    # Watch rollout transcripts
    if command -v fswatch &>/dev/null; then
        fswatch -o "$HOME_DIR/.zcode/cli/rollout/" | while read; do
            "$CONFIG_DIR/storage/s3-adapter.sh" sync-push "$HOME_DIR/.zcode/cli/rollout/" "zcode/rollout"
        done &
    fi
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
EOF
chmod +x ~/Code/kaka-ruto/mainframe/agents/zcode/chats/adapter.sh
echo "done"