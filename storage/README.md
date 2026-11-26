# Storage Backend

Shared storage backend for chat sync. Provides S3-compatible (MinIO) storage and SQLite replication (Litestream) for agent conversation data.

## Architecture

```
storage/
├── backend.conf          # MinIO endpoint, bucket, credentials (shared across all agents)
├── s3-adapter.sh         # Generic S3/MinIO operations (upload, download, list, delete, sync)
├── litestream-adapter.sh # SQLite replication via Litestream (replicate, restore, snapshot, status)
└── README.md             # This file
```

## How it works

1. **MinIO** runs locally on each machine (installed by `mf apply`)
2. **Litestream** replicates SQLite databases to local MinIO in real-time
3. **Peer sync** uses `mc mirror` to sync MinIO data between fleet machines
4. **Agent adapters** (`agents/<name>/chats/adapter.sh`) handle agent-specific capture/restore/watch

## Peer-to-peer sync

No hub, no single point of failure. Every machine is a full replica:

- Machine A's Litestream → Machine A's MinIO → peer sync → Machine B's MinIO → Machine B's Litestream restore
- If any machine goes offline, sync pauses but local data remains intact
- When connectivity returns, sync resumes automatically

## Agent support

| Agent | Storage type | Sync method |
|---|---|---|
| ZCode | SQLite (tasks-index + CLI db) + JSONL transcripts | Litestream + file watcher |
| OpenCode | SQLite (opencode.db) | Litestream |
| Future agents | Any (flat files, APIs, etc.) | Per-agent adapter |

## Adding a new agent

1. Create `agents/<name>/chats/` directory
2. Add `paths.conf` (file paths to sync)
3. Add `adapter.sh` (capture/restore/watch operations)
4. Add `chats` to `config_sync` in `agents/<name>/config.json`
5. Enable in `agents/registry.json`

The storage backend is agent-agnostic — any agent can use `s3-adapter.sh` and `litestream-adapter.sh` directly.
