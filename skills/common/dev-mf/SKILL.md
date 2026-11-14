---
name: dev-mf
description: Use when developing the anywaye stack on the `dev-mf` VPS (host alias `dev-mf`, also `mainframe` for backward compat). Covers SSH access, env sourcing, worktrees, trunk-based development, gates, migrations, feature flags, and the gotchas. True TBD: no PRs, no preview URLs, no local services required. Tailscale for private access.
---

# Remote anywaye development on dev-mf VPS

The anywaye stack lives on the `dev-mf` VPS (Contabo). Your local `/Users/kaka/Code/any/anywaye` directory is an empty placeholder — **it is not a git repo and must never be initialized as one**. All code, builds, and data are on the box.

## SSH access policy (SECURITY — read before anything else)

**SSH to dev-mf is allowed** — it's the development box. All code work happens here.

**SSH to production VPSes (app-mf, data-mf, infra-mf) is PROHIBITED for agents**
unless the founder grants explicit written permission. This is the same policy as
the app-mf and data-mf skills.

### What to do instead (in order of preference)

1. **Ops MCP service** (`https://ops.anywaye.com/mcp`) — read-only queries and
   reversible remediation for prod. Use for ALL prod diagnostics.
2. **Argo CD** (`https://argo.anywaye.com`) — GitOps. All config/env/manifest
   changes go through git → Argo sync. No SSH needed.
3. **bin/deploy / bin/publish** on dev-mf — builds and publishes. Prod syncs
   automatically via Argo CD Image Updater.
4. **GlitchTip** (`https://errors.anywaye.com/mcp/`) — error tracking.
5. **Grafana/Prometheus** — metrics, logs, traces.

### When SSH to prod might seem necessary

1. **Stop.** Do not SSH.
2. **Document the task** and why SSH seems necessary.
3. **State how to automate it** so future agents don't need SSH.
4. **Ask the founder for written permission.** Wait for explicit approval.
5. **If approved:** SSH is allowed for that specific task only.

**If you are reading this skill and considering SSH to prod, re-read this section first.**

## Connection

- **Host alias:** `dev-mf` (in `~/.ssh/config`, also `mainframe` for backward compat)
- **SSH:** `ssh dev-mf`
- **Exec one command:** `ssh dev-mf '<cmd>'`
- **No instabox.** No cert expiry, no auto-suspend, no sandbox limits.
- **Tailscale:** The VPS is on a private Tailscale network. SSH via Tailscale IP
  or the `dev-mf` alias (which resolves to the Tailscale IP).

## Critical: environment variables

No instabox vault. Secrets are stored in Bitwarden and loaded via `bw get`.
Source your env file (in `~/.env` or `~/.secrets`) which contains:

```sh
export GH_TOKEN=$(bw get password "GitHub Token")
export OPENCODE_API_KEY=$(bw get password "OpenCode API Key")
export REFLECTION_API_KEY=$(bw get password "Reflection API Key")
```

Or use a local `.env` file (git-ignored) with the values. Never commit secrets.

All SSH commands should start with sourcing your env:

```sh
source ~/.env   # or ~/.secrets
```

## Where things live on the box

- Repos: `/code/anywaye/<repo>` (e.g. `/code/anywaye/ship`, `/code/anywaye/ella`)
- **boax** is a separate application (sandbox/agent orchestration) developed and deployed
  similarly to anywaye services. Repo: `/code/anywaye/boax`. Uses the same conventions:
  worktrees, feature flags, `bin/prime`, `bin/deploy`, Argo CD on prod.
- Shared infra: started from `/code/anywaye/identity` via `bin/dev`
- Postgres: `localhost:15500` (user `anywaye`, password `anywaye`)
- Redis: `localhost:15800`
- NATS: `localhost:15600` (client), `15700` (monitoring)
- **Non-anywaye projects:** the box also hosts the konstrainc repos under
  `/code/konstrainc/` (kawibot, core, site, desktop, data-engine). They use the
  host PostgreSQL 16 cluster on `127.0.0.1:5432` (databases `kawibot_*` and
  `data_engine_*`) and have their own toolchains. See the `konstrainc` skill for
  paths, env, commands, and known test-suite caveats. Do not run Kamal
  deployments from this box.

## Private notes (`/code/anywaye/notes/`)

Private operator notes live in `/code/anywaye/notes/` (MD files, organized in
subdirectories). These are **never public** — they sync to the private docs build
(`dist/notes`) served at `/notes/*` behind the identity gate (auth.anywaye.com).

- **Index:** `/code/anywaye/notes/README.md` (privacy policy, structure, publishing)
- **Infisical:** `/code/anywaye/notes/infrastructure/infisical.md` — self-hosted
  setup on dev-mf (Docker Compose, caddy, Cloudflare, agent-vault proxy)
- **Two-tier arch:** `/code/anywaye/notes/architecture/two-tier.md` — app-mf + data-mf
  split, connection strings, migration status
- **Rule:** Never include secret values. Reference Bitwarden items by name.
- **Publishing:** `bin/sync-content` reads `anywaye/notes/**` into the docs build.

## Infisical (self-hosted secrets + agent-vault)

Infisical runs on dev-mf via Docker Compose. See the private note for full details:
`/code/anywaye/notes/infrastructure/infisical.md`.

Quick reference:
- **URLs:** https://vault.anywaye.com (Infisical), https://proxy.anywaye.com (agent-vault proxy)
- **Location:** `/home/ubuntu/infisical/` on dev-mf
- **Admin:** kaka@anywaye.com (password = observability stack password)
- **Image:** `infisical/infisical:v0.167.6` (pinned)
- **Compose:** `cd /home/ubuntu/infisical && docker compose -f docker-compose.prod.yml up -d`
- **Caddy:** reverse proxy on ports 80/443, auto TLS via Let's Encrypt
- **Secrets:** stored in Bitwarden (Infisical dev-mf dev test, Boat.dev API key, proxy token)
- **Do not use in prod yet.** Dev/test instance only.

**Agent instructions:** When adding secrets or configuring services that should be
accessed via the agent-vault proxy, read the private notes first:
`/code/anywaye/notes/infrastructure/infisical.md` (on dev-mf). This note
documents the Infisical setup, proxy configuration, credential flow, and
Bitwarden item names. Do not guess — read the note.

## Database naming (easy to ID)

Three tiers, same name base (`<service>`), distinguished by where they live:

- **Worktree (preview) clone:** `<service>_<task>` — a Postgres template copy of the
  dev box shared db. Schema/data changes here
  cannot corrupt the shared db. Dropped on `stop`.
- **Dev box shared:** `<service>` on the dev box (e.g. `ship`, `identity`). This is
  the trunk's working data on the dev box. Same DB, same connection strings as before.
- **Production:** `<service>` on the prod cluster (separate box/cluster), so the
  name collides only across clusters, never within one.

Rule: never point a worktree at the shared dev db unless you pass `--shared-db`
(and accept the corruption risk). Never point dev at a prod db.

## Worktree discipline (MANDATORY) — trunk-based development

`master` is the trunk: the only long-lived branch, always green and deployable.
Pushing to `master` triggers the publish flow and deploys to anywaye.com, so
**never commit directly to `master` in the canonical repo directory** — always work
in a worktree, then merge.

Multiple agents may work on the same codebase concurrently. To avoid conflicts
and keep the box clean, **always work in a git worktree**, never directly on
`master` in the canonical repo directory.

### Starting work

1. Create a worktree under the shared worktrees directory:
   ```sh
   mkdir -p /code/anywaye/worktrees
   cd /code/anywaye/<repo>
   git worktree add /code/anywaye/worktrees/<repo>-<task> -b <task-branch>
   cd /code/anywaye/worktrees/<repo>-<task>
   ```
2. Do all development, testing, and verification inside the worktree.
3. Never edit files in the canonical repo directory directly.

### Feature flags (MANDATORY for all changes)

Every change ships behind a feature flag. This is non-negotiable. The flag is the
safety net that makes TBD safe: code merges to `master` and deploys to prod, but
the behavior is dark until the flag is flipped.

- Add the flag to `internal/features` (ship) / the website gating layer per
  `notes/feature-flags.md` (defaults: core features on, new features off).
- Merge to `master` with the flag off. The code is integrated and tested by the
  gate but no user sees the new behavior.
- **Staff/admin gating:** The initial person allowed to see a change is whoever
  is marked as staff/admin in identity (`IsStaff` on the User model). Staff users
  can enable flags for themselves before anyone else sees them. First gate:
  staff -> beta -> GA.
- Test in prod by enabling the flag for your own staff account, then beta users,
  then GA (everyone).
- Rollback is flipping the flag off (instant, no redeploy) or `git revert` + republish.

### Making work live (TBD)

Changes in a worktree do **not** reflect on the box's running services -- they
point at the canonical repo directories, not worktrees. To make your work live:

1. Finish and verify in the worktree (full gate green).
2. Merge to `master` and push: `git push origin master`.
3. Run `./bin/deploy` (migrate locally + build/push image + bump chart version +
   stamp digest + push chart + restart local service). Argo CD Image Updater
   detects the new image and syncs prod. Migrations run as an Argo PreSync hook
   (Job) before the new pod deploys — if they fail, sync aborts and old pod stays.
4. **Only merge when ready and verified** -- do not merge half-finished or broken work.
   A bad merge makes prod unusable. Feature flags are how you merge unfinished
   *behavior* safely: merge the code dark, flip the flag later.

Local services on the dev box are optional (for debugging integration). They are
not part of the deploy flow. If you run them, restart after merge to pick up new code.

### Deploying (manual builds, no CI)

Publish and deploy go through `bin/deploy` (which calls `bin/publish` internally).
There is no CI and no GitHub Actions. `bin/deploy` runs on dev-mf and handles:
migrations (local dev database), image build+push, chart version bump, digest
stamp, chart push, version bump commit+push, and local service restart.

Prod sync is automated by Argo CD Image Updater: it detects the new image tag
in GHCR and triggers an Argo sync. Prod migrations run as a PreSync hook (Job)
before the new pod deploys — if they fail, sync aborts and the old pod stays.

If you need to build and publish without restarting the local service, run
`./bin/publish` (build+push image to GHCR, build+push chart to OCI registry).

Do NOT put `image.digest` in the Application's `helm.values` override: it shadows
the chart's stamped digest and breaks the flow. Override only `env:` (and similar) there.

## GitOps auto-sync (no SSH/kubectl needed for config or env changes)

Every product service has a `*-gitops` Argo CD Application (e.g. `website-gitops`,
`ship-gitops`) that watches its repo's `deploy/` directory and auto-syncs any
change to `deploy/argocd-application.yaml`. This means:

- **Env var changes:** edit `deploy/argocd-application.yaml`, commit, push. The
  gitops app detects the new revision and syncs it to the cluster automatically.
  No `kubectl apply`, no SSH to prod, no manual step.
- **New config / new manifests:** add a file to `deploy/` and push. The gitops app
  picks it up and applies it.
- **Code changes:** still go through `bin/deploy` (image build + push + Argo
  Image Updater syncs the new image tag).

**Do NOT create redundant `*-root` or app-of-apps Applications for product
services.** They conflict with the existing `*-gitops` apps (SharedResourceWarning)
and break auto-sync. The `*-gitops` apps are created once during `install.sh` /
substrate setup and are the single source of truth for manifest sync.

**Standalone (non-gitops) Applications ARE allowed for secrets and raw manifests.**
These use kustomize + ksops (not Helm charts) and cannot go through the
chart-based ApplicationSet. They are applied once via break-glass (`kubectl apply`)
and then self-managed by Argo (automated sync, selfHeal). This is the
established pattern: `boax-secrets` (in the boax repo) and `infisical-secrets` /
`agent-vault-proxy` (in the argo-apps repo). They do NOT conflict with `*-gitops`
apps because they manage a different resource set (k8s Secrets, CNPG CRDs, etc.).

**Why two mechanisms?** Argo CD Application `source` supports EITHER `chart` (Helm)
OR `path` (Kustomize), not both. Additionally, ApplicationSet Go templates are
applied **per-field** — control keywords (`{{ if }}`) cannot span multiple
fields, so you cannot conditionally switch between `chart` and `path` in a
single template. Mixing both in one ApplicationSet is not supported by Argo CD.
The two-mechanism approach (ApplicationSet for charts, standalone Applications
for kustomize) is the correct and only viable pattern.

**Break-glass (SSH + kubectl) is only needed for:**
- Creating k8s Secrets (see "Env var safety" below).
- Substrate/infra changes (Alloy, Tempo, CNPG, etc.) — see app-mf skill.
- Initial install of a brand-new service's gitops app.
- Anything the ops service cannot do (see app-mf skill).

## Proper no-SSH onboarding for new services (the system, not the manual steps)

The goal: a new service goes from "code on master" to "running on prod" with
zero SSH and zero break-glass, after a one-time substrate setup. Three
questions come up every time; here are the proper answers.

### Secrets: `any secret` is the dev path; prod uses the same system, extended

- Dev: `any secret set/get/list` stores in FileRing (local keyring). `any dev`
  injects them at runtime. No `.env` files with values.
- Prod: k8s Secrets are the runtime store. Two proper ways to populate them
  without SSH:
  1. **External Secrets Operator (ESO)** — syncs a Bitwarden item into a k8s
     Secret on a schedule. The chart declares an `ExternalSecret` referencing
     the Bitwarden item name; ESO creates and rotates the Secret. No secret
     value in git. One-time substrate install (add ESO to kit's install.sh);
     after that, new services just declare their ExternalSecret.
  2. **Extend the `any` CLI** — `any secret set --target=prod <key>` calls the
     ops service, which creates/updates the k8s Secret (audited, idempotent,
     staff-gated). Same UX as dev, different backend. This is the
     "extend existing systems" option; prefer it over inventing a new flow.
- Either way, the chart references the Secret via `secretKeyRef` (committed,
  credential-free). The `env:` block in `deploy/argocd-application.yaml` stays
  non-secret only.

### DB changes: migrations are the answer; initial DB/user is provisioning

- Schema changes: write a goose migration in `internal/store/postgres/migrations/`.
  The deploy flow runs it as an Argo PreSync Job before the new pod deploys.
  `bin/migrate` applies locally; prod runs it automatically. No manual SQL.
- Initial database + user creation (one-time per service): use CNPG `Database`
  and `Role` CRDs in the chart (or ops service). CNPG provisions them
  declaratively; no `CREATE DATABASE` by hand. This is the same pattern as
  namespace creation via `CreateNamespace=true`.
- Example: Infisical's DB/user are auto-provisioned via CNPG `Database` +
  `DatabaseRole` CRDs in `anywaye/argo-apps/infra/infisical/` (kustomize). No
  manual `CREATE DATABASE`/`CREATE USER` needed — Argo + CNPG handle it.
  The password comes from the SOPS-encrypted `infisical-secrets` secret's
  `password` key.
- Rule: never point a worktree at the shared dev DB unless `--shared-db` is
  passed. Never point dev at prod.

### Argo changes: gitops auto-sync covers existing services; new services need one-time registration, automatable via ApplicationSet

- Existing service: edit anything under `deploy/`, commit, push. The
  `*-gitops` Argo Application watches that directory and syncs automatically.
  No SSH, no kubectl, no manual step.
- New service: the `*-gitops` Argo Application itself does not exist yet, so
  the first manifest push has nothing to sync. Two proper fixes:
  1. **Argo ApplicationSet** (git generator) — watches a directory of service
     manifests and auto-creates an Application for each. New service onboarding
     becomes "add a manifest file + push"; the ApplicationSet handles the rest.
     This is the GitOps-native discovery mechanism and is distinct from an
     app-of-apps (which we deliberately avoid — see the warning above).
  2. **kit substrate install** — add the manifest to `kit/templates/substrate/
     manifests/applications/` and re-run install.sh. One-time substrate action.
- After registration, the service follows the normal gitops flow forever.

### Example: onboarding a new service (boax-website, 2026-11-06)

boax-website is the TanStack Start web app at boax.dev, cloned from parlor.
It follows the standard pattern above:

1. **Image + chart published** via `bin/publish` (builds Docker image, pushes to
   GHCR, packages + pushes chart to OCI registry, stamps image digest in values.yaml).
2. **Argo Application manifest** at `deploy/argocd-application.yaml` in the
   boax-website repo (chart: boax, targetRevision: 0.1.0, namespace: boax-website).
3. **One-time registration** — apply the Argo Application once (break-glass or
   via ApplicationSet). After that, all config/env changes are git-driven:
   edit `deploy/argocd-application.yaml`, commit, push -> auto-sync.
4. **Code changes** — go through `bin/deploy` (image build + push + Argo Image
   Updater syncs the new image tag). Migrations run as Argo PreSync hooks.
5. **Secrets** — `boax-website-secrets` k8s Secret (created once, break-glass
   or via ops service). Referenced via `secretKeyRef` in the chart's env.

The `boax-website` repo is at `github.com/anywaye/boax-website` (private).
Clone it, customize, push. The Argo Application is applied once; after that,
everything is git-driven.

### The one-time substrate actions (founder, then permanent)

These are installed once and benefit every future service:
- External Secrets Operator (or ops-service secret provisioning)
- Argo ApplicationSet for service discovery
- CNPG Database/Role CRD support (already in CNPG, just needs chart usage)

After those are in place, new-service onboarding is fully agent-driven:
add manifest + chart + bin scripts → push → auto-provisions. The first
service always needs a bootstrap; every subsequent service needs less.

## Env var safety: what can go in git

`deploy/argocd-application.yaml` holds the `env:` override block. Not every value
belongs there:

**Safe to commit (non-secrets):**
- Service URLs (`SHIP_URL`, `IDENTITY_URL`, `BOX_URL`, etc.)
- Observability config (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`)
- Feature flags and toggles (`SHIP_FEATURES`, `<SVC>_FEATURE_<NAME>`)
- Public config (timeouts, limits, feature gates, log levels)
- Webhook URLs for low-sensitivity channels (e.g. a leads-notification webhook
  for a public contact form) — acceptable in Phase 0, but prefer a Secret for
  anything that grants write access to a system.

**Must NOT be committed (secrets):**
- API keys, tokens, passwords, DB credentials, private keys, OAuth client secrets.
- Any value that grants access to a system or data.

**How to handle secrets instead:**
1. Create a k8s Secret (one-time, break-glass): `kubectl create secret generic <name> --from-literal=KEY=value -n <ns>`.
2. Reference it in the chart via `secretKeyRef` (chart change, committed — no
   secret value in git).
3. Or use an External Secrets Operator to sync from Bitwarden / a cloud secret
   store into k8s Secrets automatically (fully automated after one-time setup).

**Rule of thumb:** if leaking the value would let someone do something they
shouldn't, it's a secret — keep it out of git. If it's just configuration that
happens to be environment-specific, it's safe to commit.


## Rollback

Three modes, all run from this box:

- `bin/rollback` — revert the last commit, publish, deploy (~2 min). Use `--commit <sha>`
  to revert a specific commit, `--no-publish` to revert+push without deploying.
- `bin/rollback --flag <name>` — instant rollback: disables a feature flag (no redeploy).
  Sets `<SVC>_FEATURE_<NAME>=false` in the service environment.
- `bin/migrate-down [file|last]` — reverse a migration. Extracts and runs the `-- +goose Down`
  section via psql. Use `--dry-run` to preview the SQL first.
- `bin/migration-down-section <file>` — extracts the Down section (mirror of
  `migration-up-section`).

Rollback decision tree:
| Situation | Action | Speed |
|---|---|---|
| Incomplete feature broke | Flip the flag | Instant (no redeploy) |
| Code change broke something | `bin/rollback` | ~2 min (revert + publish + deploy) |
| Migration broke schema | `bin/migrate-down` + `bin/rollback` | ~2 min |
| Need to roll back to specific version | `bin/rollback --commit <sha>` | ~2 min |

Prod-side rollback (Argo revision rollback, CNPG point-in-time recovery) is in the
app-mf skill.

## Finishing work (done and verified)

1. Run the full gate (`./bin/prime` or `mise run prime`) inside the worktree and confirm green.
2. Merge the branch to `master` (this is the prod deploy trigger):
   ```sh
   cd /code/anywaye/<repo>
   git checkout master
   git merge --no-ff <task-branch> -m "merge: <task summary>"
   git push origin master
   git checkout master   # leave canonical repo on master (trunk)
   ```
3. **Clean up everything created for this worktree AND any supporting files:**
   ```sh
   cd /code/anywaye/<repo>
   git worktree remove /code/anywaye/worktrees/<repo>-<task>
   git branch -d <task-branch>
   git worktree prune
   # Remove any temp files, build outputs, scratch dirs, or logs created during the task
   rm -rf /tmp/<task>-* 2>/dev/null
   ```
4. Restart the affected service so it picks up the new code.
5. Verify the box is clean:
   ```sh
   git worktree list          # only the main worktree should remain
   git status                 # clean
   git branch                 # no leftover task branches
   ls /code/anywaye/worktrees/  # no leftover worktrees
   ls /tmp/ | grep <task>     # no leftover temp files
   ```

## Abandoning work

If work is abandoned (task cancelled, approach failed, superseded), **clean up
immediately** — do not leave dangling worktrees or branches:

```sh
cd /code/anywaye/<repo>
git worktree remove --force /code/anywaye/worktrees/<repo>-<task>
git branch -D <task-branch>
git worktree prune
# Remove any temp files, build outputs, scratch dirs, or logs created during the task
rm -rf /tmp/<task>-* 2>/dev/null
```

Then verify the box is clean (same checks as above).

## Rules

- **One worktree per task.** Never share a worktree between agents or tasks.
- **No leftover artifacts.** Temporary files, build outputs, scratch dirs, log files,
  and any other resources created to support the worktree must be removed before
  finishing -- not just the worktree itself. If it was created for this task and
  nothing else needs it, delete it.
- **Keep the trunk green.** `master` must build and pass the gate at all times. A red
  trunk blocks everyone and is an emergency, not a "fix later."
- **Keep the box clean at all times.** After every task (done or abandoned), the
  canonical repo must be on `master`, clean, with no extra worktrees, branches,
  temp files, or scratch directories.
- **If unsure whether a worktree or its supporting files are still needed, remove
  them.** A missing artifact is recoverable; a cluttered box causes merge
  conflicts and wasted time.
- **Hotfixes are not special-cased.** Branch a worktree off `master`, fix, merge to
  `master`, verify. No separate hotfix branch or fast-track.
- **Incomplete work ships dark.** Use feature flags (see `notes/feature-flags.md`)
  instead of long-lived branches. Merge to `master` behind a flag and flip it on later.
- **Destructive changes keep both paths.** If a worktree change breaks or replaces
  existing behavior, put it behind a feature flag and keep the old code path working
  for users without the flag. After everyone has migrated, remove the dead code and
  the flag in a follow-up change.
- **Feature flags must be set up before merging.** By the time a change merges to
  `master`, any feature flag it depends on must already exist in the flags module
  (constants, defaults, registry entry) and be wired into the code. Do not merge
  a change that references a flag that is not yet defined.
- **Staff/admin gating for new features.** The initial person allowed to see a change
  is whoever is marked as staff/admin in identity (`IsStaff` on the User model). Staff
  users can enable flags for themselves before beta or GA. This is the first gate:
  staff -> beta -> GA. Use `SHIP_FEATURE_<NAME>=true` or the per-user flag override.
- **Migrations and infra changes are the exception.** These cannot be feature-flagged
  and take effect on deploy. Test them in a worktree with a cloned DB (or against
  the box's shared DB) before merging to `master`. Code changes do not need this.
- **URLs.** The only URL is anywaye.com (prod). There are no dev, staging, or
  preview URLs. Access the box via SSH.

## Standard workflow (true TBD)

The repeatable path from code to prod:

```
1. Create worktree on dev-mf
2. Write code
3. Run gate (bin/prime) — tests, build, vet
4. Merge to master (small increment)
5. Push to master: git push origin master
6. Run ./bin/deploy (local migrate + publish + restart local). Argo Image Updater
   syncs prod; prod migrations run automatically as a PreSync hook.
7. Monitor in prod (GlitchTip + Grafana)
8. If broken: flip flag or revert + republish
9. Clean up worktree + branch
```

**No PRs. No preview URLs. No CI.** Builds are fully manual on dev-mf. The gate
is the quality check. Prod is the test environment. Feature flags are the safety net.

### What runs where

| Step | Where | Automated? |
|---|---|---|
| Code editing | dev-mf | No (human/agent) |
| Local gate (bin/prime) | dev-mf | No (human/agent) |
| Merge + push | dev-mf | No (human/agent) |
| Image build + push | dev-mf | Manual (`bin/deploy`) |
| Chart publish + version bump | dev-mf | Manual (`bin/publish` via `bin/deploy`) |
| Prod deploy | app-mf (k3s + Argo) | Yes (Argo syncs on push) |
| Prod DB migration | app-mf (Argo PreSync Job) | Yes (runs automatically during sync) |
| Prod monitoring | app-mf (Grafana/GlitchTip) | Yes (always on) |

### Local gate (bin/prime) — the quality check

`bin/prime` is the developer's pre-push check. It runs locally on dev-mf
before pushing. It catches errors early. It is the primary quality gate.

### Fully manual builds on dev-mf

All builds happen on dev-mf, triggered manually by running `./bin/deploy` after
pushing to master (or `./bin/publish` for build-only). Do not run `docker build`
directly — `bin/deploy` / `bin/publish` are the supported paths.

Prod deploys are automated by Argo: after you push to `master` and run
`bin/deploy`, Argo CD Image Updater syncs the new image and prod migrations
run automatically as a PreSync hook.

### Worktrees (agent isolation, not branches)

Worktrees are mandatory for concurrent agents. They are isolation mechanisms,
not long-lived branches. Create, work, merge, delete — all in one session.
No PRs, no review, no preview environments.

### Feature flags (the safety net)

Every new feature ships behind a flag. Toggles are env-driven:
- `<SVC>_FEATURES=flag1,flag2` — enable named flags
- `<SVC>_FEATURE_<NAME>=true|false` — override a single flag

Merge code to `master` behind a flag, flip it later. Rollback is flipping the
flag (no redeploy) or `git revert` + republish.

### Deploy mechanism

Deploys are triggered manually by running `./bin/deploy` after pushing to master.
There is no CI and no GitHub Actions. `bin/deploy` handles:
- Migrations (local dev database)
- Image build + push to GHCR
- Chart version bump + digest stamp + chart push to OCI
- Version bump commit + push to master
- Local service restart

Prod sync is automated by Argo CD Image Updater, which detects the new image
tag in GHCR and triggers an Argo sync. Prod migrations run as a PreSync hook
(Job) before the new pod deploys — if they fail, sync aborts and the old pod stays.

Docker builds and image publishing happen on **dev-mf** (this box), always
triggered manually via `./bin/deploy` (or `./bin/publish` for build-only).

- **Prod deploys** are automated via Argo CD Image Updater (triggered by the new
  image in GHCR) — initiated manually via `bin/deploy`.
- **Builds** are fully manual on dev-mf via `./bin/deploy` (or `./bin/publish`).
- **Local gate** (`bin/prime`) runs here before pushing — it is the developer's
  pre-push check.

Every new feature ships behind a flag. Toggles are env-driven (no external service
needed):

- `<SVC>_FEATURES=flag1,flag2` — enable named flags
- `<SVC>_FEATURE_<NAME>=true|false` — override a single flag

For ship: `SHIP_FEATURES`, `SHIP_FEATURE_<NAME>`. The full pattern and copy-paste
templates for Go/TS/Python live in `notes/feature-flags-pattern.md` and
`anywaye/templates/feature-flags/`. Ship already implements `internal/features`
(OpenFeature) + `internal/featureflags` (per-project, Postgres-backed) and exposes
`GET /v1/features` for the website BFF.

## Feature flag workflow in prod (full lifecycle)

When a change reaches prod (deployed behind a flag, flag off by default):

1. **Owner tests first.** The person who built the change enables the flag for
   their own staff account (identity `IsStaff` = true). They use the feature in
   prod with real data, real traffic, real latency. If it breaks, flip the flag
   off -- no redeploy, no downtime.

2. **Monitor.** Check GlitchTip (https://errors.anywaye.com) for new errors and
   Grafana (https://grafana.anywaye.com) for metrics anomalies. Watch for:
   - New error types in GlitchTip (MCP server can query these)
   - Latency spikes (p95, p99) in Grafana
   - Error rate increases (5xx responses)
   - Any alerts firing

3. **Beta rollout.** If the owner is satisfied, enable the flag for a subset of
   users (beta group). Monitor the same metrics. If errors spike, flip off.

4. **GA.** If beta is clean, flip the flag on for everyone. The feature is now
   live for all users.

5. **Cleanup (if everything works).** Once stable, do a follow-up change that:
   - Removes the flag check from the code
   - Deletes the old code path
   - Removes the flag from `internal/features` defaults
   - Merges to `master` and deploys
   This pays off the flag debt. Don't skip it.

6. **Revert (if it doesn't work).** If the feature is broken:
   - Flip the flag off (instant rollback, no redeploy)
   - Investigate using GlitchTip (stack traces, affected users) + Grafana
   - Fix in a new worktree, merge, deploy
   - Re-enable the flag when fixed
   - If the code itself is broken (not just behavior), `git revert` the merge
     commit + republish + redeploy

### What to monitor in prod

- **GlitchTip** (https://errors.anywaye.com): new error types, error volume,
  affected users. Use the MCP server for agent-driven triage.
- **Grafana** (https://grafana.anywaye.com): request rate, error rate, latency
  (p50/p95/p99), resource usage. Dashboards per service.
- **Prometheus** (https://prometheus.anywaye.com): raw metrics, PromQL queries.
- **Alloy** (https://alloy.anywaye.com): collector health, OTLP receiver status.
- **Tempo** (via Grafana): distributed traces for request flows across services.
- **Logs** (via Grafana -> Loki): structured JSON logs from all services. Filter
  by service, level, trace ID.

### Post-deploy checklist

After every deploy:
1. Check GlitchTip for new errors (should be zero new issues)
2. Check Grafana for error rate spikes or latency increases
3. If a feature flag was flipped, verify the behavior works for your account
4. If everything is clean for 24h, proceed with cleanup (remove flag + old code)
5. If anything is broken, flip the flag off and investigate

## Starting the dev stack

```sh
ssh dev-mf
source ~/.env   # or ~/.secrets
cd /code/anywaye/identity
export KIT_STACK_DIR=/code/anywaye/kit
export KIT_STACK_REF=e20d20664e6f1dc0bfb1023874367d2be43370d5
export KIT_DEV_PROFILES=          # skip observability: LGTM lives in prod only; dev relies on service logs
export KIT_POSTGRES_DATABASES="identity,ship,ella,cafe,core,courier,billing,gateway,keyholder,kit,loom,notes,oauth-stub,platform,press,website,docs,anywaye-py,anywaye-rb,anywaye-ts,box,darkroom,boax"
export COURIER_TOKEN=dummy
./bin/dev
```

Or use the Go CLI: `mf provision --mode dev` (handles everything including OS detection,
package installation, Tailscale, hardening, and directory setup).


## Running migrations

```sh
# Go services (ship, billing, gateway, identity, press)
source ~/.env
cd /code/anywaye/<service>
DATABASE_URL="postgres://<service>:anywaye@localhost:15500/<service>?sslmode=disable" ./bin/migrate

# ella (Python, SQL migrations)
cd /code/anywaye/ella/migrations
for f in $(ls *.sql | sort); do
  PGPASSWORD=anywaye psql "postgres://ella:anywaye@localhost:15500/ella?sslmode=disable" -v ON_ERROR_STOP=1 -f "$f"
done
```

### Verifying a migration in prod (no SSH, no kubeconfig)

Prod migrations run as an Argo CD PreSync hook during deploy. Agents can verify
them without SSH/kubectl via the ops service:

1. Wait ~1-2 min after deploy for Argo sync.
2. Check the migration Job:
   `ops_pods(namespace="<service>")` -> look for `<service>-migrate-*` with status `Succeeded`.
   `ops_pod_logs(name="<that pod>", namespace="<service>")` -> confirm your new
   migration file appears and the output ends with "migrations applied".
3. Confirm schema/data via read-only SQL:
   `ops_db_query(database="<service>", sql="SELECT count(*) FROM <new_table>")`.
   Note: `information_schema.tables` filters by privileges, so prefer
   `pg_tables` / direct `SELECT` when checking for newly created tables.
4. Confirm the Argo Application is `Synced` + `Healthy` (Argo CD UI at
   https://argo.anywaye.com, read-only) and check GlitchTip/Grafana for new errors.

**Permission gotcha (ops_reader):** new tables are created by the service DB user
(e.g. `ship`). By default, `ops_reader` (the read-only role used by
`ops_db_query`) does NOT get `SELECT` on them, so verification fails with
`permission denied for table <name>`.

This is now handled automatically: migration `00038` sets
`ALTER DEFAULT PRIVILEGES FOR ROLE ship IN SCHEMA public GRANT SELECT ON TABLES
TO ops_reader`, so every future table created by `ship` is readable by
`ops_reader` without any per-table work. You do NOT need to add a grant to each
migration anymore.

For belt-and-suspenders (or if you want the grant visible in the migration
itself), the conditional pattern still works and is harmless:

```sql
-- +goose Up
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_reader') THEN
    GRANT SELECT ON <new_table> TO ops_reader;
  END IF;
END $$;
```

The `IF EXISTS` guard makes it safe in dev (where `ops_reader` does not exist)
and in prod (where it does). Without either the default-privileges setup or a
per-table grant, future agents cannot verify the migration through ops and will
have to request a prod DB copy to test.

### Testing a migration against a prod copy (before merging)

For non-trivial migrations (ALTER/DATA backfill), validate against a real prod
snapshot before merging:

```sh
# 1. request a sanitized copy (via ops MCP: ops_request_db_copy database=<svc>)
# 2. poll ops_get_db_copy until status=completed, then download with the ops bearer token:
curl -sL -H 'Authorization: Bearer <token>' '<download_url>' -o /tmp/<svc>.dump
gunzip -c /tmp/<svc>.dump > /tmp/<svc>.sql
# 3. restore into a scratch DB on dev-mf's local Postgres:
sudo -u postgres psql -c 'DROP DATABASE IF EXISTS <svc>_prodtest;'
sudo -u postgres psql -c 'CREATE DATABASE <svc>_prodtest;'
sudo -u postgres psql -d <svc>_prodtest -f /tmp/<svc>.sql
# 4. apply all migrations:
sudo -u postgres env SHIP_DATABASE_URL='postgres:///<svc>_prodtest?sslmode=disable' \
  /code/anywaye/worktrees/<task>/bin/migrate
# 5. verify, then clean up:
sudo -u postgres psql -c 'DROP DATABASE IF EXISTS <svc>_prodtest;'
rm -f /tmp/<svc>.dump /tmp/<svc>.sql
```

The ops bearer token is in `~/.zcode/cli/config.json` under
`mcp.servers.ops.headers.Authorization`. Copies expire after ~24h.

## Running gates

```sh
ssh dev-mf 'cd /code/anywaye/ship && ./bin/prime'
```

Or via the Go CLI: `mf audit` (runs the security audit, 0-100 score).
`mf harden` applies security hardening with sane defaults.


## Loom docs build

Use the env-override approach (no `moon/anywaye` directory needed):

```sh
/code/anywaye/build-loom.sh
```

Or set `CAF_NOTES_PATH`, `CAF_PUBLIC_CONTENT_PATH`, and `CAF_PROJECT_<NAME>` manually.

## Key gotchas

1. **SSH env vars:** Source `~/.env` before running commands. Secrets are in Bitwarden.
2. **Kit remote:** `bin/dev` fetches from `anywaye/kit` by default. Use `KIT_STACK_DIR=/code/anywaye/kit`.
3. **Kit ref:** `kit.ref` contains comments. Set `KIT_STACK_REF` to the bare SHA (`e20d20664e6f1dc0bfb1023874367d2be43370d5`), not the file contents.
4. **COURIER_TOKEN:** Required by identity's compose. Set `COURIER_TOKEN=dummy` in `/code/anywaye/identity/.env`.
5. **Tooling:** Go, Node, Docker, Helm, gh, osv-scanner are pre-installed by `mf provision`. Install extras as needed.
6. **@types/node 22.23.4** doesn't exist on npm. Use 22.19.0 (anywaye-ts) or ^24 (website).
7. **Billing** needs `vendor/anywaye` populated from `anywaye-rb`.
8. **Press** role/DB may not be provisioned by kit — create manually if missing.
9. **Security audit:** Run `mf audit` to check the VPS security posture (0-100 score). Run `mf harden` to apply sane-default hardening (idempotent).
10. **GitOps auto-sync:** `*-gitops` apps auto-sync `deploy/` changes. Edit, commit, push — no SSH/kubectl needed for config/env changes. Do NOT create redundant `*-root` apps (they conflict). See the "GitOps auto-sync" section above.
11. **Observability is prod-only.** The dev box runs no LGTM stack and services have `OTEL_SDK_DISABLED=true` so they never try to reach a collector. On prod, the substrate ships Alloy (OTLP receiver) + Tempo + Grafana + Prometheus (traces, logs, metrics). Services send OTLP via `OTEL_EXPORTER_OTLP_ENDPOINT`. Do not run the observability profile on dev unless debugging a cross-service flow.

## Security fixer sandbox

`ship`'s `fixProject` runs `scripts/sandbox_fixer.py` on dev-mf. The toolchain
(`git`, `python3`, `npm`, `osv-scanner`, `gh`) is pre-installed by `mf provision`.
The fixer script lives at `/code/anywaye/ship/scripts/sandbox_fixer.py`.

The fixer handles its own git auth via `GH_TOKEN` and force-pushes fix branches.
It emits a `RESULT:` line that `ship` parses for counts.

## Production operations (app-mf)

Production operations live in the **app-mf** skill (SSH, kubectl/Argo,
deploys, prod migrations, secrets, substrate changes, observability URLs, GlitchTip).
Use that skill for anything prod-side. Short version:

- **Do not develop on prod.** All code work happens on dev-mf; prod deploys
  verified `master` commits only.
- **Dev has no error reporting:** GlitchTip is not running on dev; services have no
  DSN set and `InitErrorReporting` returns early. Prod DSNs, admin creds, and the
  MCP endpoint are in the app-mf skill.
- Deploy flow originates on dev: `./bin/deploy`; prod syncs via Argo CD on push
  (full GitOps). Prod migrations run automatically as a PreSync hook.

## Useful scripts

Box-side helper scripts live in `/code/anywaye/platform/scripts/` (migrate-all,
start-services, status, build-loom). Run them via:
```sh
ssh dev-mf '/code/anywaye/platform/scripts/<name>.sh'
```


## Browser access

There is no shared public dev URL. The only URLs are:
- **anywaye.com** — production (deploys from `master`).

Access the box via SSH (`ssh dev-mf`). Services run on localhost ports
(Postgres 15500, Redis 15800, NATS 15600, identity 8080, etc.). Use SSH
tunnels to access them from your laptop.

## MASTER DISCIPLINE (non-negotiable, 2026-10-26)

- **`master` is never dirty.** Every canonical repo on the box (`/code/anywaye/<repo>`) must be on `master`, clean, with no uncommitted changes, no leftover worktrees, branches, temp files, or scratch dirs. If `git status` is not empty, that is an emergency, not a "fix later."
- **`master` is always green.** `./bin/prime` (or `mise run prime`) must pass before anything merges. A red trunk blocks everyone.
- **Never edit `master` directly.** All work happens in a git worktree (`/code/anywaye/worktrees/<repo>-<task>`), branched off `master`. The canonical repo directory is read-only for development. No commits, no file edits, no "quick fixes" on `master`.
- **Worktrees are mandatory, not optional.** One worktree per task/agent. Clean up (remove worktree + branch + temp files) when done or abandoned. Verify with `git worktree list`, `git status`, `git branch`.
- **No leftover artifacts.** Anything created for a task (temp files, build outputs, scratch dirs, logs) must be deleted before finishing. If unsure, remove it.
- **Incomplete work ships dark.** Use feature flags (`<SVC>_FEATURES` / `<SVC>_FEATURE_<NAME>`) instead of long-lived branches. Merge code to `master` behind a flag, flip it later.
- **Destructive changes keep both paths.** Replace behavior behind a flag; keep the old path working. Remove dead code + flag in a follow-up.
- **Migrations and infra are the exception.** These cannot be feature-flagged: test against shared DB in a worktree, merge to `master` only when verified.

Violating any of these is how a box becomes unusable for everyone. When in doubt, stop and create a worktree.

### Example: onboarding loom (docs/articles/notes frontend, 2026-11-09)

loom is a multi-tenant TanStack Start frontend for docs, articles, and private
notes. It was onboarded WITHOUT SSH or kubectl, using the ApplicationSet pattern:

1. **Image + chart published** via `bin/publish` on dev-mf (docker build + push
   to GHCR, helm package + push to OCI registry, digest stamped in values.yaml).
2. **Argo Application auto-created** by committing `apps/loom.yaml` to the
   `anywaye/argo-apps` repo. The `anywaye-services` ApplicationSet watches
   `apps/*.yaml` and auto-generates an Argo Application for each file. No
   `kubectl apply` needed — just `git commit && git push`.
3. **Argo sync** triggered via the ops MCP (`ops_argocd_sync`) or auto-sync
   (the ApplicationSet sets `automated: { prune: true, selfHeal: true }`).
4. **Config/env changes** — edit `deploy/argocd-application.yaml` or the
   `apps/loom.yaml` in argo-apps, commit, push. Auto-syncs.
5. **Secrets** — the loom frontend uses `PRESS_URL` and `IDENTITY_URL` which
   point to internal cluster services. No secrets needed in the chart values.

**The key insight:** the ApplicationSet git generator is the automated path.
Instead of `kubectl apply -f deploy/argocd-application.yaml` (which needs SSH),
commit an `apps/<name>.yaml` to `anywaye/argo-apps` and ArgoCD auto-creates
the Application. This is the "no SSH" onboarding path.

**App definition format** (`apps/loom.yaml`):
```yaml
name: loom
repoURL: oci://ghcr.io/anywaye/charts/loom
chart: loom
targetRevision: "0.1.12"
namespace: loom
values: |
  env:
    IDENTITY_URL: "http://identity.identity.svc.cluster.local:8080"
    PRESS_URL: "http://press.press.svc.cluster.local:8080"
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://alloy.observability:4318"
    OTEL_SERVICE_NAME: "loom"
  ingress:
    hosts:
      - boax.dev
      - anywaye.com
    tls: true
```

**Ops MCP tools for deployment (no SSH needed):**
- `ops_argocd_apps` — list all Argo CD applications and their sync/health status
- `ops_argocd_app` — get a specific application's status
- `ops_argocd_sync` — trigger a sync of an existing application
- `ops_pods` — list pods in a namespace
- `ops_pod_logs` — read pod logs
- `ops_events` — list Kubernetes events
- `ops_restart_deployment` — restart a deployment
- `ops_db_query` — run read-only SQL queries

**Cloudflare (no SSH needed):**
- `mcp__cloudflare__execute` — create R2 buckets, API tokens, etc.
- `mcp__cloudflare-bindings__r2_bucket_create` — create R2 buckets
- `mcp__cloudflare-bindings__r2_buckets_list` — list R2 buckets

**Publishing (requires SSH to dev-mf for docker/helm):**
- `bin/publish` on dev-mf — builds Docker image, pushes to GHCR, packages
  chart, pushes to OCI registry, stamps image digest in values.yaml.
- This is the one step that needs SSH (docker build on dev-mf).
- After publish, the ApplicationSet or ArgoCD sync handles deployment.

**What needs SSH (and why):**
- `bin/publish` (docker build + push) — needs docker on dev-mf
- `bin/prime` (quality gate) — runs locally on dev-mf
- Editing code in worktrees — on dev-mf filesystem
- Running migrations — `bin/migrate` on dev-mf (needs Postgres access)

**What does NOT need SSH:**
- Creating ArgoCD applications (via ApplicationSet + git push)
- Syncing applications (via ops MCP or auto-sync)
- Checking pod status/logs (via ops MCP)
- Creating R2 buckets/tokens (via Cloudflare MCP)
- Config/env changes (via git push to argo-apps repo)
- Database queries (via ops_db_query)
