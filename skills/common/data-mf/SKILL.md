---
name: data-mf
description: Use when operating or debugging the anywaye data tier on the Contabo VPS `data-mf` (k3s + embedded etcd + CloudNativePG). Covers SSH access, kubectl, Postgres, CNPG, migrations, backups, and monitoring. Development never happens here — all code work is on dev-mf.
---

# Skill: data-mf
# Remote anywaye data tier on data-mainframe VPS

## SSH access policy (SECURITY — read before anything else)

**SSH access to data-mf (and all production VPSes: app-mf, infra-mf) is
PROHIBITED for agents unless the founder grants explicit written permission.**

### What to do instead (in order of preference)

1. **Ops MCP service** (`https://ops.anywaye.com/mcp`) — provides read-only DB queries
   (`ops_db_query`), pod status, logs, and metrics. Use for ALL diagnostics and
   read-only verification. Migrations and schema changes go through Argo CD
   PreSync hooks (CNPG handles DB provisioning declaratively).

2. **Argo CD** (`https://argo.anywaye.com`) — GitOps. CNPG Cluster/Database/Role
   CRDs, ObjectStore, and all manifests are applied via Argo sync. No SSH needed.

3. **CNPG declarative management** — databases, roles, and backups are managed
   via CNPG CRDs (Cluster, Database, DatabaseRole, ObjectStore). These are applied
   through Argo CD or the ops service. No manual SQL via SSH.

4. **Grafana/Prometheus** — metrics and monitoring. Read-only observability.

### When SSH might seem necessary

If you believe SSH is the only way to accomplish a task:

1. **Stop.** Do not SSH.
2. **Document the task** and why SSH seems necessary.
3. **State how to automate it** — describe what automation (CNPG CRD, Argo CD
   manifest, ops service extension, External Secrets Operator, etc.) would
   eliminate the need for SSH in the future.
4. **Ask the founder for written permission** via the conversation. Include:
   - What you need to do
   - Why no alternative exists
   - How to automate it so SSH isn't needed next time
5. **Wait for explicit approval.** Do not proceed without it.
6. **If approved:** SSH is allowed for that specific task only. After completion,
   document the automation path so future agents don't need SSH for the same task.

### What requires break-glass (founder only, SSH)

- Arbitrary exec in database pods
- Manual SQL writes (migrations are run via Argo PreSync hooks)
- CNPG cluster deletion or PVC management
- Node-level operations (k3s restart, etcd maintenance)
- Firewall changes

These are **founder-only** via SSH (`~/.ssh/data-mf`). Agents must never do these.

### Why this matters

The data tier holds all production databases. An agent with SSH access could
accidentally drop a database, corrupt data, or expose credentials. CNPG, Argo CD,
and the ops service provide audited, scoped, reversible access. SSH is unscoped
and unaudited by comparison.

**If you are reading this skill and considering SSH, re-read this section first.**

## Connection
embedded etcd and CloudNativePG (CNPG) Postgres. All service databases (identity,
ship, courier, billing, boax, etc.) live here.

## Connection

- **Host alias:** `data-mf` (in `~/.ssh/config`)
- **SSH:** `ssh data-mf`
- **Exec one command:** `ssh data-mf '<cmd>'`
- **IP:** 185.176.252.134
- **Tailscale IP:** 100.73.0.79
- **SSH key:** `~/.ssh/data-mf`

## What runs here

- **k3s** (v1.37.x) with embedded etcd (not SQLite)
- **CNPG operator** (v1.30.x) managing Postgres
- **Postgres cluster** `postgres` in namespace `data` (single instance, 20Gi)
- **barman-cloud plugin** (v0.15.x) for R2 backups
- **cert-manager** (v1.16.x) for TLS
- **NodePort service** `postgres-external` on port 30432 (for cross-VPS access)

## Accessing Postgres

### From data-mf (local)
```sh
ssh data-mf 'kubectl exec -n data postgres-1 -- psql -U postgres -d <dbname>'
```

### From app-mf (prod)
```sh
# Connection string format:
postgres://<user>:<password>@185.176.252.134:30432/<db>?sslmode=require
```

### Databases
identity, ship, courier, billing, boax, ella, gateway, courier, parlor, app (default)

### Roles
Each database has an owner role and an `_app` role:
- `identity` / `identity_app`
- `ship` (no _app role)
- `courier` / `courier_app`
- `billing` / `billing_app`
- `boax` (no _app role)
- `ella` / `ella_app`
- `gateway` / `gateway_app`
- `parlor` / `parlor_app`

## k3s datastore

- **Type:** Embedded etcd (not SQLite)
- **Data dir:** `/var/lib/rancher/k3s/server/db/etcd/`
- **k3s version:** v1.37.x
- **No SQLite DB** (migrated from SQLite)

## Backups

- **CNPG → R2:** Backups to `s3://anywaye-prod-db-backups/postgres` (Cloudflare R2)
- **Scheduled:** Daily at 02:00 UTC (`ScheduledBackup/postgres-daily-backup`)
- **Manual backup:**
  ```sh
  ssh data-mf 'kubectl apply -f -' <<'EOF'
  apiVersion: postgresql.cnpg.io/v1
  kind: Backup
  metadata:
    name: postgres-manual-$(date +%Y%m%d%H%M%S)
    namespace: data
  spec:
    cluster: { name: postgres }
    method: barmanObjectStore
  EOF
  ```

## Firewall

- Port 80, 443: public (HTTP/HTTPS)
- Port 22: public (SSH break-glass)
- Port 5432: only from app-mf (169.58.108.209)
- Port 30432: NodePort (Postgres external access)
- Port 41641/udp: Tailscale

## Hardening

- Audit score: 88/100 (0 fails)
- SSH: key-only, no password auth, PermitRootLogin prohibit-password
- fail2ban: active (sshd jail)
- Tailscale: connected (100.73.0.79)

## Monitoring

- No dedicated observability stack on data-mf yet
- Use app-mf's Grafana/Prometheus for metrics (if configured)
- Check pod status: `kubectl get pods -n data`
- Check cluster health: `kubectl get cluster postgres -n data`

## Migration status

Services migrated from app-mf to data-mf:
- identity ✅
- courier ✅
- billing ✅
- boax ✅
- ship ✅
- ella ✅

Services still on app-mf (don't use Postgres or use different DB):
- gateway (no DATABASE_URL)
- press, loom (not deployed)
- ship (uses SHIP_DATABASE_URL, migrated)

## Gradual migration procedure (for future services)

1. Create role + database on data-mf (same password as prod)
2. Create k8s secret on data-mf (same format as prod)
3. pg_dump from prod: `kubectl exec -n data postgres-1 -- pg_dump -U postgres -d <db> --no-owner --no-privileges`
4. pg_restore to data-mf: `cat dump.sql | kubectl exec -i -n data postgres-1 -- psql -U postgres -d <db>`
5. Fix ownership: `REASSIGN OWNED BY postgres TO <owner>;`
6. Grant permissions to `_app` user
7. Update service secret's DATABASE_URL to point to data-mf:30432
8. Restart service
9. Verify health and readiness

## Rules

- **All work on data-mf goes through SSH.** No local development.
- **Audit and harden before any work.** Run `mf audit` then `mf harden`.
- **Gradual migration.** Migrate one service at a time, verify before next.
- **No waiting.** Once proven working, proceed immediately.
- **Rollback:** Revert connection string to app-mf's Postgres (still running).
