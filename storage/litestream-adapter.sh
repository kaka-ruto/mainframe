#!/usr/bin/env bash
# storage/litestream-adapter.sh - SQLite replication via Litestream
# Usage: litestream-adapter.sh <command> [args...]
# Commands: replicate, restore, snapshot, status

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

source "$CONFIG_DIR/storage/backend.conf"

if ! command -v litestream &>/dev/null; then
    echo "Error: litestream not found. Install with: brew install litestream" >&2
    exit 1
fi

# Generate a litestream config file for a given DB path and replica key
gen_config() {
    local db_path="$1"
    local replica_key="$2"
    local config_file="/tmp/litestream-$$.yml"
    cat > "$config_file" << EOF
dbs:
  - path: $db_path
    replicas:
      - url: s3://$MINIO_BUCKET/$replica_key
        endpoint: $MINIO_ENDPOINT
        access-key-id: $MINIO_ACCESS_KEY
        secret-access-key: $MINIO_SECRET_KEY
        force-path-style: true
EOF
    echo "$config_file"
}

cmd="${1:-}"
shift || true

case "$cmd" in
    replicate)
        # Usage: litestream-adapter.sh replicate <db-path> <replica-key>
        db_path="$1"
        replica_key="$2"
        config_file=$(gen_config "$db_path" "$replica_key")
        litestream replicate -config "$config_file" &
        echo "Litestream replicating $db_path → $replica_key (PID: $!)"
        ;;
    restore)
        # Usage: litestream-adapter.sh restore <db-path> <replica-key> [--force]
        db_path="$1"
        replica_key="$2"
        force="${3:-}"
        if [ -f "$db_path" ] && [ "$force" != "--force" ]; then
            echo "Local DB exists, skipping restore (use --force to override)"
            exit 0
        fi
        config_file=$(gen_config "$db_path" "$replica_key")
        litestream restore -config "$config_file" -o "$db_path" 2>&1 || true
        if [ -f "$db_path" ]; then
            echo "Restored $db_path from $replica_key"
        else
            echo "No remote backup found for $replica_key (first sync)"
        fi
        rm -f "$config_file"
        ;;
    snapshot)
        # Usage: litestream-adapter.sh snapshot <db-path> <replica-key>
        db_path="$1"
        replica_key="$2"
        config_file=$(gen_config "$db_path" "$replica_key")
        litestream replicate -config "$config_file" -once -force-snapshot 2>&1
        rm -f "$config_file"
        echo "Snapshot created for $replica_key"
        ;;
    status)
        # Usage: litestream-adapter.sh status
        if pgrep -x litestream &>/dev/null; then
            echo "Litestream: running"
        else
            echo "Litestream: not running"
        fi
        ;;
    *)
        echo "Usage: litestream-adapter.sh <replicate|restore|snapshot|status> [args...]" >&2
        exit 1
        ;;
esac
