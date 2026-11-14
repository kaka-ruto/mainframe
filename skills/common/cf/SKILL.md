---
name: cf
description: Cloudflare's new unified CLI covering the whole Cloudflare API (3000+ generated operations) with TypeScript config via cloudflare.config.ts, replacing Wrangler as the successor toolchain. Load for "cf deploy", "cf migrate", "cf init", cloudflare.config.ts, deploying Workers or static sites from CI, managing any Cloudflare resource from the command line, and choosing between cf and wrangler. Biases towards retrieval from the installed CLI's own --help, cf cli search, and cf schema output over pre-trained knowledge.
---

# cf CLI

`cf` is Cloudflare's successor to Wrangler. Your knowledge of its flags, config helpers, and command paths is almost certainly wrong — it is an **open beta** (`v1.0.0-beta.5` at time of writing), generated from Cloudflare's OpenAPI schemas, and almost none of it exists in training data. **Prefer retrieval over pre-training** for every `cf` task.

## Retrieval Sources

The installed binary is the most authoritative source. Run these before writing any `cf` command.

| Source | How to retrieve | Use for |
|--------|----------------|---------|
| Command discovery | `cf cli search "<what you want to do>"` | Finding the right command path without guessing |
| Command help | `cf <command> --help` | Flags, positionals, defaults, choices |
| API schema | `cf schema <command path>` | HTTP method, API path, request body fields |
| Operation inventory | `cf schema --list` | Confirming an operation exists at all |
| Config type surface | `node_modules/@cloudflare/config/dist/*.d.mts` | `defineConfig`, `bindings.*`, `triggers.*` shapes |
| Launch post | `https://blog.cloudflare.com/cloudflare-cf-cli-launch/` | Design intent, roadmap, Wrangler timeline |
| Source | `https://github.com/cloudflare/cf` | Issues, telemetry docs, changelog |

`cf --help` prints an **AGENT COMMAND DISCOVERY** banner telling you to use `cf cli search` rather than chaining nested `--help` calls. Follow it. Keep search queries anonymous: describe the action and resource type only, never names, emails, domains, IDs, or tokens.

## FIRST: check `cf` is installed

```bash
cf --version   # expect: 🍊☁️  cf · v1.0.0-beta.5
```

If missing:

```bash
npm i -g cf
```

Binary aliases: `cf` and `cloudflare`.

## The gotcha that will bite you first

**For a static site whose framework `cf` recognises, `cf build` and `cf deploy` detect the framework, run its own build command, then require a [Build Output Specification](https://developers.cloudflare.com/workers/builds/build-output-configuration/) at `.cloudflare/output/v0/config.json`. A plain framework build never writes that file, so the deploy fails with:**

```
Build Output Specification: no root config found at .../.cloudflare/output/v0/config.json
```

`cf` reads **neither** `package.json`'s `build` script **nor** `build.command` in `wrangler.config.ts` for this decision — it uses its own hardcoded framework registry (e.g. Astro is `{ command: 'astro build', directory: 'dist' }`, which emits `dist/` but no Build Output Specification).

**Working path today:** emit the spec explicitly, then deploy prebuilt:

```bash
wrangler build --experimental-new-config --experimental-cf-build-output   # pin wrangler to an exact version
cf deploy --prebuilt
```

Full diagnosis, the Build Output file layout, and the Astro adapter clarification are in [references/gotchas.md](./references/gotchas.md). Read it before any static-site deploy.

## cf vs wrangler

| | Use `cf` | Use `wrangler` |
|---|---|---|
| Coverage | Whole Cloudflare API, 3000+ generated ops | ~280 hand-built commands |
| Config | `cloudflare.config.ts` (`defineConfig`) | `wrangler.toml` / `wrangler.jsonc` |
| Local dev | Vite plugin by default | esbuild-based |
| Pages | `cf deploy` (Pages on Workers) | Legacy Pages still live |
| Roles | Front door, eventual default | Delegated build engine for esbuild/Rust/Python Workers |

`cf` **delegates** to Wrangler when a project's dev server is Wrangler-based. They coexist; they do not compete. Choosing between them per task → [references/README.md](./references/README.md) §cf vs Wrangler.

## Lifecycle

```bash
cf init [directory]   # scaffold; also autoconfigs existing projects
cf dev                # run the project's dev server
cf build              # build for Cloudflare
cf deploy             # build + deploy
cf migrate [path]     # convert a Wrangler project to cloudflare.config.ts
```

`cf deploy` options (all verified in `cf deploy --help`): `--prebuilt`, `--dry-run`, `--tag`, `--message`, `--secrets-file`, `--worker`, `--dispatch-namespace`, `--containers-rollout`.

## Routing

| If you need to... | Go to |
|-------------------|-------|
| Orient, install, decide cf vs wrangler | [references/README.md](./references/README.md) |
| `cloudflare.config.ts`, `bindings.*`, `triggers.*`, Build Output layout | [references/configuration.md](./references/configuration.md) |
| CI/CD, migration, static sites, multi-env, secrets recipes | [references/patterns.md](./references/patterns.md) |
| The BOS failure, Node version, Pages refusal, domains, token scope | [references/gotchas.md](./references/gotchas.md) |
| Full command/flag/global-flag/auth surface | [references/api.md](./references/api.md) |

## Non-negotiables

- **`cf deploy --dry-run` validates output without authenticating.** Use it to verify locally before spending a deploy.
- **Node >= 22.18.0 is required to load `cloudflare.config.ts`.** Older Node fails with `cloudflare.config.ts loading requires Node.js v22.18.0 or higher.` Check `node --version` before debugging anything else.
- **`cf deploy` requires a dev-server implementation declared in the project manifest** — `@cloudflare/vite-plugin` (recommended) or `wrangler` (legacy). Python/Rust use separate packages.
- **JSON is the default output.** Do not append `--json`; do not pipe through `jq` to make sense of it.
- **Legacy Pages is refused** by `cf pages deploy`. Use `cf deploy`.
- **CI authenticates with `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`.** Deploys need **Workers Scripts:Edit**.
