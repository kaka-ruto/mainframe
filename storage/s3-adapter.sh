#!/usr/bin/env bash
# storage/s3-adapter.sh - Generic S3/MinIO operations for chat sync
# Usage: s3-adapter.sh <command> [args...]
# Commands: upload, download, list, delete, sync-push, sync-pull

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load backend config
source "$CONFIG_DIR/storage/backend.conf"

# Ensure mc (MinIO client) is available
if ! command -v mc &>/dev/null; then
    echo "Error: mc (MinIO client) not found. Install with: brew install minio/stable/mc" >&2
    exit 1
fi

# Configure mc alias for local MinIO
mc alias set local "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" --api S3v4 >/dev/null 2>&1 || true

# Ensure bucket exists
mc mb "local/$MINIO_BUCKET" 2>/dev/null || true

cmd="${1:-}"
shift || true

case "$cmd" in
    upload)
        # Usage: s3-adapter.sh upload <local-path> <remote-key>
        local_path="$1"
        remote_key="$2"
        mc cp "$local_path" "local/$MINIO_BUCKET/$remote_key"
        ;;
    download)
        # Usage: s3-adapter.sh download <remote-key> <local-path>
        remote_key="$1"
        local_path="$2"
        mc cp "local/$MINIO_BUCKET/$remote_key" "$local_path"
        ;;
    list)
        # Usage: s3-adapter.sh list [prefix]
        prefix="${1:-}"
        mc ls "local/$MINIO_BUCKET/$prefix" 2>/dev/null || true
        ;;
    delete)
        # Usage: s3-adapter.sh delete <remote-key>
        remote_key="$1"
        mc rm "local/$MINIO_BUCKET/$remote_key"
        ;;
    sync-push)
        # Usage: s3-adapter.sh sync-push <local-dir> <remote-prefix>
        local_dir="$1"
        remote_prefix="$2"
        mc mirror --overwrite "$local_dir" "local/$MINIO_BUCKET/$remote_prefix"
        ;;
    sync-pull)
        # Usage: s3-adapter.sh sync-pull <remote-prefix> <local-dir>
        remote_prefix="$1"
        local_dir="$2"
        mkdir -p "$local_dir"
        mc mirror --overwrite "local/$MINIO_BUCKET/$remote_prefix" "$local_dir"
        ;;
    *)
        echo "Usage: s3-adapter.sh <upload|download|list|delete|sync-push|sync-pull> [args...]" >&2
        exit 1
        ;;
esac
