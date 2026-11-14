# cf Gotchas

Known failures and workarounds. Each is labelled with how it was established.

- **[verified]** — reproduced against the installed `cf v1.0.0-beta.5` during authoring
- **[reported]** — hands-on finding supplied by the author of this skill, not independently re-run here
- **[docs]** — stated in Cloudflare's launch post or docs, not re-executed here

---

## Build Output Specification — the one that will cost you an hour

**[verified message + root cause]** · **[reported] symptoms and workaround**

For a static site whose framework `cf` recognises, `cf build` and `cf deploy`:

1. detect the framework from the project manifest,
2. run **its own** build command from an internal framework registry, and
3. then require a [Build Output Specification](https://developers.cloudflare.com/workers/builds/build-output-configuration/) at `.cloudflare/output/v0/config.json`.

A plain framework build never writes that file, so the deploy fails:

```
Build Output Specification: no root config found at .../.cloudflare/output/v0/config.json
```

### Why it happens

`cf` does **not** read `package.json`'s `build` script, and does **not** read `build.command` in `wrangler.config.ts`, to decide how to build. It uses a hardcoded framework registry. The Astro entry, verified in the shipped bundle, is:

```js
{ npmDependencies: [`astro`], category: SSG, staticAssetsDirectory: `public`,
  dev:   { port: 4321, command: `astro dev`, pollingStrategies: [{ name: `TCP` }] },
  build: { command: `astro build`, directory: `dist` } }
```

`astro build` writes `dist/` and nothing else. There is no configuration surface in v1.0.0-beta.5 to override that registry entry.

### Why `cf deploy` on a static site looked like it should work

The launch post states: *"Static sites still don't require a configuration file to start, and deploying them is as simple as running `cf deploy` in your project."* That is true for the happy path only. The gap is that the registry's `build.command` has no output-spec emission step.

### Workaround that works today

```bash
npm i -D --save-exact wrangler     # exact version — the flags below are experimental
npx wrangler build --experimental-new-config --experimental-cf-build-output
cf deploy --prebuilt
```

Pin Wrangler to an **exact** version. `--experimental-new-config` and `--experimental-cf-build-output` are undocumented and absent from `wrangler build --help`, so they can be removed in any release.

Constraints on this path:

- Requires `cloudflare.config.ts`, which requires **Node >= 22.18.0** (see below).
- `--experimental-new-config` alone errors with `cloudflare.config.ts is required when --experimental-new-config is enabled.`
- `cf deploy --prebuilt` skips building entirely and ships whatever is in `.cloudflare/output/v0/`.

### Astro needs no adapter

**[reported]**, corroborated by Cloudflare's own Astro guide: a fully pre-rendered Astro site does **not** need `@astrojs/cloudflare`. Adding the adapter switches the project to `output: 'server'` — the opposite of what a static deploy wants. Cloudflare's docs still document `astro build` + `wrangler deploy` as the manual static path.

### Output layout

Root config holds **only** `buildContext` (optionally `accountId` / `complianceRegion`). Worker identity lives in the per-worker config, never the root. Verified from a real build:

```
.cloudflare/output/v0/config.json
  { "buildContext": { "isPreview": false } }

.cloudflare/output/v0/workers/default/worker.config.json
  { "name": "t", "compatibilityDate": "2026-01-01",
    "triggers": [{ "type": "scheduled", "schedule": "0 * * * *" }],
    "env": { "GREETING": { "type": "text", "value": "hello" }, "MY_KV": { "type": "kv" } },
    "manifest": { "type": "complete", "mainModule": "index.js",
                  "modules": { "index.js": { "type": "esm" } } } }

.cloudflare/output/v0/workers/default/bundle/index.js
.cloudflare/output/v0/workers/default/assets/     (when the project has static files)
```

If you are hand-writing or post-processing a Build Output Specification, that split is the thing to get right.

### Cheap insurance

```bash
cf deploy --dry-run
```

Validates the output without authenticating and without uploading. Verified.

---

## Node version

**[verified]**

```
Error: cloudflare.config.ts loading requires Node.js v22.18.0 or higher.
    at registerConfigHooks (node_modules/wrangler/wrangler-dist/cli.js:...)
```

`cloudflare.config.ts` is loaded via Node's TypeScript config hooks. The gate is enforced by the **Wrangler** dev server that `cf` invokes, which is why the stack trace points into `wrangler-dist/cli.js`.

Two traps:

1. The `cf` package itself only declares `engines.node: ">=22"`. The 22.18.0 requirement is stricter and only surfaces at config-load time.
2. **A globally installed `cf` runs on whatever Node it was installed under.** Upgrading your project's `.nvmrc` does not help if the `cf` binary itself is bound to an older Node — `cf workers types` kept failing until `cf` was invoked with a newer Node directly. Check `which cf` and the Node backing it.

## `assets.directory` is both required and rejected

**[verified]**

`worker.assets.directory` is demanded by the underlying Wrangler config loader but rejected by the `cf/config` validator. The two errors are mutually exclusive:

| Config | Error |
|--------|-------|
| `assets: { notFoundHandling: "single-page-application" }` | ``The `assets` property in your configuration is missing the required `directory` property.`` |
| `assets: { directory: "./dist", notFoundHandling: "..." }` | ``✖ Unrecognized key: "directory" → at worker.assets`` |

**Workaround:** omit `worker.assets` and let the dev server supply the directory — the `wrangler.config.ts` bridge (`defineWranglerConfig({ assetsDirectory: "dist" })`) or the Vite plugin's own output. Omitting it produced a valid Build Output Specification in testing. Note `bindings.assets()` takes **no arguments** in v1.0.0-beta.5.

## Validation errors point at the wrong nesting level

**[verified]**

`name` and `compatibilityDate` are only valid inside `worker`. At the root:

```
✖ Unrecognized keys: "name", "compatibilityDate"
```

Likewise `env` is the **bindings** map, not an environment block — `worker.env.MY_KV`, not `worker.bindings`. And `bindings.text(...)` takes a **bare string**, not an object:

```
✖ Invalid input: expected string, received object
  → at worker.env.GREETING.value
```

Worked example that validates clean:

```typescript
import { defineConfig, bindings, triggers } from "cf/config";

export default defineConfig({
  worker: {
    name: "t",
    compatibilityDate: "2026-01-01",
    entrypoint: "./src/index.ts",
    env: {
      GREETING: bindings.text("hello"),
      MY_KV: bindings.kv(),
    },
    triggers: [triggers.scheduled({ schedule: "0 * * * *" })],
  },
});
```

## Legacy Pages is refused

**[verified]**

```
$ cf pages deploy ./dist
Legacy Pages is not supported in `cf`. To deploy to the new version of Pages on Workers, use `cf deploy` instead.
```

Exit code 1. The `cf pages deploy` command exists and takes a positional `directory`, but refuses every invocation. Note its own help text describes the argument as *"Pages build output directory (not deployed by cf)"*.

Legacy Pages projects keep working through Wrangler: `wrangler pages deploy`. New Pages work goes through `cf deploy` to Pages on Workers.

## No dev-server installed

**[verified]**

`cf dev`, `cf build`, and `cf deploy` all require a dev-server implementation declared in the project manifest (`package.json` | `pyproject.toml` | `Cargo.toml`):

```
No Cloudflare dev-server is installed in this project.
```

The binary's own error lists the four options and their install commands. Constraints pulled from the shipped bundle: `@cloudflare/vite-plugin` requires `>=2.0.0-0 <3.0.0-0` (the v2 beta line); `wrangler` requires `>=4.136.0`. `cloudflare-py-dev-server` and `cloudflare-rs-dev-server` are separate packages, not npm dependencies.

## Token permissions

**[reported]** · **[verified]** that deploy needs more than a Pages token

| Operation | Requirement | Failure |
|-----------|-------------|---------|
| `cf deploy` | **Workers Scripts:Edit** | Pages-only token → `403 No access to the specified resource` |
| Worker custom domains | Broader than Workers Scripts:Edit | Narrow token → `10405 Method not allowed for this authentication scheme` even with Workers Scripts:Edit present |

Domain management may need a broader token or the dashboard. Prefer `worker.domains` in `cloudflare.config.ts` over hand-rolled API calls so permissions travel with the config.

## Worker custom domains and CNAME records

**[reported]**

A Worker custom domain cannot be attached while the hostname still has a CNAME record — typically one left behind by a Pages custom domain that was never detached. Sequence:

1. Detach the hostname from the Pages project (`cf pages projects domains list`, then delete the binding).
2. Delete the leftover CNAME record.
3. Attach the domain to the Worker.

The API path is `PUT /accounts/{account_id}/workers/domains` with body `{ zone_id, hostname, service, environment }`.

**[verified] caveat:** this endpoint has **no generated `cf` command in v1.0.0-beta.5**. `cf schema --list` contains no `/workers/domains` operation and `cf workers` has no `domains` subcommand. Use `worker.domains: string[]` in `cloudflare.config.ts`, or call the API directly.

## `cf schema` needs the exact plural command path

**[verified]**

```
$ cf schema kv namespace create
Schema not found for "kv namespace create". Use --list to see available schemas.
```

The path segments are generated from the API, so nouns are plural and inconsistent-looking. Always copy the path verbatim from `cf cli search` or `cf schema --list`:

```bash
$ cf cli search "create a kv namespace"
cf kv namespaces create          # ← plural
```

`cf schema <path>` output includes `httpMethod`, `apiPath`, `operationId`, and a `requestBodyFields` array with per-field `type`, `required`, and `description`.

## There is no `cf@beta` dist-tag

**[verified]**

```
npm error notarget a package version that doesn't exist.
```

The open beta is versioned, not tagged. Install an exact version: `npm i -D cf@1.0.0-beta.5`. This is also what `cf migrate --install` does — it pins rather than floats.

## Counts differ from the launch post

**[verified]**

The launch post advertises *"over 3,000 operations."* In v1.0.0-beta.5, `cf schema --list` enumerates **2889** commands across **80** top-level groups (Wrangler: ~43 top-level groups, ~280 command paths). Treat 3000+ as the platform-wide target, not a count you can assert against this build.

## Do not chase tables

**[docs]** JSON is the default output, condensed for agents. Do not append `--json`, and do not pipe through `jq` to read a table that does not exist. Interactive prompts appear only where genuine personal input is required (e.g. buying a domain).

Keep `cf cli search` queries anonymous — no names, emails, domains, IDs, or tokens.

## Telemetry is on by default

**[verified]**

`cf cli telemetry status` printed `Status: Enabled`. Opt out with `cf cli telemetry disable`, `CF_SEND_TELEMETRY=false`, or `DO_NOT_TRACK`.

## Migration timeline

**[docs]** When the open beta ends, Cloudflare will release a final major Wrangler version that directs users to `cf`. Wrangler receives **18 months of maintenance support** from that point. Do not build automation that depends on Wrangler's behaviour changing in your favour.

## See Also

- [README.md](./README.md) - Overview, discovery, cf vs Wrangler
- [configuration.md](./configuration.md) - Config surface, Build Output layout
- [patterns.md](./patterns.md) - Working recipes
- [api.md](./api.md) - Command and flag surface
