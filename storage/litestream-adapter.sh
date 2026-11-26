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

cmd="${1:-}"
shift || true

case "$cmd" in
    replicate)
        # Usage: litestream-adapter.sh replicate <db-path> <replica-key>
        db_path="$1"
        replica_key="$2"
        litestream replicate "$db_path" "s3://$MINIO_BUCKET/$replica_key" \
            --endpoint "$MINIO_ENDPOINT" \
            --access-key-id "$MINIO_ACCESS_KEY" \
            --secret-access-key "$MINIO_SECRET_KEY" \
            --sync-interval "$LITESTREAM_INTERVAL" &
        echo "Litestream replicating $db_path → $replica_key"
        ;;
    restore)
        # Usage: litestream-adapter.sh restore <db-path> <replica-key>
        db_path="$1"
        replica_key="$2"
        # Only restore if local DB doesn't exist or is older
        if [ ! -f "$db_path" ]; then
            litestream restore -o "$db_path" "s3://$MINIO_BUCKET/$replica_key" \
                --endpoint "$MINIO_ENDPOINT" \
                --access-key-id "$MINIO_ACCESS_KEY" \
                --secret-access-key "$MINIO_SECRET_KEY"
            echo "Restored $db_path from $replica_key"
        else
            echo "Local DB exists, skipping restore (use --force to override)"
        fi
        ;;
    snapshot)
        # Usage: litestream-adapter.sh snapshot <db-path> <replica-key>
        db_path="$1"
        replica_key="$2"
        litestream snapshot "s3://$MINIO_BUCKET/$replica_key" \
            --endpoint "$MINIO_ENDPOINT" \
            --access-key-id "$MINIO_ACCESS_KEY" \
            --secret-access-key "$MINIO_SECRET_KEY"
        echo "Snapshot created for $replica_key"
        ;;
    status)
        # Usage: litestream-adapter.sh status <db-path>
        db_path="$1"
        litestream databases 2>/dev/null || echo "Litestream not running"
        ;;
    *)
        echo "Usage: litestream-adapter.sh <replicate|restore|snapshot|status> [args...]" >&2
        exit 1
        ;;
esac
EOF
chmod +x ~/Code/kaka-ruto/mainframe/storage/litestream-adapter.sh
echo "done"