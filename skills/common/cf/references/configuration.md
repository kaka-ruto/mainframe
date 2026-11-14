# cloudflare.config.ts Configuration

`cloudflare.config.ts` replaces `wrangler.toml` / `wrangler.jsonc` for the `cf` toolchain. It is a TypeScript module, so your editor and your agent's language server both get completion and validation on the config surface.

## Requirements

| Requirement | Value | Verified |
|-------------|-------|----------|
| Node for loading this file | **>= 22.18.0** | Error: `cloudflare.config.ts loading requires Node.js v22.18.0 or higher.` |
| Import path | `cf/config` | `package.json` exports `"./config"` |
| Re-exports from | `@cloudflare/config/public` | Package README: *"This is not yet stable enough for external use — APIs may change without notice."* |

The version gate comes from `registerConfigHooks` in the Wrangler dev server, which `cf` invokes. Node's TypeScript config hooks are the mechanism.

## Shape

```typescript
import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "my-worker",
    compatibilityDate: "2026-09-27",
  },
});
```

`defineConfig` accepts `CloudflareConfig`, whose **entire** key set is `worker?` and `containers?`. `name` and `compatibilityDate` belong **inside** `worker` — putting them at the root fails validation:

```
✖ Unrecognized keys: "name", "compatibilityDate"
```

### WorkerConfig keys

Complete key set, verified from `@cloudflare/config` in v1.0.0-beta.5:

`name` · `compatibilityDate` · `compatibilityFlags?` · `entrypoint?` · `assets?` · `domains?` · `triggers?` · `tailConsumers?` · `cache?` · `placement?` · `limits?` · `logpush?` · `observability?` · `workersDev?` · `previewUrls?` · `firstPartyWorker?` · `unsafe?` · `env?` · `exports?`

| Key | Purpose |
|-----|---------|
| `name` | Worker name |
| `compatibilityDate` | Runtime compatibility date — keep current |
| `compatibilityFlags` | e.g. `nodejs_compat` |
| `entrypoint` | Entry module: a path string, or a module imported with `{ type: "cf-worker" }` |
| `assets` | Static assets (see §Assets — has a beta.5 validator bug) |
| `domains` | `string[]` of custom domain hostnames |
| `triggers` | `Trigger[]` built with `triggers.*` |
| `env` | Binding map — **this is where bindings go** (see §Bindings) |
| `exports` | Named exports: Durable Objects, Workflows, Containers |
| `observability` | Tracing / logging config |
| `limits` | `cpuMs`, etc. |
| `placement` | Smart placement |
| `logpush` | Stream logs to R2/S3 |
| `workersDev` | Expose on `*.workers.dev` |

### Entrypoint

Two accepted forms:

```typescript
// Path string
entrypoint: "./src/index.ts"

// Module import with the cf-worker import attribute
import * as entrypoint from "./index.js" with { type: "cf-worker" };
export default defineConfig({ worker: { name: "x", compatibilityDate: "2026-09-27", entrypoint } });
```

## Bindings

Bindings live in `worker.env` as a map of **binding name → binding object**. This replaces Wrangler's `vars` + `kv_namespaces` + `d1_databases` + … blocks. (The name `env` is overloaded: in Wrangler `env` meant "environment", here it means "bindings".)

```typescript
import { defineConfig, bindings } from "cf/config";

export default defineConfig({
  worker: {
    name: "my-worker",
    compatibilityDate: "2026-09-27",
    env: {
      API_URL:   bindings.text("https://example.com"),
      API_TOKEN: bindings.secret(),
      CACHE:     bindings.kv({ id: "production-namespace-id" }),
      DATABASE:  bindings.d1({ name: "example-database" }),
      UPLOADS:   bindings.r2({ name: "example-uploads" }),
      JOBS:      bindings.queue<{ userId: string }>({ name: "example-jobs" }),
      AI:        bindings.ai(),
      SEARCH:    bindings.vectorize({ name: "example-search" }),
      API:       bindings.worker({ worker: "example-api" }),
    },
  },
});
```

### `bindings.*` — all 35 helpers

Verified complete list from `@cloudflare/config` v1.0.0-beta.5:

| Helper | Binds to |
|--------|----------|
| `text` | Plaintext environment variable — **takes a bare string**, not an object |
| `json` | JSON-typed binding |
| `secret` | Secret |
| `kv` | Workers KV namespace |
| `d1` | D1 database |
| `r2` | R2 bucket |
| `queue` | Queue (generic over payload type) |
| `ai` | Workers AI |
| `aiSearch` | AI Search instance |
| `aiSearchNamespace` | AI Search namespace |
| `vectorize` | Vectorize index |
| `worker` | Another Worker (service binding) |
| `workerLoader` | Dynamic Worker loading |
| `durableObject` | Durable Object namespace |
| `browser` | Browser Rendering |
| `images` | Images |
| `media` | Media (video) |
| `stream` | Realtime Stream |
| `analyticsEngineDataset` | Analytics Engine dataset |
| `rateLimit` | Rate limiting binding |
| `pipeline` | Pipeline |
| `dispatchNamespace` | Workers for Platforms dispatch namespace |
| `sendEmail` | Email sending |
| `assets` | The Worker's static assets — **takes no arguments** |
| `hyperdrive` | Hyperdrive |
| `secretsStoreSecret` | Secrets Store secret |
| `agentMemory` | Agent Memory |
| `artifacts` | Artifacts |
| `flagship` | Flagship |
| `logfwdr` | Logfwdr |
| `mtlsCertificate` | mTLS certificate |
| `versionMetadata` | Version metadata |
| `vpcNetwork` | Workers VPC network |
| `vpcService` | Workers VPC service |

Parameterized (generic) helpers — `ai`, `json`, `kv`, `pipeline`, `queue`, `text` — refine their payload type from the argument you pass.

### Common binding options

```typescript
bindings.kv({ id: "namespace-id" })
bindings.d1({ name: "my-db" })         // name-based; auto-provisioning friendly
bindings.r2({ name: "my-bucket" })
bindings.vectorize({ name: "my-index" })
bindings.queue({ name: "my-queue" })
bindings.worker({ worker: "other-worker" })   // value or Worker config reference
bindings.worker({ worker: workerConfig })      // a defineWorker(...) reference works too
bindings.workflow({ worker, exportName: "MyWorkflow" })
bindings.durableObject({ worker, className: "Counter" })
```

## Triggers

Routes, queues, cron schedules, email addresses, and raw sockets collapse into one `worker.triggers` array.

```typescript
import { defineConfig, triggers } from "cf/config";

export default defineConfig({
  worker: {
    name: "my-worker",
    compatibilityDate: "2026-09-27",
    triggers: [
      triggers.fetch({ pattern: "example.com/*", zone: "example.com" }),
      triggers.queue({ name: "jobs", maxBatchSize: 10 }),
      triggers.scheduled({ schedule: "0 * * * *" }),
      triggers.email({ addresses: ["support@example.com"] }),
      triggers.connect({ protocol: "tcp", port: 5432 }),
    ],
  },
});
```

### `triggers.*` — all 5 helpers

`fetch` · `queue` · `scheduled` · `email` · `connect`

`mode` semantics: the `mode` passed to config factories defaults to `development` under `vite dev`, `production` under `vite build`, and `undefined` under Wrangler.

## Factories and mode

Because the config is a function, each environment derives from one base instead of duplicating `env` blocks. Cloudflare reports internal configs condensing from 5,000+ lines to factory files.

```typescript
import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./index.js" with { type: "cf-worker" };

export default defineConfig(({ mode }) => ({
  worker: {
    name: "example-worker",
    entrypoint,
    compatibilityDate: "2026-09-27",
    env: {
      Environment: bindings.text(`This is ${mode} environment`),
      API_URL: bindings.text(
        mode === "production" ? "https://example.com" : "https://staging.example.com",
      ),
      CACHE: bindings.kv({
        id: mode === "production" ? "production-namespace-id" : "staging-namespace-id",
      }),
    },
  },
}));
```

Type signature, verified:

```typescript
type ConfigInput<T> = T | Promise<T> | ((ctx: ConfigContext) => T | Promise<T>);

interface ConfigContext {
  isPreview: boolean;   // whether the config is evaluated for a Preview build
  mode: string | undefined;  // set via the --mode CLI flag
}
```

Set the mode with the global flag: `cf deploy --mode staging`.

## Exports (Durable Objects, Workflows, Containers)

```typescript
import { defineConfig, defineContainer, defineWorker, exports } from "cf/config";

const myContainer = defineContainer({
  name: "my-container",
  image: { dockerfile: "./Dockerfile" },
});

const worker = defineWorker({
  exports: {
    MyDurableObject: exports.durableObject({ storage: "sqlite" }),
    MyContainerDO:   exports.durableObject({ storage: "sqlite", container: myContainer }),
    OldClass:        exports.durableObject({ state: "deleted" }),
    OldName:         exports.durableObject({ state: "renamed", renamedTo: "NewName" }),
    Outgoing:        exports.durableObject({ state: "transferred", transferredTo: "target-worker" }),
    Incoming:        exports.durableObject({ state: "expecting-transfer", storage: "sqlite", transferFrom: "source-worker" }),
    MyWorkflow:      exports.workflow({ name: "my-workflow", limits: { steps: 100 }, schedules: "0 * * * *" }),
  },
});

export default defineConfig({ worker, containers: [myContainer] });
```

## Assets

```typescript
assets: {
  directory: "./dist",
  htmlHandling: "auto-trailing-slash",   // or "drop-trailing-slash" | "force-trailing-slash" | "none"
  notFoundHandling: "single-page-application",  // or "404-page" | "none"
  runWorkerFirst?: boolean | string[]   // matches route to the User Worker
}
```

**beta.5 validator bug — verified.** `directory` is required by the underlying Wrangler config loader but rejected by the `cf/config` validator, and the two errors contradict each other:

| Config | Error |
|--------|-------|
| `assets: { notFoundHandling: "single-page-application" }` | ``The `assets` property in your configuration is missing the required `directory` property.`` |
| `assets: { directory: "./dist", notFoundHandling: "..." }` | ``✖ Unrecognized key: "directory" → at worker.assets`` |

**Workaround:** omit `worker.assets` entirely and let the dev server supply the directory (the `wrangler.config.ts` bridge with `defineWranglerConfig({ assetsDirectory: "dist" })`, or the Vite plugin's own output). Omitting it produced a valid Build Output Specification in testing. Note `bindings.assets()` takes no arguments in beta.5.

## Build Output Specification

The build artifact `cf deploy` consumes. Verified layout and file contents from a real build:

```
.cloudflare/
├── output/
│   └── v0/
│       ├── config.json                              # root — buildContext only
│       └── workers/
│           └── default/                             # per-Worker directory
│               ├── worker.config.json                # Worker identity lives HERE
│               ├── bundle/
│               │   └── index.js
│               └── assets/                           # static files (when present)
└── types/
    └── index.d.ts                                    # generated by cf workers types
```

**Root `config.json`** — only `buildContext`, plus optionally `accountId` and `complianceRegion`:

```json
{ "buildContext": { "isPreview": false } }
```

**`workers/<name>/worker.config.json`** — carries name, compatibilityDate, triggers, env bindings, and the module manifest:

```json
{
  "name": "t",
  "compatibilityDate": "2026-01-01",
  "triggers": [{ "type": "scheduled", "schedule": "0 * * * *" }],
  "env": {
    "GREETING": { "type": "text", "value": "hello" },
    "MY_KV":    { "type": "kv" }
  },
  "manifest": {
    "type": "complete",
    "mainModule": "index.js",
    "modules": { "index.js": { "type": "esm" } }
  }
}
```

Worker identity (`name`, `compatibilityDate`) is **never** in the root config. The default Worker directory is named `default`; `cf deploy --worker <name>` selects a different one.

## Generated Types

```bash
cf workers types                       # → .cloudflare/types/index.d.ts
cf workers types --include-runtime false
```

Generated header (verified):

```typescript
/* eslint-disable */
// Generated by @cloudflare/config
type __Config = import("cf/config").UnwrapConfig<typeof import("../../cloudflare.config").default>;
type __Env = import("cf/config").InferEnv<__Config["worker"]>;

interface Env extends Cloudflare.Env {}
```

`InferEnv` turns `env` bindings into their runtime types (`{ MY_JSON: { id: string } }` → `KVNamespace`, etc.). Runtime types are generated with the matching workerd version. Add `worker-configuration.d.ts` to `tsconfig.json`.

## See Also

- [README.md](./README.md) - Overview, cf vs Wrangler, discovery
- [api.md](./api.md) - Command and flag surface
- [patterns.md](./patterns.md) - Config recipes, CI, migration
- [gotchas.md](./gotchas.md) - Build Output gotcha, `assets.directory` bug, Node version
