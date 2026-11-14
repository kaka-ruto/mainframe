# cf Patterns

Recipes. Command syntax verified against `cf v1.0.0-beta.5`.

## New Worker

```bash
cf init my-worker && cd my-worker
cf dev
cf deploy --dry-run      # validate without authenticating
cf deploy
```

`cf init` prompts for a directory when omitted; non-interactive runs must pass it (use `.` for the current directory). Options: `--install` / `--no-install`, `--package-manager npm|pnpm|yarn|bun`.

Behavior on the target directory:

| Directory contents | Result |
|-------------------|--------|
| Empty, or only `.git` | New hello-world Worker |
| Other files present | Autoconfig |

`cf init` without a subcommand runs `cf init workers`.

## Existing Project, No Cloudflare Config

```bash
cf deploy
```

Autoconfigures the project. The scaffold adds `cf` and `wrangler` as devDependencies, a `"deploy": "cf deploy"` script, `cloudflare.config.ts`, and a `wrangler.config.ts` bridge:

```typescript
// wrangler.config.ts
import { defineWranglerConfig } from "wrangler";

export default defineWranglerConfig({
  assetsDirectory: "dist",
});
```

Preview first: `cf deploy --dry-run`.

## Migrating from Wrangler

```bash
cf migrate                       # current directory
cf migrate path/to/wrangler.jsonc
```

| Option | Effect |
|--------|--------|
| `--bundler vite\|wrangler` | Default: `vite` if `@cloudflare/vite-plugin` is declared, else `wrangler` |
| `--dry-run` | Show files that would change without writing |
| `--force` | Run even if the Git worktree is not clean |
| `--install` / `--no-install` | Add `cf` as a project dependency (default: install) |

Always run `cf migrate --dry-run` first and read the diff.

What converts how:

- **Vite-based Workers** → converted to `cloudflare.config.ts`, Vite becomes the dev server.
- **esbuild Workers** → config converts, build keeps delegating to Wrangler.
- **Rust / Python Workers** → build keeps delegating to Wrangler.
- **Legacy Pages projects** → not covered; stay on Wrangler.

## CI/CD

Authenticate with environment variables. `cf` reports `authSource` as `CLOUDFLARE_API_TOKEN environment variable` when the token comes from the env.

```yaml
name: deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22.18.0'   # required for cloudflare.config.ts
      - run: npm ci
      - run: npm run build          # your framework build
      - run: cf deploy --dry-run    # catches most failures for free
      - run: cf deploy --message "${{ github.sha }}"
```

**The token needs Workers Scripts:Edit.** A Pages-only token fails `cf deploy` with `403 No access to the specified resource`.

Pinning: install a known version rather than tracking the beta — `npm i -D cf@1.0.0-beta.5`. Avoid floating `cf@beta`; no `beta` dist-tag exists on the `cf` package (verified — `npm i -D cf@beta` fails `notarget`).

## Static Sites

**Read [gotchas.md](./gotchas.md) §Build Output Specification before deploying a static site.** The short version: `cf` runs its own framework build and then demands a Build Output Specification that a plain framework build never writes.

### Astro (verified workaround)

A fully pre-rendered Astro site does **not** need `@astrojs/cloudflare`. Per Cloudflare's own Astro guide, a pre-rendered site needs no adapter — the adapter switches the project to `output: 'server'`. Cloudflare's docs still document `astro build` + `wrangler deploy` as the manual static path.

```bash
# 1. Pin wrangler — the flags below are experimental and can disappear
npm i -D --save-exact wrangler

# 2. Emit the Build Output Specification explicitly
npx wrangler build --experimental-new-config --experimental-cf-build-output

# 3. Deploy prebuilt
cf deploy --prebuilt
```

This path also requires **Node >= 22.18.0**, because `--experimental-new-config` requires `cloudflare.config.ts`.

### Verifying before you deploy

```bash
cf deploy --dry-run
```

Verified output:

```
├  Deploy
│  Total Upload: 0.16 KiB / gzip: 0.14 KiB
│  Your Worker has access to the following bindings:
│  Binding                     Resource
│  env.MY_KV                   KV Namespace
│  env.GREETING ("hello")      Environment Variable
│
│  --dry-run: exiting now.
◆  Dry run complete
```

## Multiple Environments

Derive from one base with a `mode` factory rather than duplicating `env` blocks.

```bash
cf deploy --mode staging
cf deploy --mode production
```

```typescript
import { bindings, defineConfig } from "cf/config";

export default defineConfig(({ mode }) => {
  const prod = mode === "production";
  return {
    worker: {
      name: prod ? "example" : "example-staging",
      compatibilityDate: "2026-09-27",
      entrypoint: "./src/index.ts",
      env: {
        API_URL: bindings.text(prod ? "https://example.com" : "https://staging.example.com"),
        CACHE: bindings.kv({ id: prod ? "prod-ns-id" : "staging-ns-id" }),
      },
      triggers: [ prod && { type: "custom" } ].filter(Boolean),
    },
  };
});
```

`mode` also gates per-mode triggers via `ctx.isPreview` for Preview builds.

## Bindings Recipes

### Adding KV

```bash
cf cli search "create a kv namespace"    # → cf kv namespaces create
cf kv namespaces create MY_KV
```

```typescript
env: { MY_KV: bindings.kv({ id: "<NAMESPACE_ID>" }) }
```

### Adding D1

```bash
cf cli search "create a d1 database"     # → cf d1 databases create
```

```typescript
env: { DB: bindings.d1({ name: "my-db" }) }
```

### Adding a Queue

```typescript
env: { JOBS: bindings.queue<{ userId: string }>({ name: "my-jobs" }) }
```

### Service Bindings

```typescript
env: { API: bindings.worker({ worker: "other-worker" }) }
```

### Cron

```typescript
import { triggers } from "cf/config";
triggers: [triggers.scheduled({ schedule: "0 * * * *" })]
```

## Secrets

Prefer file-based or env-based over interactive prompts — CI cannot answer a prompt.

```bash
cf deploy --secrets-file .secrets.json     # JSON or .env format
```

CI secrets via environment:

```bash
# In the project config
env: { API_TOKEN: bindings.secret() }
# In CI
environment:
  API_TOKEN: ${{ secrets.API_TOKEN }}
```

> **Security**: Never pass secret values as CLI arguments, never `echo` them into a pipe, never commit a `--secrets-file`. Use `bindings.secret()` plus the CI environment.

## Auth Profiles

Useful for monorepos where one directory deploys to a different account than another.

```bash
cf auth create staging          # create or re-authenticate
cf auth activate staging ./apps/staging   # bind profile to a directory
cf auth list
cf --profile staging deploy     # explicit override
```

`cf auth deactivate [dir]` removes the binding; `cf auth delete <name>` removes the profile.

## Managing Resources From the CLI

Everything else goes through search → help → schema:

```bash
cf cli search "purge cache"
cf cache purge --help
cf schema cache purge
```

Resource groups available at the top level include `kv`, `d1`, `r2`, `queues`, `vectorize`, `hyperdrive`, `workers`, `containers`, `images`, `stream`, `secrets-store`, `workflows`, `email-routing`, `email-sending`, `ai-gateway`, `ai-search`, `access`, `zero-trust`, `tunnel` (under zero-trust), `dns`, `zones`, `zone`, `rulesets`, `waf`-adjacent `firewall`, `cache`, `analytics`, `logs`, `logpush`, `speed`, `previews`, `builds`, `registrar`, `load-balancers`, `pages projects`. Full list in [api.md](./api.md).

## Type Safety in CI

```bash
cf workers types
git diff --exit-code .cloudflare/types/index.d.ts   # fail if config and types drifted
```

## See Also

- [README.md](./README.md) - Overview and discovery
- [configuration.md](./configuration.md) - Config surface reference
- [api.md](./api.md) - Command and flag reference
- [gotchas.md](./gotchas.md) - Known failures and workarounds
