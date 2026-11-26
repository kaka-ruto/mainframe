#!/usr/bin/env bash
# storage/sync-daemon.sh - Continuous chat sync daemon
# Runs MinIO, Litestream replication, and peer sync in the background.
# Managed by LaunchAgent (macOS) or systemd (Linux).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

source "$CONFIG_DIR/storage/backend.conf"

# Start MinIO if not running
if ! pgrep -x minio &>/dev/null; then
    mkdir -p "$HOME/.local/share/minio/data"
    MINIO_ROOT_USER="$MINIO_ACCESS_KEY" MINIO_ROOT_PASSWORD="$MINIO_SECRET_KEY" \
        minio server "$HOME/.local/share/minio/data" --console-address ":9001" >/tmp/minio.log 2>&1 &
    sleep 2
fi

# Configure mc alias
mc alias set local "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" --api S3v4 >/dev/null 2>&1 || true
mc mb "local/$MINIO_BUCKET" 2>/dev/null || true

# Start Litestream replication for ZCode DBs
if [ -f "$HOME/.zcode/v2/tasks-index.sqlite" ]; then
    "$CONFIG_DIR/storage/litestream-adapter.sh" replicate "$HOME/.zcode/v2/tasks-index.sqlite" "zcode/tasks-index" &
fi
if [ -f "$HOME/.zcode/cli/db.sqlite" ]; then
    "$CONFIG_DIR/storage/litestream-adapter.sh" replicate "$HOME/.zcode/cli/db.sqlite" "zcode/cli-db" &
fi

# Start Litestream replication for OpenCode DB
if [ -f "$HOME/.opencode/opencode.db" ]; then
    "$CONFIG_DIR/storage/litestream-adapter.sh" replicate "$HOME/.opencode/opencode.db" "opencode/db" &
fi

# Watch rollout transcripts
if [ -d "$HOME/.zcode/cli/rollout" ] && command -v fswatch &>/dev/null; then
    fswatch -o "$HOME/.zcode/cli/rollout/" | while read; do
        "$CONFIG_DIR/storage/s3-adapter.sh" sync-push "$HOME/.zcode/cli/rollout/" "zcode/rollout" 2>/dev/null || true
    done &
fi

# Keep running
echo "Chat sync daemon started. Press Ctrl+C to stop."
wait
