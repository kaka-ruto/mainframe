---
name: kamal-prod-debugging
description: Use when inspecting or debugging production systems via Kamal, especially when access includes production databases and changes must be strictly non-destructive
---

# Kamal Production Debugging (Non-Destructive)

## Overview

Kamal is a production deployment tool. Treat every Kamal command as potentially high-impact because it can reach live app containers, accessories (Postgres/Redis/etc), and production secrets.

**Core principle:** read-only by default, smallest blast radius always.

## Hard Gates (Never Skip)

- Never run deploy operations when the goal is debugging.
- Never run data-changing SQL in production.
- Never print secrets to stdout.
- Prefer read-only DB users and read-only transactions.
- Prefer single-host (`--primary` or `--hosts`) over “all hosts”.

If you are not 100% sure a command is non-destructive, do not run it.

## High-Risk Commands (Avoid For Debugging)

- `kamal deploy`, `kamal redeploy`, `kamal rollback`, `kamal setup`, `kamal remove`, `kamal prune`
- `kamal app boot`, `kamal app stop/start/remove`, `kamal app maintenance/live`
- `kamal accessory boot/reboot/restart/stop/start/remove`
- `kamal config` (explicitly includes secrets)

## Safe-First Command Set

Use these for inspection and evidence gathering:

- `kamal details` (containers overview)
- `kamal app details` / `kamal app containers` / `kamal app images` / `kamal app version`
- `kamal app logs` (read-only; scope to a host/role)
- `kamal audit` (what happened on servers)
- `kamal app exec` (read-only commands only)
- `kamal accessory details <name>` / `kamal accessory logs <name>` / `kamal accessory exec <name> ...` (read-only commands only)

## Always Scope Your Commands

Default behavior may run on multiple hosts. Prefer one of:

- `--primary` for app-level debugging
- `--hosts <host>` (or a tight wildcard) for targeted inspection
- `--roles <role>` only when you truly need that entire role
- `--destination <env>` if the repo uses multiple deploy configs

## Secrets Hygiene

- Do not `cat .kamal/secrets` or run `kamal config`.
- Avoid printing environment variables in containers (`env`, `printenv`, `rails credentials:show`, etc.).
- If you must verify that a variable exists, check presence only:
  - `kamal app exec --primary 'test -n "$DATABASE_URL" && echo "DATABASE_URL present"'`

## Multi-DB: How to Think About It

Rails multi-DB apps commonly use separate databases for distinct concerns (examples: `primary`, `queue`, `cache`, `cable`, `errors`, `events`, analytics).

Non-destructive debugging principles in a multi-DB system:

- Identify which DB a symptom belongs to (job backlog -> queue DB; websocket issues -> cable; error ingestion -> errors; event pipelines -> events).
- Query the smallest DB that can answer the question.
- Prefer read-only inspection through the app (Rails runner) only when it won’t leak secrets.
- Prefer direct `psql` only in a read-only transaction with tight timeouts.

## Debugging Workflow (Recommended)

1. Confirm you are targeting the right environment (`--destination`) and smallest scope (`--primary` / `--hosts`).
2. Collect current state: container details + logs around the incident window.
3. Reproduce or validate symptoms with a read-only command (`rails runner` that only reads, or `psql` read-only transaction).
4. Capture evidence: timestamps, request ids, job ids, relevant counts; never dump huge tables.
5. If a fix is needed, stop and escalate to a human (debugging != deploying).

## Common Recipes

### App state

```bash
kamal app version --primary
kamal app details --primary
kamal app logs --primary --lines 200
```

### Minimal Rails inspection (read-only)

Use `rails runner` to print safe facts (avoid URLs, tokens, secrets).

```bash
kamal app exec --primary 'bin/rails runner "puts({env: Rails.env, time: Time.now.utc}.to_json)"'
```

### Attach an interactive shell (read-only intent)

Interactive sessions are risky because it’s easy to “just try” something destructive. Only use when necessary, and keep a clear “read-only” goal.

```bash
kamal app exec --interactive --reuse --primary bash
```

### Inspect Postgres accessory logs (read-only)

```bash
kamal accessory logs postgres --lines 200
```

### Read-only SQL in production (psql)

Prefer a read-only DB user if available. If you must connect with a writer role, you MUST enforce read-only at the session level and keep timeouts short.

Inside `psql`, run this first:

```sql
SET statement_timeout = '3s';
SET lock_timeout = '1s';
BEGIN READ ONLY;
SHOW transaction_read_only;
```

Then only run `SELECT` queries. End with:

```sql
ROLLBACK;
```

Never run `UPDATE`, `DELETE`, `INSERT`, `ALTER`, `CREATE`, `DROP`, `TRUNCATE`, `VACUUM FULL`, `REINDEX`, or migrations.

## Evidence Patterns (What To Output)

- Short, structured facts: counts, ids, timestamps, host, app version.
- Log excerpts around a specific request id / job id.
- For DB checks: `SELECT count(*)` with a restrictive `WHERE` (avoid scanning entire tables).

## Stop Conditions (Escalate)

- You suspect data repair, backfills, deletes, or migrations are needed.
- You need to restart/boot/reboot containers or accessories.
- The only available DB credentials are writer-level and you can’t confidently force read-only.
- The investigation requires pulling secrets or printing full connection URLs.
