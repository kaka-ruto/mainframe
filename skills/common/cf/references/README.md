# cf CLI Reference

Cloudflare's unified CLI — covers the whole Cloudflare API from one binary.

## What is cf?

`cf` is Cloudflare's new command-line tool for the entire Cloudflare API. Every command is generated from Cloudflare's OpenAPI schemas by **Forge**, Cloudflare's open-source API generation pipeline. That replaces Wrangler's ~280 hand-built, product-by-product commands with **3000+ generated operations**, consistent in naming, flags, and output.

Version verified against the installed binary: **v1.0.0-beta.5** (open beta). Open source: <https://github.com/cloudflare/cf>. Launch post: <https://blog.cloudflare.com/cloudflare-cf-cli-launch/>

Three design choices make it agent-friendly:

- **JSON is the default.** Pretty-printed for humans, condensed for agents. Never append `--json`; never reach for `jq` just to read a table.
- **Interactive prompts only where real personal input is needed** — e.g. buying a domain. Everything else is a named parameter you can fill in a form.
- **Discovery is a first-class command.** `cf cli search` answers natural-language intent.

## Installation

```bash
npm i -g cf
```

| Item | Value |
|------|-------|
| Package | `cf` |
| Binary aliases | `cf`, `cloudflare` |
| Config import path | `cf/config` |
| Config package | `@cloudflare/config` |
| Engine (`package.json`) | `node >=22` |
| **Engine for `cloudflare.config.ts`** | **Node >= 22.18.0** (verified — see gotchas.md) |
| Latest version checked | `1.0.0-beta.5` |

Install locally per-project with `npm i -D cf` when a repo should pin the version. `cf migrate --no-install` skips adding the dependency.

## Reading Order

| If you want to... | Start here |
|-------------------|------------|
| Install and get oriented | This page → [patterns.md](./patterns.md) §New Worker |
| Write or edit `cloudflare.config.ts` | [configuration.md](./configuration.md) |
| Wire up CI/CD | [patterns.md](./patterns.md) §CI/CD |
| Convert a Wrangler project | [patterns.md](./patterns.md) §Migrating from Wrangler |
| Deploy a static site | **[gotchas.md](./gotchas.md) §Build Output Specification** — read this first |
| Debug a failed command | [gotchas.md](./gotchas.md) |
| Look up a flag or command path | [api.md](./api.md) |

## Command Discovery

```bash
cf cli search "<describe the task you want to accomplish>"
```

Returns five JSON matches with short descriptions. Pick the best match rather than repeating similar searches. Verified:

```bash
$ cf cli search "create a kv namespace"
[
  { "command": "cf kv namespaces create", "summary": "Create a namespace" },
  { "command": "cf ai-search namespace create", "summary": "Create a namespace" },
  { "command": "cf agent-memory create-namespace", "summary": "Create a namespace" },
  { "command": "cf kv namespaces get", "summary": "Get a namespace" },
  { "command": "cf kv namespaces update", "summary": "Rename a namespace" }
]
```

Note the plural `namespaces` — `cf kv namespace create` does **not** exist and `cf schema` will say so:

```
$ cf schema kv namespace create
Schema not found for "kv namespace create". Use --list to see available schemas.
```

**Search queries must stay anonymous.** Describe the action and resource type only. Never include names, email addresses, domains, account or resource IDs, tokens, or other identifying values.

Three more discovery surfaces:

```bash
cf <command> --help        # detailed help for a discovered command
cf schema <command path>   # HTTP method, API path, request/response body fields
cf schema --list           # every operation with its httpMethod + apiPath
```

`cf schema --list` is the ground truth for whether an operation is wrapped at all. It enumerated **2889** commands in v1.0.0-beta.5.

Telemetry:

```bash
cf cli telemetry status     # Verified: prints "Status: Enabled"
cf cli telemetry disable
cf cli telemetry enable
```

Honored env vars (verified from `cf cli telemetry status`): `CF_SEND_TELEMETRY=true|false`, and `DO_NOT_TRACK`.

## cf vs Wrangler

`cf` is the successor and will become the default. Wrangler is not dead in the same commit — `cf` **delegates** to it.

| | Use `cf` | Use `wrangler` |
|---|---|---|
| Command coverage | Whole Cloudflare API, 3000+ generated ops | ~280 hand-built commands |
| Config format | `cloudflare.config.ts` (`defineConfig`) | `wrangler.toml` / `wrangler.jsonc` |
| Top-level groups | 80 (verified) | 43 (verified) |
| Local dev default | Vite plugin | esbuild |
| Static assets | Workers assets via Build Output | `assets.directory` |
| Pages | `cf deploy` → Pages on Workers | Legacy Pages (`cf pages deploy` refuses) |
| esbuild / Rust / Python Workers | Delegates to Wrangler for the build | Native |
| Vitest pool | `@cloudflare/vitest-pool-workers` | Same, configured via `wrangler` key |

**Migration policy (from the launch post):** Workers already building with Vite convert automatically via `cf migrate`. esbuild/Rust/Python Workers keep delegating builds to Wrangler. When the open beta ends, a final major Wrangler release will direct users to `cf`, and Wrangler receives **18 months of maintenance support** from that point.

Practical rule: use `cf` for the CLI surface and `cloudflare.config.ts`; keep `wrangler` in the manifest as the dev server when the project isn't on Vite yet.

## Essential Commands

### Lifecycle

```bash
cf init [directory]         # Scaffold new, or autoconfigure existing
cf dev                     # Run the project's Cloudflare dev server
cf build                   # Build a project for Cloudflare
cf deploy                  # Deploy a project to Cloudflare
cf migrate [path]          # Migrate a Wrangler project to cf
```

### Deploy

```bash
cf deploy --dry-run            # Validate without authenticating or uploading
cf deploy --prebuilt           # Ship an existing Build Output Specification
cf deploy --tag v1.2.0 --message "release notes"
cf deploy --secrets-file .secrets.json
cf deploy --containers-rollout immediate   # choices: immediate | gradual | none
```

### Authentication

```bash
cf auth login              # OAuth
cf auth whoami             # Current user + auth status (JSON)
cf auth logout
cf auth list               # Named profiles
cf auth create <name>
cf auth activate <name> [dir]   # Bind a profile to a directory
cf auth deactivate [dir]
cf auth delete <name>
```

Use `--profile <name>` on any command, or set `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` for CI. Details → [api.md](./api.md) §Authentication.

### Type Generation

```bash
cf workers types                    # → .cloudflare/types/index.d.ts
cf workers types --include-runtime false
```

Verified: `cf workers types` prints `{ "path": ".cloudflare/types/index.d.ts" }`. Types are also regenerated automatically during a build — verified log line `📝 Regenerated .cloudflare/types/index.d.ts from cloudflare.config.ts.`

## Project Scaffolds

`cf init` on a directory with no Cloudflare config installs the Cloudflare Vite Plugin and writes `cloudflare.config.ts`. Running `cf deploy` on a project with no Cloudflare config produces a migration scaffold adding:

- `cf` and `wrangler` as devDependencies
- a `"deploy": "cf deploy"` script
- `cloudflare.config.ts`
- a `wrangler.config.ts` bridge containing `defineWranglerConfig({ assetsDirectory: "dist" })`

## Dev Server Implementations

`cf dev`, `cf build`, and `cf deploy` need exactly one dev server declared in the project manifest. Verified from the binary's own error text:

| Package | Manifest | Version constraint | Notes |
|---------|---------|--------------------|-------|
| `@cloudflare/vite-plugin` | `package.json` | `>=2.0.0-0 <3.0.0-0` | **Recommended**, Vite is the default |
| `wrangler` | `package.json` | `>=4.136.0` | Legacy Worker projects; cf delegates |
| `cloudflare-py-dev-server` | `pyproject.toml` | — | Python, Pyodide via workerd |
| `cloudflare-rs-dev-server` | `Cargo.toml` | — | Rust, wasm-bindgen + workerd |

Missing all four produces:

```
No Cloudflare dev-server is installed in this project.

A project must declare exactly one of the following in its manifest:

  @cloudflare/vite-plugin  (Vite-based dev server (recommended for JavaScript/TypeScript))
    install:  npm install --save-dev @cloudflare/vite-plugin@beta
  wrangler  (Wrangler-based dev server (legacy Worker projects))
    install:  npm install --save-dev wrangler@latest
  cloudflare-py-dev-server  (Python dev server (Pyodide via workerd))
    install:  pip install cloudflare-py-dev-server   (or: uv add --dev cloudflare-py-dev-server)
  cloudflare-rs-dev-server  (Rust dev server (wasm-bindgen + workerd))
    install:  cargo install cloudflare-rs-dev-server
```

`cf dev` runs the framework's own dev command when available and falls back to an installed Cloudflare dev server. Only `--mode` is forwarded to framework dev servers; other arguments go only to Cloudflare dev-server implementations.

## Quick Decision Tree

```
Starting something new?
├─ New Worker project → cf init
├─ Existing project, no Cloudflare config → cf deploy (autoconfigures)
└─ Wrangler project → cf migrate

Deploying?
├─ Node Worker on Vite → cf deploy
├─ Legacy Pages site → wrangler pages deploy   (cf pages deploy refuses)
├─ Static site on a recognised framework → gotchas.md §Build Output Specification FIRST
└─ esbuild / Rust / Python Worker → cf deploy (delegates to Wrangler)

Writing config?
├─ Bindings → configuration.md §bindings
├─ Routes, queues, cron, email → configuration.md §triggers
├─ Multiple environments → configuration.md §Factories and mode
└─ Static assets → configuration.md §Assets

Something failed?
├─ "no root config found" → gotchas.md §Build Output Specification
├─ "requires Node.js v22.18.0" → gotchas.md §Node version
├─ "Unrecognized key: directory" → gotchas.md §assets.directory
├─ Legacy Pages refused → gotchas.md §Legacy Pages
├─ 403 / 10405 on deploy or domain → gotchas.md §Token permissions
└─ No dev-server installed → this page §Dev Server Implementations
```

## See Also

- [configuration.md](./configuration.md) - `cloudflare.config.ts` surface, bindings, triggers, Build Output layout
- [api.md](./api.md) - Global flags, full command surface, auth, schema tools
- [patterns.md](./patterns.md) - Recipes: CI, migration, static sites, multi-env, secrets
- [gotchas.md](./gotchas.md) - Build Output gotcha, Node version, Pages, domains, tokens
- [wrangler skill](../wrangler/SKILL.md) - Wrangler CLI reference (delegated build engine)
