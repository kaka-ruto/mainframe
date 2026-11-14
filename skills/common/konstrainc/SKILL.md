---
name: konstrainc
description: Use when developing Kawibot / konstrainc projects (kawibot, core, site, desktop, data-engine) on the dev-mf VPS. Covers repo layout, Ruby/Node/Python toolchains, the shared PostgreSQL cluster, env files, commands, and known test-suite caveats.
---

# Konstrainc / Kawibot development on dev-mf

The konstrainc repos live on the `dev-mf` VPS (Contabo, Ubuntu 24.04, 4 vCPU /
7.8 GB RAM), alongside the anywaye stack. SSH is allowed to dev-mf only; SSH to
production VPSes is prohibited without explicit written founder approval (same
policy as the dev-mf and app-mf skills).

## Layout

- Canonical repos: `/code/konstrainc/<repo>`
  - `kawibot` — Rails 8.1 app (the main product)
  - `core` — TypeScript package
  - `site` — Vite/TanStack site
  - `desktop` — Electron app
  - `data-engine` — Python FastAPI service
- Worktrees: `/code/konstrainc/worktrees/<repo>-<task>`
- Canonical repos must stay on `master`, clean. Work in a worktree, then merge.
- The Mac workspace `/Users/kaka/Code/Kawibot` has no local copies of the
  migrated repos — only `README.md` and the non-migrated repos. Never create a
  local clone; use dev-mf.

## Toolchains (installed 2026-11-13)

| Tool | Version / location |
|---|---|
| Ruby | 4.0.1 via mise (`~/.local/share/mise/installs/ruby/4.0.1`), symlinked into `/usr/local/bin` |
| Bundler | 4.0.18 |
| Overmind | 2.5.1 (`/usr/local/bin/overmind`), tmux 3.4 |
| Node | 22.23.4 + npm 10.9.9 (system) |
| Python | 3.12.3 (system) + per-repo `.venv` |
| PostgreSQL client | 16.15 (matches the running server) |
| libvips | 8.15.1 |
| ImageMagick | 6.9.12 |
| poppler / tesseract | poppler-utils 24.02, tesseract 5.3.4 |

Ruby binaries are on the default PATH (`/usr/local/bin`), so `ruby`, `bundle`,
and `gem` work in non-interactive SSH commands.

## PostgreSQL (shared host cluster)

The existing **PostgreSQL 16.15** cluster on `127.0.0.1:5432` is shared with the
anywaye `identity` and `press` databases. Never stop, drop, or recreate the
cluster, and never change the port.

- `pg_hba.conf` has loopback `trust` entries for the `postgres` role
  (`127.0.0.1/32` and `::1/128`), added 2026-11-13. The cluster listens on
  loopback only. Connect as `postgres` with no password.
- Kawibot dev databases: `kawibot_development`, `kawibot_development_queue`,
  `kawibot_development_cache`, `kawibot_development_cable`.
  Test database: `kawibot_test` (parallel test workers create `kawibot_test_0..3`).
- data-engine databases: `data_engine_development`, `data_engine_test`.
- Production runs PostgreSQL 17.4. Dev runs 16.15. Kawibot uses `db/schema.rb`
  and currently has no PostgreSQL-17-only schema features; verify migrations
  against Pg 16 before relying on Pg-17-specific SQL.

## Environment

- `~/.env.konstra` (mode 600) contains:
  - `PATH` including `~/.local/bin` (mise)
  - `DATABASE_URL` / `TEST_DATABASE_URL` for data-engine, pointed at the local
    `postgres` role.
  Source it before data-engine commands: `source ~/.env.konstra`.
- `~/.env` holds `GH_TOKEN`. `gh` is logged in, `gh auth setup-git` is
  configured, and git rewrites GitHub SSH URLs to HTTPS:
  `url.https://github.com/.insteadOf = ssh://git@github.com/`.
- Kawibot development credentials: `config/credentials/development.key` (mode
  600, untracked). The test key is tracked in the repo.
- **Never copy `.kamal/secrets`, production credentials, or production keys to
  this box.** Do not deploy Kawibot with Kamal from dev-mf.

## Kawibot

Already provisioned: gems installed, `bin/rails db:prepare` seeded the dev DBs.

```sh
cd /code/konstrainc/kawibot

bin/dev                      # Overmind: Rails on 3001 + bin/jobs
curl localhost:3001/up       # health check
bin/rails test               # full Minitest suite
bin/brakeman --no-pager      # security scan
bin/rubocop                  # style
bundle exec ruby "$(bundle show erb_lint)/exe/erb_lint" --lint-all
```

Notes:

- `bin/dev` starts on port 3001 and increments if busy. It is localhost-only;
  use an SSH tunnel (`ssh -L 3001:localhost:3001 dev-mf`) from the Mac.
- `bundle exec erb_lint` is broken on this Ruby/Bundler combo ("command not
  found") even though the gem is installed. Use the `bundle exec ruby
  "$(bundle show erb_lint)/exe/erb_lint"` form above.
- `watchman` is not installed; Tailwind prints a harmless "watchman: not found"
  warning.
- System tests need headless Chrome, which is not installed. Run the normal
  Minitest suite; install Chrome first if system tests are required.
- Running the test suite can modify `Gemfile.lock` (brakeman bump) and VCR
  cassettes. Check `git status` and restore unwanted changes with
  `git checkout -- <file>` before committing. Never commit freshly recorded
  cassettes or secrets.

### Known pre-existing test failures on `master` (as of 2026-11-13)

The full suite is 1054 runs, with 1 failure and 17 errors:

- AI live/eval tests (`test/integration/kawifiles/agent_live_test.rb`,
  `requirements_gathering_test.rb`, `eval_test.rb`, parts of `edge_cases_test.rb`)
  fail because the `commandcode` provider key is absent and the VCR cassettes
  were recorded against `api.commandcode.ai` while the code now calls
  `opencode.ai`. These are test-suite debt, not an environment problem.
- `Kawifiles::MessagesControllerTest#test_does_not-re-render_the_user_message_when_reprocessing_an_existing_one`
  fails with `Expected: 1, Actual: 2`, including when run alone.
- For a clean environment check, run the non-AI test files or accept these
  known failures.

## core / site / desktop (Node)

```sh
cd /code/konstrainc/core
npm ci && npm run verify            # typecheck + build + schema + node --test

cd /code/konstrainc/site
npm ci && npm run typecheck && npm run build

cd /code/konstrainc/desktop
npm ci && npm run typecheck && npm test
```

All three passed on 2026-11-13. Notes:

- `desktop` depends on `konstrainc/core` via an SSH git URL; the global
  `insteadOf` rewrite + `gh` credential helper makes `npm ci` work. If it fails
  with `Permission denied (publickey)`, re-check the git URL rewrite.
- Desktop unit tests run headless. Electron GUI and installer builds need a
  display; do not run them over plain SSH.
- `site` reads `SITE_URL` from the environment for absolute URLs; builds work
  without it.

## data-engine (Python)

```sh
cd /code/konstrainc/data-engine
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
.venv/bin/pip install cryptography      # required by tests/conftest.py, not in requirements

PGUSER=postgres .venv/bin/python bin/postgres-cluster   # idempotent DB provisioning
source ~/.env.konstra
bin/test                                                # pytest unit + integration
```

`bin/test` activates `.venv` and uses `TEST_DATABASE_URL` from `~/.env.konstra`.

Known pre-existing failures on `master` (as of 2026-11-13): 613 passed, 4
failed in `tests/unit/test_auth_boundary.py` and
`tests/unit/test_docs_production_gate.py` — route discovery returns an empty
route set, so the auth-boundary guards fail. Not an environment problem.

## Git workflow (direct-to-master, no PRs)

Kawibot uses a direct-to-master flow on this box (founder's choice):

```sh
cd /code/konstrainc/<repo>
git worktree add /code/konstrainc/worktrees/<repo>-<task> -b <task-branch>
cd /code/konstrainc/worktrees/<repo>-<task>
# work + run the gate
cd /code/konstrainc/<repo>
git checkout master
git merge --no-ff <task-branch> -m "merge: <task summary>"
git push origin master
git worktree remove /code/konstrainc/worktrees/<repo>-<task>
git branch -d <task-branch>
git worktree prune
```

- No PRs. The local gate is the quality check.
- GitHub Actions CI is configured for pull requests only; direct pushes to
  `master` do not run it.
- If GitHub rejects a direct push because of branch protection, stop and fall
  back to a branch + PR via `gh`; do not force-push `master`.
- One worktree per task; remove it, its branch, and temp artifacts when done or
  abandoned. Keep `/code/konstrainc/<repo>` on `master` and clean.

## Quick verification

```sh
ruby -v                     # 4.0.1
bundle -v                   # 4.0.18
node -v                     # v22.23.4
psql "postgres://postgres:@localhost:5432/postgres" -tAc 'select 1'
curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/up   # with bin/dev running
```
