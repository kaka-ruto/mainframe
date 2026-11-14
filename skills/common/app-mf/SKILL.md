---
name: app-mf
description: Use when operating or debugging the anywaye stack in production on the Contabo VPS `app-mf` (k3s + Argo CD + CloudNativePG). Covers SSH access, kubectl/Argo, deploys, prod migrations, secrets, substrate changes, observability (Grafana/Prometheus/Alloy), and GlitchTip error tracking. Development never happens here — all code work is on dev-mf.
---

# Production operations on app-mf

The prod cluster runs on a Contabo VPS (`ssh app-mf`, user root, key
`~/.ssh/cafaye`). It is **k3s + Argo CD + CloudNativePG**, managed by the anywaye
substrate. All platform services run there as Argo `Application`s pulling from
GHCR/OCI.

**Do not develop on prod.** All code work happens on the dev box (dev-mf).
Prod is for deploying verified `master` commits only. If you are tempted to edit
files or run ad-hoc services on prod, stop and move the work to a worktree on
dev-mf.

## SSH access policy (SECURITY — read before anything else)

**SSH access to app-mf (and all production VPSes: data-mf, infra-mf) is
PROHIBITED for agents unless the founder grants explicit written permission.**

### What to do instead (in order of preference)

1. **Ops MCP service** (`https://ops.anywaye.com/mcp`) — the primary agent access
   path. Provides read-only queries (pods, logs, DB, metrics, files, events) and
   reversible remediation (restart/scale/delete pod). Use this for ALL diagnostics
   and routine operations. See the "Access method" section below for the full tool list.

2. **Argo CD** (`https://argo.anywaye.com`) — GitOps. Deployments, config changes,
   env var updates, and manifest changes all go through git → Argo sync. No SSH needed.

3. **bin/deploy / bin/publish** on dev-mf — builds and publishes images/charts.
   Prod syncs automatically via Argo CD Image Updater. No SSH to prod needed.

4. **GlitchTip** (`https://errors.anywaye.com/mcp/`) — error tracking, stack traces,
   issue management. MCP endpoint available for agent-driven triage.

5. **Grafana/Prometheus** — metrics, logs, traces. Read-only observability.

6. **The `any` CLI** — `any secret set/get/list` for secrets, `any dev` for injection.
   No `.env` files with values.

### When SSH might seem necessary

If you believe SSH is the only way to accomplish a task:

1. **Stop.** Do not SSH.
2. **Document the task** and why SSH seems necessary.
3. **State how to automate it** — describe what automation (ops service extension,
   Argo CD manifest, External Secrets Operator, kit substrate change, etc.) would
   eliminate the need for SSH in the future.
4. **Ask the founder for written permission** via the conversation. Include:
   - What you need to do
   - Why no alternative exists
   - How to automate it so SSH isn't needed next time
5. **Wait for explicit approval.** Do not proceed without it.
6. **If approved:** SSH is allowed for that specific task only. After completion,
   document the automation path so future agents don't need SSH for the same task.

### What requires break-glass (founder only, SSH)

- Arbitrary exec in containers
- SQL writes (migrations are run via Argo PreSync hooks, not SSH)
- Namespace/PVC deletion
- Secret/RBAC changes
- Node drain, k3s restart
- Infrastructure changes (Alloy, Tempo, CNPG operator)

These are **founder-only** via SSH (`~/.ssh/cafaye`). Agents must never do these.

### Why this matters

A dirty or red trunk is an emergency. An agent with SSH access can accidentally
(or maliciously) modify production state, delete data, or break services. The
ops service, Argo CD, and the `any` CLI provide audited, scoped, reversible
access. SSH is unscoped and unaudited by comparison.

**If you are reading this skill and considering SSH, re-read this section first.**

## Access method (READ FIRST)

**Prod access for agents:** Agents use the **ops service** (`https://ops.anywaye.com`)
for automated prod access. Ops is an MCP server + REST API that gives agents
safe, scoped, audited access to prod. Agents must not SSH to prod or hold a
prod kubeconfig.

### ops service (primary agent access)

- **URL**: `https://ops.anywaye.com`
- **MCP**: `https://ops.anywaye.com/mcp` (streamable HTTP, bearer token auth)
- **Auth**: identity-issued agent bearer tokens. Register an agent via identity's
  `POST /v1/agents`, claim it (human approves), then mint a token.
- **Access gate**: agents must be (a) claimed and (b) claimed by an account whose
  user has `is_staff = true` (set via `identity-staff grant <email>`).
- **Audit**: every call is logged to `/var/log/ops/audit.log` and forwarded to Loki.

**Read-only tools** (autonomous, no approval):
- `ops_namespaces`, `ops_pods`, `ops_pod_logs`, `ops_events`
- `ops_db_query` (read-only SQL against any prod database)
- `ops_metrics_query` (PromQL), `ops_loki_query` (LogQL)
- `ops_read_file`, `ops_process_list`, `ops_disk_usage`, `ops_env_check`, `ops_network_check`

**Reversible remediation** (autonomous, no approval):
- `ops_restart_deployment`, `ops_scale_deployment`, `ops_delete_pod`

**Not exposed** (break-glass only): arbitrary exec, SQL writes, namespace/PVC
deletion, secret/RBAC changes, node drain, migrations, deploys.

### Other agent-accessible surfaces

- **GlitchTip** (https://errors.anywaye.com): errors, stack traces, issues.
  MCP endpoint: https://errors.anywaye.com/mcp/ (requires API token).
- **Grafana** (https://grafana.anywaye.com): metrics, logs, traces dashboards.
- **Prometheus** (https://prometheus.anywaye.com): raw metrics, PromQL (also via ops).
- **Argo CD** (https://argo.anywaye.com): sync status, manifests (read-only).

### Break-glass (human only)

If an agent needs something beyond ops and the surfaces above, the **founder**
uses the retained SSH key (`~/.ssh/cafaye`) to access prod directly:

```sh
ssh -i ~/.ssh/cafaye root@169.58.108.209
kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get applications -n argocd
```

Agents must never do this. If an agent needs a prod change it cannot make via
ops, it should request it and let the founder execute it.

### Standard workflow

See the `dev-mf` skill for the true TBD workflow. This skill covers only
production operations. In TBD mode, deploys are triggered by running `bin/deploy` on dev-mf
after pushing to master. Argo CD Image Updater detects the new image and syncs.
Migrations run as a PreSync hook. No PRs, no previews.

### What agents can do (read-only, via web APIs)
- Check deploy status: `argocd app get <service>` or via the Argo CD UI.
- View service logs: `kubectl logs` (via founder break-glass only).
- Query metrics: PromQL via Prometheus, LogQL via Loki (via ops service).
- Query errors: GlitchTip MCP server (https://errors.anywaye.com/mcp/).

### What agents cannot do
- Trigger builds or deploys (run `bin/deploy` on dev-mf after pushing to master).
- Access databases directly (use ops_db_query for read-only SQL).
- Modify secrets, RBAC, or infrastructure.

## Builds and CI

Docker builds and image publishing happen on **dev-mf** (triggered by
bin/deploy). This cluster only runs verified artifacts.

Deploys are triggered by running `bin/deploy` on dev-mf after pushing to
master. Argo CD Image Updater detects the new image and syncs automatically.
Migrations run as a PreSync hook (Job) before the new pod deploys.
Manual fallback:

```sh
cd /code/anywaye/ship   # or website
./bin/publish
./bin/deploy
```

Prod syncs via Argo CD on push (event-driven, not polling). No GitHub Actions.

## Connection

- **SSH:** `ssh app-mf` (alias for the Contabo box; root, key `~/.ssh/cafaye`).
- **kubectl:** `kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml` (on the box) or
  copy the kubeconfig locally. `kubectl get applications -n argocd` shows sync
  status.
- **Argo CD:** pull-based. A deploy = `bin/deploy` + Image Updater + Argo sync
  (event-driven, on new image). Rollback = `git revert` + republish, or flip a feature flag.

## Deploy flow (originates on dev-mf)

Deploys are triggered by running `./bin/deploy` on dev-mf after pushing to master:

1. Developer pushes code to `master` (`git push origin master`).
2. Developer runs `./bin/deploy` on dev-mf: runs migrations (local dev DB),
   builds image, pushes to GHCR, bumps chart version, stamps digest, pushes chart
   to OCI registry, commits version bump, pushes to `master`, restarts local service.
3. Argo CD Image Updater detects the new image tag in GHCR and updates the
   Application's image override.
4. Argo CD syncs: runs the PreSync migration Job (against prod DB). If it succeeds,
   the new pod deploys. If it fails, sync aborts and the old pod stays.
5. Smoke tests run (healthz, readyz).
6. Migrations are handled by the PreSync hook — no manual migration needed.

Manual fallback (if wip is down or a build fails):
1. Run `./bin/publish` then `./bin/deploy` on the dev box.
2. Bump the Application's `targetRevision` to the new version via kubectl patch.
3. Verify on prod after sync:
   ```sh
   ssh app-mf 'kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get applications -n argocd'
   ```
   Confirm the target Application shows `Synced` / `Healthy`.

Do NOT put `image.digest` in the Application's `helm.values` override — it
shadows the chart's stamped digest and breaks the flow. Override only `env:`.
GitHub Actions is retired. `ci/publish.yml` is removed.

## Migrations on prod

Run `bin/migrate` (or `kubectl exec`) against the prod database before/with the
deploy. **Never let a migration run automatically.** Migrations and infra changes
cannot be feature-flagged and take effect on deploy, so they are the exception to
the TBD flow: test against the shared DB in a worktree, and merge to
`master` only when verified.

After deploy, verify without SSH using the ops service (see the dev-mf skill,
"Verifying a migration in prod"):
- `ops_pods(namespace="<svc>")` for a `Succeeded` `<svc>-migrate-*` Job.
- `ops_pod_logs(...)` to confirm your migration file ran and ended "migrations applied".
- `ops_db_query(database="<svc>", sql="SELECT count(*) FROM <new_table>")` to confirm
  schema/data. Default privileges are set for the service user (migration 00038),
  so new tables are readable by ops_reader automatically; an explicit
  `GRANT SELECT ... TO ops_reader` in the migration is optional belt-and-suspenders.

## Substrate changes

Alloy, Tempo, Prometheus, Application manifests in `kit/templates/substrate/` are
applied by re-running `install.sh` or by `kubectl apply` of the changed manifest.
Argo self-heals Application-level changes.

## Service secrets

Created by `install.sh` (one-time, never overwritten). Rotate by replacing the
secret and restarting pods. Secrets are never committed; manifests stay
credential-free. Use `cafe secret set/get/list` (dev, FileRing) and `cafe dev`
(injects from keyring). See `anywaye/docs/secrets.md`.

## Rollback

See the `dev-mf` skill for the full rollback decision tree and commands
(`bin/rollback`, `bin/migrate-down`, `bin/migration-down-section`). All rollback
commands run from the dev box.

Prod-specific mechanisms:
- **Argo native:** roll back to a previous Application revision via `kubectl patch`
  of `targetRevision` (no rebuild needed).
- **CNPG point-in-time recovery:** for migrations that can't be reversed by Down.
  Always restore into a scratch cluster first, verify, then cut over.

## Observability & monitoring (anywaye.com)

All observability services are exposed via Traefik ingress with Let's Encrypt TLS.

| Service | URL | Login | Notes |
|---|---|---|---|
| Grafana | https://grafana.anywaye.com | kaka / Bitwarden: "app-mf observability (unified)" | Dashboards, logs, traces, metrics, profiles. Tempo/Loki/Prometheus/Pyroscope datasources provisioned. |
| Prometheus | https://prometheus.anywaye.com | basic auth: kaka / Bitwarden: "app-mf observability (unified)" | Raw metrics, PromQL. Remote write receiver enabled. Traefik basicAuth middleware. |
| Alloy (collector) | https://alloy.anywaye.com | basic auth: kaka / Bitwarden: "app-mf observability (unified)" | Collector UI + config. OTLP receiver on 4317/4318. Traefik basicAuth middleware. |
| GlitchTip | https://errors.anywaye.com | kaka@anywaye.com / Bitwarden: "app-mf observability (unified)" | Error tracking, MCP server, affected users. |
| GlitchTip MCP | https://errors.anywaye.com/mcp/ | API token (create in GlitchTip admin) | Agent access to issues, stack traces, events. |
| Argo CD | https://argo.anywaye.com | kaka / Bitwarden: "app-mf observability (unified)" | GitOps control plane (k3s). CLI: `argocd ... --insecure --grpc-web`. Anonymous access disabled; default policy no access. Admin account disabled; use `kaka`. |

Internal services (not exposed): Loki (http://loki:3100), Tempo gRPC (4317),
Alloy OTLP (4317/4318).

Substrate ships Alloy (OTLP receiver on 4317/4318) + Tempo + Grafana + Prometheus
(remote_write enabled). Services send OTLP via
`OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy.observability:4318` (set in each chart's
env). Traces land in Tempo, logs in Loki, metrics in Prometheus.

Dev stays lean: `OTEL_SDK_DISABLED=true`, no LGTM stack. Do not run the
observability profile on dev unless debugging a cross-service flow.

## Standardizing application metrics (OTLP)

All backends push OTLP metrics to Alloy (`OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy.observability:4318`)
instead of exposing `/metrics` for Prometheus scraping. The canonical guide — baseline metric
set, per-language wiring, gotchas (HTTP signal-path append), verification steps, and the
service-by-service migration status — lives in the notes repo:

  notes/otlp-metrics-standard.md (anywaye/notes)

Migrated so far: gateway, identity, ship (all Go). Pending: courier (Elixir), billing (Ruby),
press (Go), website (Node), darkroom, muse, keyholder, docs, parlor, ella. When adding a new
service, follow that doc so metrics, traces, and dashboards stay consistent.

## Error tracking (GlitchTip)

GlitchTip is our error tracking service (Sentry-SDK-compatible, self-hosted).
It is for **anywaye's own use** (anywaye.com), not part of the customer substrate.

- **Dev:** Not running (removed to keep dev lean). Services have no DSN set, so
  error reporting is disabled (`InitErrorReporting` returns early when DSN is empty).
- **Prod:** Runs on app-mf (port 8095, docker compose in /opt/glitchtip).
  Accessible via k8s Service `glitchtip.default:8095`.
  DSN: `http://c5342cbf-5a88-464e-9576-cc8b40d0730b@glitchtip.default:8095/1`
- **MCP server:** Enabled (`GLITCHTIP_ENABLE_MCP=True`). Agents can fetch issues,
  read stack traces, and manage errors via MCP. This supports the future
  agent-driven error resolution loop (report → reproduce → fix → deploy → confirm → email).
- **Wired services (backend, GlitchTip project 2 DSN `da15bbe5...`):** gateway,
  identity, ship, courier, ella. Each reads its `*_ERROR_REPORTING_DSN` env var
  (set in that chart's `values.yaml`) and inits the Sentry SDK in-app.
- **Admin:** kaka@anywaye.com (password in Bitwarden: "app-mf observability (unified)").
- **Public URL:** https://errors.anywaye.com (Traefik ingress → host:8095).
- **MCP endpoint:** https://errors.anywaye.com/mcp/ (requires API token).
- **Project:** anywaye (slug: anywaye-r4, id: 2)
- **DSN:** `http://da15bbe5-6b70-4b2f-92a5-ce8a8365fecf@glitchtip.default:8095/2`
- **Website (frontend, @sentry/react):** SDK integrated in `src/sentry-init.ts`, but
  the DSN is a placeholder (`deadbeef...@errors.anywaye.com/1`). The real project-1
  key is `c5342cbf-5a88-464e-9576-cc8b40d0730b` and no chart/env sets
  `VITE_SENTRY_DSN`, so website errors do not currently land in GlitchTip.
  Follow-up: fix the fallback key or wire `VITE_SENTRY_DSN`.
- **Reproducible setup:** `kit/templates/internal/glitchtip/compose.yml` +
  `README.md`. Run on any VPS with Docker: `cd /opt/glitchtip && docker compose up -d`.
  Not part of the customer substrate (internal only).

## Database backups (CloudNativePG → Cloudflare R2)

Status: **configured and restore-tested on 2026-10-26.** The single Postgres
`Cluster` `postgres` now lives on **data-mf** (migrated from app-mf on 2026-11-10).
All service databases are on data-mf's CNPG cluster. app-mf no longer runs Postgres.

Backups go to the R2 bucket `app-mf-db-backups` (account
`1e83e8ee4d1b6e51c2f4527ea005804d`, region auto, endpoint
`https://1e83e8ee4d1b6e51c2f4527ea005804d.r2.cloudflarestorage.com`).

**Architecture:** See `/code/anywaye/notes/architecture/two-tier.md` for the
full two-tier (app-mf + data-mf) architecture.

- **Cluster backup (plugin-based):** `cluster/postgres` (namespace `data`) uses the `barman-cloud.cloudnative-pg.io` plugin (no deprecated in-tree `spec.backup`):
  Plugin WAL archiver `barmanObjectName: postgres-r2` (backed by `ObjectStore/postgres-r2`:
  destination `s3://app-mf-db-backups/postgres`, retention `30d`, WAL + data gzip).
  Credentials live in Secret `r2-backup-creds` (namespace `data`):
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`.
  The credential is a Cloudflare API token (id `209782f7dd2fe81474c7e9270e587104`,
  permission `Workers R2 Storage Bucket Item Write` scoped to that bucket); its
  secret access key is the SHA-256 of the token value. **Do not commit these
  values; rotate by replacing the secret and restarting pods.**
- **Schedule:** `ScheduledBackup/postgres-daily-backup` (namespace `data`),
  cron `0 0 2 * * *` (02:00 UTC daily), `backupOwnerReference: none` so backups
  survive cluster deletion. WAL is archived continuously (verified: new
  `wals/.../*.gz` objects land roughly every 5 min).
- **Manual backup:**
  ```sh
  ssh app-mf 'KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl apply -f -' <<'EOF'
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
- **Restore drill (proven 2026-10-26):** create a scratch `Cluster` that recovers
  from the external barman store, wait for `Cluster in healthy state`, query a
  known table, then delete the scratch cluster + PVCs:
  ```sh
  cat >/tmp/scratch.yaml <<'EOF'
  apiVersion: postgresql.cnpg.io/v1
  kind: Cluster
  metadata:
    name: postgres-scratch-restore
    namespace: data
  spec:
    instances: 1
    imageName: ghcr.io/cloudnative-pg/postgresql:18.6-system-trixie
    storage: { size: 5Gi, storageClass: local-path }
    bootstrap:
      recovery: { source: postgres-backup }
    externalClusters:
      - name: postgres-backup
        plugin:
          name: barman-cloud.cloudnative-pg.io
          parameters:
            barmanObjectName: postgres-r2
            serverName: postgres
  EOF
  ssh app-mf 'KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl apply -f -' < /tmp/scratch.yaml
  # wait for healthy, then verify:
  ssh app-mf 'KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl exec -n data postgres-scratch-restore-1 -- psql -U postgres -d identity -c "SELECT count(*) FROM users;"'
  # cleanup:
  ssh app-mf 'KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl delete cluster postgres-scratch-restore -n data'
  ```
  Last drill result: scratch cluster reached `Cluster in healthy state`; `identity.users`
  count matched prod (6). WAL archiving objects present in R2.
- **Point-in-time recovery:** CNPG supports recovery targets via
  `bootstrap.recovery.recoveryTarget` (time/LSN/XID). Coordinate before acting;
  a bad restore into a live database is a second incident. Always restore into a
  scratch cluster first, verify, then cut over.
- **Migration status (2026-10-26):** migrated from in-tree `barmanObjectStore` to the
  `barman-cloud.cloudnative-pg.io` plugin (ObjectStore `postgres-r2`, plugin backup
  `postgres-backup-plugin-test-1` completed, scratch restore verified). No
  deprecated in-tree backup remains; the cluster is ready for CNPG 1.31 when it
  ships. Operator is on 1.30.1 (latest stable); plugin on 0.15.1.
- **Still not covered (by design):** the `darkroom` object bucket (bytes, not
  Postgres rows), Redis state (gateway sessions/rate limits — inconvenience, not
  an incident), and any container ephemeral filesystem. Back up the darkroom
  bucket separately per your bucket provider.

## Gotchas (prod)

1. **Never develop on prod.** No worktrees, no direct edits, no ad-hoc services.
2. **Migrations never run automatically.** Always run `bin/migrate` by hand.
3. **Secrets created once by install.sh.** Re-running install.sh does not overwrite;
   rotate by replacing the secret and restarting pods.
4. **Argo sync is event-driven.** After publish/stamp, Argo syncs within seconds.
   Don't expect instant propagation if the Application manifest hasn't changed.
5. **Substrate changes need install.sh or kubectl apply** — Argo self-heals
   Application-level changes only.
6. **GlitchTip DSNs are per-project.** Use the right DSN for the service's project.
7. **Prod observability is full-stack.** Traces/metrics/logs go to Tempo/Loki/Prometheus;
   a missing signal usually means the chart env lacks `OTEL_EXPORTER_OTLP_ENDPOINT`.