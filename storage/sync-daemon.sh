#!/usr/bin/env bash
# storage/sync-daemon.sh - Continuous chat sync daemon
# Runs MinIO, Litestream replication in the background.
# Managed by LaunchAgent (macOS) or systemd (Linux).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

source "$CONFIG_DIR/storage/backend.conf"

# Start MinIO if not running
if ! pgrep -x minio &>/dev/null; then
    mkdir -p "$HOME/.local/share/minio/data"
    MINIO_ROOT_USER="$MINIO_ACCESS_KEY" MINIO_ROOT_PASSWORD="$MINIO_SECRET_KEY" \
        nohup minio server "$HOME/.local/share/minio/data" --console-address ":9001" >/tmp/minio.log 2>&1 &
    disown
    sleep 2
fi

# Configure mc alias
mc alias set local "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" --api S3v4 >/dev/null 2>&1 || true
mc mb "local/$MINIO_BUCKET" 2>/dev/null || true


# Tailscale peer discovery and sync
if command -v tailscale &>/dev/null && tailscale status >/dev/null 2>&1; then
    echo "Tailscale: connected. Discovering peers..."
    # Get list of online peers (excluding self)
    peers=$(tailscale status --json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
self_ip = data.get('Self', {}).get('TailscaleIPs', [''])[0]
for peer_id, peer in data.get('Peer', {}).items():
    if peer.get('Online', False):
        hostname = peer.get('HostName', '')
        if hostname:
            print(hostname)
" 2>/dev/null || true)
    if [ -n "$peers" ]; then
        echo "Online peers: $peers"
        # Sync MinIO data from peers (pull latest)
        for peer in $peers; do
            if [ "$peer" != "$(hostname)" ] && [ "$peer" != "kakas-macbook-pro" ]; then
                echo "  Syncing from $peer..."
                # Try to pull chat data from peer's MinIO via Tailscale IP
                peer_ip=$(tailscale status --json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
for pid, p in data.get('Peer', {}).items():
    if p.get('HostName') == '$peer':
        print(p.get('TailscaleIPs', [''])[0])
        break
" 2>/dev/null || true)
                if [ -n "$peer_ip" ]; then
                    mc alias set "peer-$peer" "http://$peer_ip:9000" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" --api S3v4 >/dev/null 2>&1 || true
                    mc mirror --overwrite "peer-$peer/$MINIO_BUCKET" "local/$MINIO_BUCKET" 2>/dev/null || true
                fi
            fi
        done
    fi
else
    echo "Tailscale: not available or not connected. Using local sync only."
fi

# Start Litestream replication for ZCode DBs
if [ -f "$HOME/.zcode/v2/tasks-index.sqlite" ]; then
    nohup "$CONFIG_DIR/storage/litestream-adapter.sh" replicate "$HOME/.zcode/v2/tasks-index.sqlite" "zcode/tasks-index" >/dev/null 2>&1 &
    disown
fi
if [ -f "$HOME/.zcode/cli/db.sqlite" ]; then
    nohup "$CONFIG_DIR/storage/litestream-adapter.sh" replicate "$HOME/.zcode/cli/db.sqlite" "zcode/cli-db" >/dev/null 2>&1 &
    disown
fi

# Start Litestream replication for OpenCode DB
if [ -f "$HOME/.opencode/opencode.db" ]; then
    nohup "$CONFIG_DIR/storage/litestream-adapter.sh" replicate "$HOME/.opencode/opencode.db" "opencode/db" >/dev/null 2>&1 &
    disown
fi

# Watch rollout transcripts
if [ -d "$HOME/.zcode/cli/rollout" ] && command -v fswatch &>/dev/null; then
    (fswatch -o "$HOME/.zcode/cli/rollout/" | while read; do
        "$CONFIG_DIR/storage/s3-adapter.sh" sync-push "$HOME/.zcode/cli/rollout/" "zcode/rollout" 2>/dev/null || true
    done) &
    disown
fi

echo "Chat sync daemon started. All services running in background."
# Keep the script alive so LaunchAgent/systemd doesn't restart it
while true; do
    sleep 60
done
