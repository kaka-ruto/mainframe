#!/usr/bin/env bash
# storage/sync-daemon.sh - Continuous chat sync daemon
# Runs MinIO, Litestream replication in the background.
# Managed by LaunchAgent (macOS) or systemd (Linux).
#
# Order matters: local durability (Litestream) starts FIRST so a crash/wipe
# never loses data while we wait on the network; peer mirroring runs in a
# background subshell with per-peer reachability checks, so one dead peer can
# never stall the daemon.

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

# Start Litestream replication for ZCode DBs (local durability first)
if [ -f "$HOME/.zcode/v2/tasks-index.sqlite" ]; then
    nohup "$CONFIG_DIR/storage/litestream-adapter.sh" replicate "$HOME/.zcode/v2/tasks-index.sqlite" "zcode/tasks-index" >/dev/null 2>&1 &
    disown
fi
if [ -f "$HOME/.zcode/cli/db/db.sqlite" ]; then
    nohup "$CONFIG_DIR/storage/litestream-adapter.sh" replicate "$HOME/.zcode/cli/db/db.sqlite" "zcode/cli-db" >/dev/null 2>&1 &
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

# Peer sync (background): pull the latest chat data from reachable peers.
(
    if command -v tailscale &>/dev/null && tailscale status >/dev/null 2>&1; then
        echo "Tailscale: connected. Discovering peers..."
        peers=$(tailscale status --json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
for peer_id, peer in data.get('Peer', {}).items():
    if peer.get('Online', False):
        hostname = peer.get('HostName', '')
        if hostname:
            print(hostname)
" 2>/dev/null | sort -u || true)
        if [ -n "$peers" ]; then
            echo "Online peers: $peers"
            for peer in $peers; do
                if [ "$peer" != "$(hostname)" ] && [ "$peer" != "kakas-macbook-pro" ]; then
                    peer_ip=$(tailscale status --json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
for pid, p in data.get('Peer', {}).items():
    if p.get('HostName') == '$peer':
        print(p.get('TailscaleIPs', [''])[0])
        break
" 2>/dev/null || true)
                    if [ -n "$peer_ip" ]; then
                        # quick reachability check so a dead peer can't stall us
                        if command -v nc >/dev/null 2>&1 && ! nc -z -w 2 "$peer_ip" 9000 >/dev/null 2>&1; then
                            echo "  $peer: no MinIO on :9000, skipping"
                            continue
                        fi
                        echo "  Syncing from $peer..."
                        mc alias set "peer-$peer" "http://$peer_ip:9000" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" --api S3v4 >/dev/null 2>&1 || true
                        mc mirror --overwrite "peer-$peer/$MINIO_BUCKET" "local/$MINIO_BUCKET" 2>/dev/null || true
                    fi
                fi
            done
        fi
    else
        echo "Tailscale: not available or not connected. Using local sync only."
    fi
    echo "Peer sync pass complete."
) >/tmp/mainframe-peer-sync.log 2>&1 &
disown

echo "Chat sync daemon started. All services running in background."
# Keep the script alive so LaunchAgent/systemd doesn't restart it
while true; do
    sleep 60
done
