---
name: s5x-sdk
description: Write TypeScript/JavaScript that creates and drives s5x microVM sandboxes with the `s5x` SDK — `Sandbox.create`/`createIfNotExists`, `exec` and detached `start()` processes, files, env, vault and login secrets, header rules and allowlists (`box.network`), schedules, previews, endpoints, templates, volumes (attach, detach, snapshots, forks), snapshots, backups, logs -- and how code inside a sandbox calls s5x over plain HTTP (its vault, logins, schedules, and holds that keep it awake). Use this whenever code imports "s5x" or calls localhost:8081 inside a sandbox, or the user wants to build a product on s5x — one sandbox per end user, an AI agent runtime, a code-execution service, a webhook worker — or asks how to keep a credential out of a sandbox, limit which hosts it can reach, handle s5x errors, retries, timeouts, long-running jobs, file transfer, or releasing a template build to existing sandboxes (promote, rollback). Prefer the s5x-cli skill when the user works in a terminal rather than writing code.
---

# s5x SDK

s5x runs each sandbox as its own microVM. The one property that
shapes the API: **a sandbox sleeps when idle and resumes as the same running
process tree** — same pids, heap and open sockets — the moment something needs
it, in tens of milliseconds. So there is no `sleep()` or `wake()`: a call that
needs the VM (`exec`, `start`, `fs`, process calls) wakes it; reads and
settings (`Sandbox.get`/`list`, `box.info()`, `box.network`, `env`, `vault`,
`Logs`) never do, and a snapshot or backup of a sleeping sandbox leaves
it asleep.

A sandbox sleeps once nothing has happened in it for its sleepAfter (30 s
unless you set it): no CPU work, no data in or out, no request of its own
waiting on an answer, and no call from you in flight. Hold it awake
(`POST http://localhost:8081/v1/keepalive`, or a `keepAlive` process) only
for what that cannot see: a timer or `sleep`, a wait for an answer over
5 minutes, a streamed answer that goes quiet for longer than sleepAfter, a
connection whose heartbeats are rarer than sleepAfter, and a QUIC request.

So an agent turn, a model call or a job needs no hold while it works. What you
control is `sleepAfter` (at create, or later with `box.set({ sleepAfter })`,
no need to recreate it): 0, or at least 5. It sleeps within about 4 s past it,
and no sooner than 5 s after a call that needed the VM ends.
`box.info()` says what it last did (`lastActivityKind`, `lastActivityRemote`).
A browser in a sandbox: launch it through Puppeteer or Playwright, or pass
`--disable-background-networking --disable-component-update` to a raw launch,
or its own background traffic keeps your sandbox awake.

Every `ts` code block in this skill and its references is type-checked against
the real SDK, so the method names, options and return fields are exact. The full
surface is in `references/api.md`.

## Setup

```bash
bun add https://s5x.dev/sdk/0.9.0     # npm, pnpm and yarn take the same address
```

It installs from that address, not from the npm registry: `npm install s5x`
finds nothing. The code imports `"s5x"` either way. If `s5x` does not resolve after installing, do not
substitute another sandbox vendor's SDK or guess a different package name —
ask the user where their s5x SDK comes from. Runtimes: Node ≥ 20.19, Bun, and edge runtimes with
`fetch`. **Not browsers**: the API sends no CORS headers, so this is
server-side code.

Unless the program calls `configure({ apiKey })` or passes `{ client }`, every
call reads `S5X_API_KEY` the first time it needs a key, never at import time.
Every call goes to `https://api.s5x.dev`, and no option or variable changes
that, so a key is never sent anywhere else. The user sets the key. For a
server or CI job, they make one with `s5x key create <name>` in their own
terminal, which prints it once. No SDK call issues one, and an agent never
runs `key create`, nor reads, prints or copies a key. The SDK never reads
`~/.s5x/credentials.json`. It keeps the key in a private field, so logging or
serializing a client or a sandbox does not print it. Still never hard-code a
key or log it.

```ts
import { configure, S5X, Sandbox, Template } from "s5x";
declare const keyFromSecretManager: string;
declare const customerKey: string;

// One API key per process: set it once at startup, or just export S5X_API_KEY.
configure({ apiKey: keyFromSecretManager });

// Several keys in one process, or a key per request or per customer: pass a
// client to each call. Calling configure() per request races between requests.
const theirs = new S5X({ apiKey: customerKey });
const box = await Sandbox.get("dev", { client: theirs });
const builds = await Template.list({ client: theirs });
```

A sandbox handle keeps the key it was made with, so `box.exec(...)` and the
rest of its methods take no `client`.

Your own service can run in an s5x sandbox like any app, with a key of its
own (`s5x key create <name>`) as `S5X_API_KEY` in its `env` at create. Code in
that sandbox can read it, so only for your own code, never a sandbox that runs
an agent or code you did not write; if that service is compromised, give it a
new key and revoke the old one with `s5x key rm` (`references/patterns.md`,
"Run your own service in a sandbox").

## The entry points

Every entry point is a static on a class named for the thing, and each takes
`{ client }` in its last argument.

| | What it is | Statics |
|---|---|---|
| `Sandbox` | one sandbox: run things in it, move files, its env, network (header rules, allowlist), vault and logins, schedules, previews, snapshots, backups | `create`, `get`, `fromName`, `createIfNotExists`, `list`, `usage` |
| `Template` | the images sandboxes boot from, and their builds | `build`, `buildInBackground`, `waitUntilReady`, `get`, `list`, `promote`, `delete` |
| `Endpoint` | stable hostnames that outlive the sandbox behind them, and your own domains for them | `create`, `list`, `point`, `delete`, `addDomain`, `domains`, `checkDomain`, `removeDomain` |
| `Volume` | durable disks that outlive the sandboxes they are attached to, and grow as they fill; only a disk -- the vault and header rules belong to the sandbox -- and their snapshots, attached read-only or forked into new volumes | `attach`, `detach`, `list`, `get`, `set`, `delete`, `snapshot`, `snapshots`, `deleteSnapshot`, `fork`, `backup`, `backupInBackground`, `backups`, `restore`, `restoreInBackground` |
| `Backup` | every finished backup you hold, including those of deleted sandboxes | `list`, `get`, `waitUntilReady`, `delete` |
| `Operation` | a backup, restore, snapshot, large upload or erase under way, or finished within the day | `get`, `list`, `wait` |
| `Logs` | what happened to your sandboxes, readable after they are gone | `query`, `stats`, `sandboxes`, `follow` |

`whoami()` says whose key it is. **The SDK is for code outside a sandbox**, and
for your own service inside one, with your key as `S5X_API_KEY` in its env
(above). Code inside a sandbox reaches its own vault, logins, schedules and holds over
plain HTTP, with no library and no key — see below.

```ts
import { Sandbox, Template } from "s5x";

const box = await Sandbox.createIfNotExists({
  name: "user-4411",           // your name for it; the CLI and API call this `ref`
  template: "agent",           // latest; or "agent@<digest>", or a tpl_ id
  sleepAfter: 90,              // seconds with nothing happening before it sleeps; 0 = never, else at least 5
  // A durable disk, made the first time: what survives a new build or a replaced sandbox.
  volumes: [{ volume: "user-4411-data", path: "/data", create: true }],
});

const { builds } = await Template.get("agent");   // every build of the name, newest first
```

**Use `createIfNotExists` for anything addressed by a stable name**, such as a
sandbox per end user. It is race-safe: two requests for the same user both land
on one sandbox instead of one of them failing with 409, which is exactly the
failure a naive get-then-create has, and only under concurrency. When another
caller is still creating the sandbox, `createIfNotExists` waits for it to
finish, up to its `timeoutMs` (two minutes by default), so the handle it
returns is ready to use. It throws `ClientError` if the sandbox is still being
created after that.

A template has no size: a sandbox is 1 vCPU and 2048 MB unless
`Sandbox.create({ vcpus, memMb })` names another (at least 256 MB, at most 4
vCPUs and 8192 MB). Every build saves a ready image at that default, so a
sandbox of another size boots the build's root filesystem cold, which takes
as long as its entrypoint takes to start. Need a bigger one
later? `box.set({ memMb })` changes it in place -- same sandbox, same
everything -- at its next wake (its processes restart), or at once with
`now: true`. Never destroy and recreate a sandbox to
resize it: that makes a new sandbox, which gets the volumes and nothing else.

## Running code: `exec` or `start`

| | `box.exec(cmd)` | `box.start(cmd, { name })` |
|---|---|---|
| waits for it | yes, returns `{ exitCode, stdout, stderr, timedOut, binary }` | no, returns a `ProcessHandle` |
| time limit | `killAfterMs`, default 30 s, **max 60 s**; there is no "never": `0` means the 30 s default | `timeoutSeconds`, **default 600**, `0` = never |
| survives the sandbox sleeping | n/a | yes, as the same process |
| use for | quick commands, checks, one-shot scripts | servers, agents, jobs, downloads — anything that might take a minute |

```ts
import { Sandbox } from "s5x";
declare const box: Sandbox;

// Quick: branch on the exit code, not on stderr.
const r = await box.exec("test -f /data/ready");
if (r.exitCode !== 0) console.log("not ready");

// A server that answers requests: requests wake it, so no keep-alive.
await box.start("bun /app/server.ts", { name: "server", timeoutSeconds: 0 });

// A background job that works keeps the sandbox awake by itself. keepAlive is
// for one that goes quiet longer than sleepAfter: a timer, a wait over 5 min.
const job = await box.start("python3 -u /app/etl.py", {
  name: "etl", timeoutSeconds: 3600,
});
const done = await job.wait();
console.log(done.status, done.exitCode);
```

Two traps here cost people the most time:

- **`timeoutSeconds` defaults to 600.** A server started without
  `timeoutSeconds: 0` is killed after ten minutes and looks like it crashed.
- **Quiet background work needs `keepAlive: true`.** A job that computes or
  moves data keeps the sandbox awake by itself; one that goes quiet longer
  than `sleepAfter` -- a timer or `sleep` between steps, a wait for an answer
  over 5 minutes -- is frozen in the quiet without the flag: nothing lost, but
  nothing will wake it either. It holds the sandbox until the process exits,
  and under memory pressure it can be overridden; s5x then wakes the sandbox
  again once its host has room.

`killAfterMs` on `exec` is how long the *command* may run. `timeoutMs`, on any
method, is how long *this HTTP request* may take, and on one that waits
(`wait`, `Operation.wait`, `Template.build`, `waitUntilReady`, `createIfNotExists`) how long the whole
wait may take, its requests included. They are different deadlines on purpose;
set the one you mean.

At `killAfterMs` the whole process group gets SIGKILL and only output already
written to stdout/stderr comes back, so run Python as `python3 -u` and never
pipe through `head`, `sed` or `grep`. To cap output, redirect it to a file and
read back a bounded amount (`references/patterns.md`, "Timeouts and
cancellation").

`exec`, `start`, `shell` and scheduled commands run as the image's `USER`
(root if it declares none; its primary group only; no option runs as root;
a template with `trustedUsers` must declare one it does not trust)
and start in the image's `WORKDIR`, like `docker exec`; with no `WORKDIR`, or
one that is missing at run time, they start in `/`. `start` takes `cwd`;
`exec` doesn't, so use `cd /path && …`, as in `box.exec("cd /srv/tools && make")`
or `box.start(cmd, { cwd: "/srv/tools" })`. A non-root user cannot write `/`,
nor a `WORKDIR` the Dockerfile made before `USER`, so relative writes there fail.

## Files

```ts
import { Sandbox } from "s5x";
declare const box: Sandbox;
declare const config: string;

await box.fs.writeFile("/app/config.json", config);        // string, bytes or Blob
const text = await box.fs.readText("/data/result.json");
const entries = await box.fs.list("/data");                 // [{ name, dir, size, … }]
const big = await box.fs.readStream("/data/export.tar");    // stream it; do not buffer
```

- **`writeFile` takes up to 100 GiB**: a string, bytes or a `Blob`, not a
  stream (spool one to a file first). For a file on disk pass a `Blob` -- `await openAsBlob(path)`
  from `node:fs`, or `Bun.file(path)` -- which is read as it is sent, never
  held. Over 32 MiB it is an upload, sent in parts and then placed into the sandbox;
  `writeFile` waits for both and reports them through `onProgress`. The file
  appears whole or not at all, and the sandbox needs room for the old one and
  the new one until it does. Once `writeFile` resolves the file is on disk: a
  crash of the sandbox or its host does not lose it, so one `writeFile` per
  event into an inbox is a delivery you can count. Names starting
  `.s5x-partial-` are its temporary files: a write to one is refused (400),
  and one a crash left is removed by the next write there. It rides out the
  API being away (a 502, 503 or 504, a dropped connection) for two minutes on
  its own, so do not wrap it in a retry of those: a `writeFile` that throws
  can simply be sent again. It wrote nothing, unless you aborted it after
  every part was sent or the sandbox's disk failed as the placed file was made
  durable; then the file may already be in place. Data that
  already has a URL is quicker fetched by the sandbox:
  `box.start("curl -fsSLo /data/x <url>", { name: "fetch",
  timeoutSeconds: 3600 })` (the 600 s default kills a longer download; its
  traffic keeps the sandbox awake).
- **At most 4 files over 32 MiB go into one sandbox at once.** A fifth gets
  `ApiError` 429 with `retryAfter` 5 (`retryable`); retry it after
  `retryAfter` seconds. An abort while a file is being placed stops the wait,
  not the placement: the file may still appear.
- **An `exec` or `start` request caps at 1 MiB** (`ApiError` 400 above it, and
  nothing runs). Do not inline file contents in a command or in `start`'s `env`:
  `writeFile` the script and run it by path, `box.exec("sh /data/job.sh")`.
- **`writeFile` always writes mode 0644**, even over an executable: it keeps
  the owner but not the mode. Run a script you wrote through its interpreter,
  as above, or `chmod +x` it with `exec` first — which works only if the
  image's user owns the file, as it does any file `box.fs` created.
- **Never move bytes through `exec`'s `stdout`.** The reply is JSON: bytes that
  are not UTF-8 come back as U+FFFD (the result then has `binary: true`), and
  control-heavy output hits the 16 MiB reply cap (422) at a few MiB. Write to
  a file and read it with `readFile` or `readStream`.
- **`readFile` buffers the whole file** in memory, and reads are not size-capped.
  Use `readStream` for anything you would not want resident.
- Only files under a volume's path survive the sandbox being replaced or
  switching to a new build.

## Volumes

A volume is a disk that outlives the sandboxes it is attached to: what
survives a new build, a replaced sandbox or a deleted one. It is on one
machine, held read-write by one sandbox at a time, and has no size to choose:
it starts at 2 GiB and grows on its own as it fills, and what is deleted from
it is given back, so `usedBytes`, what it is billed, falls again.

```ts
import { Sandbox, Volume } from "s5x";
declare const userId: string;

// One volume per end user, made by the first create and attached as it is after.
const box = await Sandbox.createIfNotExists({
  name: `u-${userId}`,
  template: "agent",
  volumes: [{ volume: `u-${userId}`, path: "/data", create: true }],
});

// More on a running or sleeping sandbox: a second volume, and a snapshot read-only.
await Volume.attach(box, { volume: `u-${userId}-cache`, path: "/cache", create: true });
const snap = await Volume.snapshot("dataset");
await Volume.attach(box, { snapshot: snap.id, path: "/ref" });
await Volume.detach(box, { path: "/cache" });
```

- **Up to 4 volumes and 4 snapshots a sandbox**, each at a path of its own
  (`/data` for a volume unless given), none inside another. Every one passed to
  `create` is mounted before the app starts, and one that will not mount fails
  the create (422 `volume_mount_failed`, naming its `drive`); a volume the
  create made stays, empty and detached, for the retry.
- **`create: true` makes a volume you do not have**, on the sandbox's machine.
  Without it a missing name is 404 `volume_not_found`, so a typo never becomes
  a new, empty disk. A volume you have is attached as it is, so a retried
  create is harmless. An attach is not: repeating one that succeeded is 409
  `path_in_use`, so to make sure a volume is attached, look for its path in
  `(await box.info()).volumes` first.
- **A volume or a snapshot is attached only on its own machine** (409
  `volume_on_another_host`), and a create's must share one, which the sandbox
  is placed on (409 `volumes_on_different_hosts`). To use a volume's data
  beside another sandbox, restore a backup of it `nextTo` that sandbox.
- **One sandbox holds a volume at a time.** Another's attach is 409
  `volume_attached`, whose `e.problem.sandbox` and `e.problem.path` say where:
  `Volume.detach(p.sandbox, { path: p.path })` frees it.
- **A detach is refused while processes hold the volume** (409 `volume_busy`,
  with up to 32 of them by pid and command in `e.problem.holders`). Stop them,
  or detach with `force: "kill"`, which kills them, or `force: "restart"`,
  which restarts the sandbox without it. A dead sandbox takes only
  `"restart"` (409 `sandbox_dead` otherwise).
- **Mounted over a directory that has files, a volume hides them** until it is
  detached.
- **It grows, within limits.** At its `limitBytes` (the lesser of 1 TiB and a
  quarter of its machine's disk past the margin s5x keeps free on it), or once
  your account's volumes and snapshots hold its cap (1 TiB unless s5x support
  raised it; a new volume is then 409 `volume_cap`), a write gets ENOSPC, disk
  full, never an I/O error. A writer
  faster than it grows, or one that reserves more than half of it at once
  (`fallocate`), can meet ENOSPC until its next step.
- **A snapshot is instant and clean**: `Volume.snapshot(name)` holds the
  sandbox's writes for the instant of a copy that shares every block with the
  volume (its `usedBytes` is 0 until they differ), 20 a volume. Attach it
  read-only to any number of sandboxes on its machine, or `Volume.fork(id, {
  name })` it into a new volume, at once.
- **Every volume is backed up daily**, the first time 15 minutes after it is
  made (a fork and a restore into a new volume too), attached or not, kept
  `backupDays` (7 unless `Volume.set` says otherwise). `Volume.backup(name)`
  takes one now; `Volume.restore(backupId, { name })` makes a new volume of a
  volume's backup or of one `drive` of a sandbox's, and `replace: true` puts
  it back over its own volume.
- **A volume is a disk.** A sandbox created on one is a new sandbox: it gets
  the disk and nothing else.

`references/patterns.md` has a volume per end user, a dataset shared
read-only, and a fork per experiment.

## Credentials: header rules, logins, `vault`, `env`

**An API key that travels as an HTTPS header belongs in a header rule, not in
env.** So does a token your server receives for an end user, such as an OAuth
token from your callback: you deliver it, so it goes in a rule
(`Authorization: Bearer <token>`), and each refresh is another `headers.set`,
not the vault. A rule sets `name: value` on every HTTPS request the sandbox
makes to one exact host, on the way out, replacing whatever the sandbox sent.
The sandbox holds a placeholder where it expects the key, and the key never
enters it, its memory image, its snapshots or its backups. `network.get()`
lists rules by host and header name, never the value.

A rule keeps the key out of the sandbox, not out of use: every process in it,
including code your users run, can call the rule's host and have the key added.
Give the rule a key made for this purpose, with a spend limit, and watch its
usage.

**Put the placeholder and the rule in place before the process that calls the
API starts.** Passed to `create`, both are there from the first boot — for an
app the template's entrypoint starts, the only way its first calls carry the
key. `createIfNotExists` applies `env` and `network` only when it creates the
sandbox, so on reuse, check the rule is there:

```ts
import { Sandbox } from "s5x";
declare const anthropicKey: string;

const box = await Sandbox.createIfNotExists({
  name: "user-4411",
  template: "agent",
  env: { ANTHROPIC_API_KEY: "placeholder" },   // the client wants a value; this is not the key
  network: {
    headers: [{ host: "api.anthropic.com", name: "x-api-key", value: anthropicKey }],
  },
});
// On reuse too: setting the value a rule already has changes nothing, so this
// drops no connection; only a NEW value does (below).
await box.network.headers.set("api.anthropic.com", "x-api-key", anthropicKey);
```

- **The value is the whole header**, sent exactly as you pass it. For an API
  that takes `Authorization: Bearer <key>`, include the scheme:
  ``box.network.headers.set("api.openai.com", "Authorization", `Bearer ${openaiKey}`)``.
- **A rule needs no restart.** It applies to the connections the sandbox's
  processes open from then on — at once on a `running` or `unhealthy` sandbox
  (an unhealthy one's VM is up, and its processes may be too), from the next
  wake on a sleeping one. `pending: true` in the reply means saved, and in
  force within about 20 s.
- **Once a sandbox has a rule or an allowlist, every change restarts its
  egress proxy** and drops its open HTTP(S) connections, so change a rule only
  to rotate the key (`headers.set` it again, between turns). Setting a rule to
  the value it has, or the allowlist it has, is not a change: it drops
  nothing, so ensuring them on every start is safe.
- **`box.network.allow([...])` limits the sandbox to those exact hosts** (and
  rule hosts), on TCP 80 and 443 only, though DNS lookups of any name still
  leave through its resolver. Pass `network.allowedHosts` to `create`
  to restrict the first boot too.
- **A rule covers only HTTPS on 443 to the exact host**, and a JVM, gRPC or
  own-roots client cannot use one: keep that client's key in `env`. The
  details are in `references/api.md` under `box.network`.
- **The header is SET, never searched for.** s5x does not swap a
  placeholder wherever the sandbox writes one: a placeholder in a message
  body goes out as written, so the agent cannot be led to post the real key
  into a chat.
- **s5x does not refresh OAuth grants.** Keeping a grant fresh is your app's
  job, or its provider's (Composio, for one); a rule holds whatever value you
  last set.
- **These limits apply to every sandbox, whatever its `network`.** Port 25 is
  refused at once (`ECONNREFUSED`). Send mail through a provider's HTTPS API,
  or SMTP submission on 587 (or 465) with the account's credentials. Only
  public addresses are reachable: other sandboxes and private or reserved
  IPv4 ranges (10/8, 172.16/12, 192.168/16, 100.64/10, 169.254/16, multicast
  and the like) are dropped, so a connect there times out. And a
  sandbox opens at most 50 new connections a second, in bursts of up to 200.
  Every TCP connect, UDP flow (so each DNS lookup) and ping counts, and open
  connections do not. It holds at most 2,048 connections open at once; past
  that a new one is refused at once (`ECONNREFUSED`), so close what you are
  done with. Past the rate cap, new connections are dropped and TCP
  retries them a second later, so code that fans out (a crawler, one
  connection per item) sees slow connects, not errors. Reuse connections
  (keep-alive, a pooled client) and pace the fan-out.
- **With any header rule or allowlist, ports 80 and 443 go through the
  sandbox's egress proxy**, which holds at most 256 connections open at once
  for the two together. Past that, a new connection is reset at once
  (`ECONNRESET`).

**Where a secret goes.** Four places, and picking the wrong one is a security
bug: `env` and `vault` go in opposite directions, and a website's password
for a sign-in form is a login.

| | header rule (`box.network.headers`) | login (`box.vault.logins`) | `box.vault` | `box.env` |
|---|---|---|---|---|
| for | an API key the sandbox **only sends**, in an HTTPS header (above) | a website's username, password and TOTP seed, which **your trusted helper types into the site's sign-in form** | what code in the sandbox must **read or update itself** at runtime — the tokens from an OAuth flow it runs, a refresh token it rotates, a webhook secret it generates and checks | credentials **you deliver** that a header rule cannot carry: a database URL, a signing secret, a key a JVM, gRPC or plain-HTTP client sends |
| lands | nowhere in the sandbox: set on each request on the way out | sealed outside the sandbox; the TOTP seed never enters it, only each code | in the sandbox's own encrypted store; it ends with the sandbox (a new sandbox on the same volume starts without it) | as environment variables |
| read back from outside | never: `network.get()` names rules only | never: `logins.list()` returns websites, usernames and hints | yes, `vault.get(key)` | never: `list()` returns names only |
| read from inside | never | `POST http://localhost:8081/v1/vault/logins/get` and `/totp`, only by the template's trusted users and root | `POST http://localhost:8081/v1/vault/get`, with no credential; on a template with trusted users, only by them and root | `process.env` |

**Trusted users keep an assistant's own code from the vault and logins.** A
template built with `trustedUsers` (below) names the users of its image that
may read the vault and logins, or change schedules, from inside its
sandboxes; every other user and a web page get 403. A container counts as the
user whose socket reaches s5x: a rootless one as the user that started it, one
on the sandbox's network as the user it runs as, and one on a bridge network
of its own as no user, which gets 403 too. Run a small helper as the only
trusted user, one that signs in and never returns a secret, and everything
else, your harness too, as the image's `USER`
(`references/examples/trusted-helper/`): no bug in the harness, and no
prompt that steers it, can then read the vault or a login; `env` is still
every process's. A trusted user never starts anything for untrusted code,
nor fetches a URL the assistant chose (a redirect to `localhost:8081` would
go as the trusted user). Change schedules from your server, with the SDK,
which checks no trusted user. A login is read only there: no call from
outside, API, SDK or CLI, returns its password or seed.

```ts
import { Sandbox } from "s5x";
declare const box: Sandbox;
declare const password: string;    // from your user, never logged
declare const totpSeed: string;    // an otpauth://totp/ URI or a base32 seed

const login = await box.vault.logins.set({
  websites: ["github.com"], username: "ada", password, totp: totpSeed, hint: "work account",
});
// A change names the id and sends only what changes; totp: null removes the seed.
await box.vault.logins.set({ id: login.id, hint: "Ada's work account" });
```

`references/guest.md` ("Trusted users", "Logins") has what a trusted user's
code calls inside, what s5x guarantees and does not, and how each read is
recorded; `references/api.md` (`box.vault.logins`) has the limits.

**`env` reaches processes started after the sandbox's next boot or wake.** A
running process keeps its environment through sleeps and wakes, and on an
awake sandbox `exec` (it has no per-call env) and a process restarted right
after `env.set` still get the old set. Put what a process needs in
`Sandbox.create({ env })`. To change a value a `start()` process uses now,
restart it with `start`'s `env: { NAME: value }` (`references/patterns.md`,
"Changing env on a live sandbox"). The entrypoint (`app`) restarts with
`box.processes.get("app").restart()`, and takes the env of the sandbox's last
boot or wake: a new value reaches it only from a restart after the next one.
So if a value will change, run the app with `box.start()`.

## Code inside the sandbox: plain HTTP

Code running in a sandbox calls s5x over plain HTTP, with **no library and no
API key**: s5x identifies the calling sandbox from the network itself. Do not
ship an API key into a sandbox; it would end up in the memory image and every
snapshot and backup.

One base URL, `http://localhost:8081/v1`, serves all of it:

- the sandbox's own vault (`POST /vault/get`, `/vault/put`, `/vault/list`),
  its logins (`POST /vault/logins/list`, `/get`, `/totp`), its schedules
  (REST under `/schedules`) and `POST /whoami`;
- `POST /keepalive` — keeps the sandbox awake **for as long as the request
  stays open**, for the quiet stretches listed at the top of this file; a
  process that dies closes it. `GET /keepalive` says what is holding it and
  what the sandbox is waiting on.

Every POST sends `content-type:
application/json`, `{}` when there is nothing to say: that is what tells code
from a web page a browser in the sandbox loaded, and a POST is refused 403
without it. On a template with trusted users, only they and root may call
the vault and logins or change schedules, and a request that carries `Origin`
or `Sec-Fetch-Site` there is refused. `references/guest.md` has every
endpoint, its answers and what can reach it, with `fetch`, `curl` and Python
examples; read it before writing code that runs inside a sandbox.

## Errors and retries

```ts
import { ApiError, ClientError, ConfigError, Sandbox } from "s5x";

try {
  await Sandbox.get("nope");
} catch (e) {
  if (e instanceof ApiError) {
    e.status;       // branch on this
    e.code;         // a refusal's stable name, when it has one ("volume_busy"): branch on this too
    e.message;      // the server's explanation — usually names the fix
    e.requestId;    // quote this when reporting a problem
    e.retryable;    // true when the server sent retryAfter, and for 502, 503, 504 and 524
    e.retryAfter;   // seconds, when the server says how long to wait
    e.problem;      // the problem document; {} when the body was not JSON (e.g. a gateway's page). A volume's members (sandbox, path, sandboxes, drive, holders) are typed; others are `unknown`
  } else if (e instanceof ConfigError) {
    // no credential configured, or a { client } that holds no client — nothing reached the network
  } else if (e instanceof ClientError) {
    // the SDK refused on its own: a name that is "." or "..", or a wait that gave up
  }
}
```

**The SDK does not retry for you.** Retry when `e.retryable`, waiting
`e.retryAfter` seconds when present, with a bounded number of attempts, and
only for a call that is safe to repeat. `exec` and `start` are not: a 500, or
a 502, 503, 504 or 524 without `retryAfter`, an abort, a `timeoutMs` expiry or
a dropped connection can come after the command started. A `timeoutMs` expiry throws a `DOMException`
named `TimeoutError`, and an abort throws the signal's reason: neither is an
`ApiError`. `references/patterns.md` has a helper that handles the exceptions
(`withRetry`, with `{ mayRepeat: false }` for `exec` and `start`), and, under
"Whether a failed `exec` ran", which failures mean the command did not run,
ran, or may have run.

- **Whether a retry can help is the server's to say.** Everything that clears
  by itself carries `retryAfter`, and nothing a retry does not fix is
  answered 503. Never decide by the text of `e.message`: it is for people.
- **A 409 is retryable only when it carries `retryAfter`**: `this sandbox is
  still being created`, `the sandbox is waking or being suspended`, and
  `could not be woken` (another call's wake failed; a retry starts a fresh
  one), and, from `recover()`, `the sandbox is waking or going to sleep`.
  `retryable` is true for these, and none ran your command, so they are safe
  to retry for `exec` and `start` too. Keep at these for up to about two
  minutes, since a boot that fetches its build is that slow. Do not retry any
  other 409.
- **An error that is not `retryable` gets the same answer however often you
  send it**, such as one saying a volume would not mount
  (`volume_mount_failed`): stop, and report it with `e.requestId`. Every code
  and what to do about it is in `references/api.md`, Errors.
- **A 524 is `retryable`, but the operation may still be running.** The
  API closes a request it has not begun to answer within about 100 s, and the
  work behind it goes on. Check its result (`box.info()`) before trying again.
- **A 429 on `writeFile`** means four uploads are already running: wait
  `retryAfter` and send it again.
- **A not-ready 503 from `Sandbox.create` leaves the sandbox created and
  `unhealthy`**, and `create` again gets 409 "already exists". Pick it up with
  `createIfNotExists` or `Sandbox.get`.

What each 409 and 503 means, including a capacity 503 on a create that named a
volume: `references/patterns.md`, "Retrying transient failures".

A 404 from `Sandbox.get` is the normal "does not exist yet" signal — prefer
`createIfNotExists` over catching it.

## Your own domain for an endpoint

An endpoint answers at its own hostname, and can answer at a name of yours
too, such as `bot.example.com`, with one record at that name's DNS provider:
a CNAME from the name to the endpoint's hostname, which the answer carries as
`target`. No TXT record, no certificate to bring.

```ts
import { Endpoint } from "s5x";

const added = await Endpoint.addDomain("hook", "bot.example.com");
console.log(`at the DNS provider: ${added.domain} CNAME ${added.target}`);

// Later, or in a loop with a pause: s5x also looks by itself.
const d = await Endpoint.checkDomain("bot.example.com");
if (d.state === "failed") throw new Error(d.reason ?? "the domain failed");
if (d.state === "active") console.log(`served at ${d.url}`);
```

- `state` is `pending` until s5x sees the CNAME reach the endpoint, then
  `issuing` while its certificate is made (usually minutes; it is already
  served), then `active`. `failed` names the fix in `reason`, and
  `checkDomain` after the fix restarts it. s5x looks by itself every minute in
  the first hour and hourly after; one whose record it does not see in 7 days
  fails. `checkDomain` within 10 s of the last look answers the domain as it
  stands, so polling it costs nothing.
- If the name's DNS is on Cloudflare, set the record to DNS only (grey
  cloud): a proxied record hides the CNAME, and the domain fails saying so.
- No apex (`example.com` itself, 400 `domain_apex`): most DNS providers cannot
  put a CNAME there. Use `www.example.com`, and redirect the apex to it at
  the DNS provider.
- If the name or a parent has CAA records, they must allow `pki.goog`,
  `letsencrypt.org` and `ssl.com`.
- The app sees the domain as the request's `Host`; the endpoint's own URL
  keeps working, and a token endpoint still asks for its token.
- Up to 20 domains an account (409 `domain_limit`), each on one endpoint (409
  `domain_exists`): `Endpoint.point` keeps them, `Endpoint.delete` removes
  them too. `removeDomain` stops one within about 5 s.

## Templates: build, promote, roll back

```ts
import { Template } from "s5x";

// Resolves once the build is ready, and throws on failure, saying why (s5x fails a build past 30 minutes).
const ready = await Template.build({
  image: "ghcr.io/acme/agent:1.4.0",   // a public image; its CMD must keep running
  name: "agent",           // no size: that is the sandbox's, at Sandbox.create
});
// From here, a NEW sandbox created from "agent" already gets this build.

// THE CALL THAT MOVES EXISTING SANDBOXES: every sandbox of "agent" switches to
// it at its next wake.
const promoted = await Template.promote("agent", ready.id);
console.log(promoted.marked, promoted.already);
```

`Template.build` waits because until the build is ready, the bare name still
gives new sandboxes the previous build. Code that cannot hold a connection that
long, such as a request handler, calls `Template.buildInBackground(...)`, which
answers at once with the build `pending`, keeps that build (its `name` and
`id` are enough), and calls `Template.waitUntilReady(build)` later. Never call
`build` again to wait: that starts a second build.

The image's CMD is the sandbox's app: it runs with no terminal and an empty
stdin, and must keep running. A CMD that exits is restarted every 2 s, and
each exit adds `--- s5x: entrypoint exited rc=N, restarting ---` to the `app`
process's stderr (`box.processes.get("app").logs({ stream: "stderr" })`).
`box.processes.get("app").restart()` restarts it on purpose: it ends the
entrypoint and what it started, and starts it again 2 s later.

**Trusted users.** `Template.build({ image, name, trustedUsers: ["helper",
"@ops"] })` names the users of the image (or `@group`s, at most 16) that may
read the vault and logins or change schedules inside its sandboxes; root
always may and is never named. The image must then declare a `USER` it does
not trust, which `exec`, `start`, the shell and scheduled commands run as,
and its entrypoint runs as root, to start each program as its own user. A
build that leaves `trustedUsers` out keeps its name's last build's list; `[]`
clears it. The build answers `trustedUsers` and `warnings`: what in the image
could give another user a trusted user's reach (a `sudo` rule, a setuid
binary), which it reports and does not refuse. `references/guest.md`,
"Trusted users", has the rest.

To roll back, promote the build that ran before, by its digest or id:
`Template.promote("agent", "9c2e7a14b0d3")`.

**A build is what new sandboxes get, and moves none that exist.** Once ready,
`template: "agent"` gives a new sandbox that build (the later push wins,
whichever finishes first, and a promote made after a push, such as a
rollback, wins over it). An existing sandbox stays on its build until
`box.promote(build)` moves it, or `Template.promote` moves every sandbox of
the name; `template: "agent@<digest>"` or a `tpl_` id names one build exactly
(the canary in `references/patterns.md`). Every build has its own
digest, even the same image rebuilt with the same settings, and twelve hex
digits are enough to name it. There are no tags and no version numbers:
`"agent:v2"` is refused. Because a ready build reaches new sandboxes at once,
a canary that fails must promote the previous build back
(`references/patterns.md` shows how).

**Old builds are deleted for you.** s5x keeps every build in use, the 20 newest
builds of each template, and anything built in the last 30 days; other builds
are deleted 30 days after they were built. In use means a sandbox runs it or
is promoted to it, it is the name's latest, a snapshot or backup of yours can
restore it, or an operation in progress needs it. `TemplateBuild.expiresAt`
(from `Template.get` and `Template.list`) says when each other build is
deleted, and is `null` while it is kept; a failed build is deleted a day after
it started. To keep a build to roll back to past that, keep a sandbox or a
snapshot on it.

## Moving existing sandboxes to a new build

`promote` moves the whole name; `box.promote(build)` moves one sandbox, at its
next wake or with `{ now: true }` immediately. A switch **restarts the
sandbox's processes on the new build** (a memory image cannot cross builds) and
keeps what is the sandbox's: its volumes, env, vault, logins, schedules, previews,
endpoints, `box.network` header rules and allowlist, snapshots and backups.
Anything written outside its volumes is replaced by the new build's filesystem
— say so to the user before promoting.

- An awake sandbox is not interrupted; it switches after it next sleeps, so a
  fleet moves as its users come back. `Template.get(name)` counts
  `sandboxes` and `switching` per build; `SandboxInfo.pendingTemplateId` marks
  one that has not switched yet.
- **Only the image's entrypoint comes back by itself.** A process started with
  `box.start()` is gone after a switch. For a fleet that switches unattended,
  run the app as the image's entrypoint; otherwise start it again when
  `info.templateId` has changed.
- A sandbox keeps its own size through a promote; one not at the default
  (1 vCPU, 2048 MB) switches cold.
- `{ now: true }` is normally refused (409) while the sandbox is held awake
  (a `keepAlive` process, or a hold from code inside), and it stays promoted
  and switches at its next wake. Under memory pressure that can be overridden
  and `now: true` restarts the
  job, so check `box.processes.list()` for running work and ask the user
  first.
- A snapshot or backup never switches the sandbox it copies. Restoring one
  puts back the build it was taken on and cancels a pending switch; s5x keeps
  that build for as long as the snapshot or backup can restore it.
- Whether a new version can read what an old one wrote to a volume, or an
  old one what a new one wrote on rollback, is up to the app.

`references/patterns.md` has the full release recipe, with a canary.

## Things that behave differently from what you would guess

- **Keeping a sandbox awake is rarely right.** `sleepAfter: 0` holds memory
  forever and gives up the memory snapshot. If the VM dies it goes `dead`, and
  s5x brings it back on the same disk by itself -- at once for one that never
  sleeps, at its next wake for one that can -- with only the entrypoint
  restarted (`references/api.md`, `box.recover()`). **Every call that wakes
  a dead sandbox tries again, and it is kept until you recover or delete it.**
  Endpoints and
  previews wake a sleeping sandbox on the first request anyway.
- **An open connection keeps a sandbox awake, a WebSocket included.** A
  request through a preview or endpoint counts as activity until it ends, so a
  socket a client leaves open -- a page left in a tab, a live feed -- holds the
  sandbox awake for as long as it stays open. Close idle sockets from the
  client, or have the app close them. Only when its host runs short of memory
  and nothing else frees enough is it slept anyway, last of all, and its
  connections closed, so their clients hear at once; a hold, a `keepAlive`
  process and a scheduled run are slept through just before that.
- **The app behind a preview or endpoint must listen on `0.0.0.0`**, not
  `127.0.0.1`/`::1`, on the port the URL names. A request that arrives while
  the app is still starting (after `create`, `recover()`, or a crash restart)
  waits for the port, up to 10 s, and is then delivered whole; past that it is
  a 503 (`application/problem+json`) naming the port, and for 5 s after that
  the port answers the same 503 at once. **Every refusal from s5x carries an
  `x-s5x-refused` header** with a stable code (`port_closed`, `wake_failed`,
  `waking_no_capacity`, `dead`, `token_invalid`, ...; the same `code` is in
  the body, and an `ApiError` from the API carries it as `code`, with
  `no_capacity`, `file_not_found` and `process_not_found` from the API alone), and a 502 or
  503 your app sends itself never does. Branch on that header, not on the
  status or the text. A refused 503 was not delivered, so it is safe to send
  again after its `Retry-After` seconds; a 502 `no_response` reached the app
  and was not sent again. The full list is in `references/api.md`
  (box.previews).
- **A preview's `url` alone answers 401.** For a person in a browser, hand
  them `` `${preview.url}/?_s5x_token=${preview.token}` ``: the first visit
  sets a session cookie for that hostname (valid 12 hours at most, never past
  the preview's own expiry), so the page's scripts and styles load too. Code
  sends the token as `x-s5x-token: <token>` (use this one if the request also
  carries the app's own `Authorization`) or `Authorization: Bearer <token>`.
  An endpoint created without `public` takes its token the same ways. Only a
  Bearer holding an s5x token (`pv_…`, `ep_…`) is s5x's; any other
  `Authorization` reaches the app as sent. The app is told `x-s5x-sandbox`,
  `x-s5x-route` (`preview` or `endpoint`) and `x-s5x-route-id`, and no
  `x-s5x-*` header a caller sent reaches it.
- **Clearing a deadline is `null`, not `undefined`.** `box.set({ ttl: null })`
  removes it; omitting the key leaves it unchanged.
- **Schedules are UTC** unless the cron starts `CRON_TZ=Europe/Berlin`; a fixed
  hour there runs once on every local day, DST changes included. A 5-field or
  `@daily`-style cron runs at a second of its minute fixed for its sandbox (0
  to 59; `nextRunAt` shows it), so one cron on every user's sandbox wakes them
  across the minute, not all in its first second: never assume `:00`.
  `@every 15m` runs every 15 minutes from when you made it. `at` (a Date or
  RFC 3339) runs once instead, at that instant, and stays as a record (the 100 newest a
  sandbox has run are kept). A name is unique on
  its sandbox, and `add` refuses a name that exists (409). A scheduled command
  runs from the image's `WORKDIR` (`/` with none, or one missing at run time),
  and is at most 4096 bytes: put a longer script in a file and schedule
  `sh /path/to/job.sh`.
- **Every occurrence is in `runs()`, and delivery is at least once.** Read
  `outcome` before `exit`: `not_run`, `too_late` and `unknown` have no exit
  code, and `unknown` may have run. A command that must not act twice dedupes
  on `S5X_SCHEDULE_ID` + `S5X_SCHEDULED_AT` (the schedule's `id` and the run's
  `scheduledAt`). `run()` starts it at the next poll, `nextPollAt`.
- **A scheduled run gets five minutes, and no option changes that** (the same
  for a schedule added from inside, `POST http://localhost:8081/v1/schedules`,
  and `schedules.run()`). Then it is killed with its
  process group and recorded as exit 124, and its `output` ends with a line
  saying it ran out of time. For longer work, have your own code call
  `box.start("<cmd>", { name: "<n>", timeoutSeconds: <s> })` on your own
  timer, with `<s>` set above the run's longest duration (the 600 s default
  would kill it); add `keepAlive: true` only if it goes quiet longer than
  sleepAfter (a timer, a wait over 5 minutes).
- **Snapshots, backups and restores are operations.** `box.snapshots.create()`,
  `box.backups.create()` and both `restore()`s start one and wait until it is
  done; the `…InBackground` verbs answer the `OperationInfo` at once, and
  `Operation.wait(id)` waits for it later, from any process. A wait has no
  end of its own and rides out a dropped connection or a deploy's 503; a
  `timeoutMs` or `signal` you pass stops the wait, never the operation.
  Taking a snapshot or a backup pauses a running sandbox only for the copy —
  seconds — and puts it back; a backup then uploads while the sandbox runs.
  An operation that fails throws `ClientError` `your <kind> <id> failed:
  <why>`: while the sandbox is held awake (a `keepAlive` process, or a hold
  from code inside), `your sandbox was busy…`. Snapshots are faster, kept with the
  sandbox, and named by you. Do not wrap either in a blind retry loop. One
  operation at a time holds a sandbox: another is a 409 whose
  `e.problem?.inProgress` names the one running (s5x's daily backup of the
  volume too, as its detail says): wait on that id. A sandbox
  keeps at most 10 snapshots, and taking one under a name it already has
  replaces that one; a snapshot or backup there is no disk for fails saying
  so: delete a snapshot you no longer need, or try later. **To back up a
  fleet**, call `createInBackground()` per sandbox (reporting a 409 that
  names one already under way, and going on), then read
  `Operation.list({ kind: "backup", status: "unfinished" })` until it is
  empty: one read, not a wait per sandbox. Read the failures with
  `status: "failed", limit: 1000`: a listing holds the newest 100 by default.
- **Snapshots go with `destroy()`, and backups can no longer be restored
  onto a sandbox after it.** A whole backup restores only onto the sandbox
  that took it: a new sandbox with the same name is a different sandbox, and
  `restore` answers 409. `Backup.list()` still lists them and
  `Backup.delete(id)` removes them. To move a sandbox to a new build, promote
  it instead of replacing it.
- **The sandbox is the identity; a volume is a disk.** Keep one sandbox per
  user for the user's life: it resizes (`set({ memMb })`), promotes, restores
  and comes back from a lost machine under the same name, keeping its env,
  vault, logins, header rules, schedules, previews and endpoints. A sandbox created on
  an existing volume is a new sandbox: it gets the disk and nothing else.
  `Volume.backup(name)` backs one volume up alone without ever sleeping its
  sandbox -- it is paused for the milliseconds the copy takes, even under a
  keep-alive -- and holds no memory image. `Volume.restore(backupId, { name,
  replace: true })` puts it back over its volume, whose sandbox boots cold at
  its next wake; without `replace` it makes a NEW volume of any backup's: a
  disk, for any sandbox on its machine.
- **Every volume is backed up every day, automatically**, attached or not,
  at a time of day of its own, as a backup like yours (`BackupInfo.automatic`,
  and `OperationInfo.automatic` while it is taken). It never sleeps or wakes
  a sandbox: a running one has its writes flushed and is paused for the
  milliseconds the copy takes, so the backup holds the volume as a power cut
  at that moment would leave it -- every file written before the flush, and a
  database that recovers as it does from a power cut. A day the volume did
  not change -- detached, or its sandbox asleep or dead, since its last
  backup -- is skipped; a volume detached, or left by a deleted sandbox, is
  backed up once more if it changed. It is no activity of yours (the idle
  clock, `ttlIdle` and `lastActivityAt` are untouched). It gives way to you:
  a backup, restore, snapshot or `erase()` you start before it has begun
  takes its place. Once begun it is an operation like yours: a backup you
  start is refused until it has uploaded, and a restore or snapshot for the
  seconds of its copy -- a 409 whose `inProgress` names it and whose detail
  says it is s5x's daily backup; wait for it (`Operation.wait(id)`), then
  start yours. Each is kept the volume's `backupDays` (7 unless given where
  the volume is made, 0 to 30, `0` for none; `Volume.set(name, { backupDays
  })` changes it) and then deleted (`expiresAt`), except the volume's newest,
  which is kept until a newer one replaces it or the volume is deleted.
  Memory and processes are only in a sandbox's backup, which you take. Every
  backup, yours and these, is encrypted before it leaves the machine, to a key
  of its own.
- **A lost machine** (`info.machineLost`; a call that wakes one is 409
  `code` `machine_lost`): its sandboxes and volumes come back as they were if
  it answers again. A sandbox moves to another machine only once s5x has made
  sure the lost one is off, so two copies never run; until then the 409 says
  so, and a restore or recover elsewhere is refused with it. Once it is off,
  the 409's message names the ways back: `box.backups.restore(id)` of a
  machine backup, one taken with `box.backups.create()` (the newest is
  `(await box.backups.list()).find((b) => !b.volumeOnly)`), moves it to
  another machine with the volumes that backup holds, or, for one with no
  volume, `box.recover()` moves it and starts it fresh from its build. A
  volume's backup, s5x's automatic ones included, never moves the sandbox
  (409 `machine_lost`): its volume comes back alone, as a new volume, at any
  time (`Volume.restore(id, { name })`; the automatic one is at most a day
  old). s5x never moves one by itself, so ask the user before moving one (it
  loses what was written since the backup).
- **`box.erase()` is "delete my account"**: the sandbox and everything
  derived from it -- its vault, logins, header rules, the volumes it holds and their
  snapshots, its own snapshots, schedules, previews, and every backup of it
  and of those volumes, in storage too. It answers what it removed
  (`Removed`), and is refused (409, `inProgress`) while another operation of
  yours runs on the sandbox, and (409 `snapshot_attached`) while a snapshot of
  one of its volumes is attached to another sandbox; s5x's daily backup never
  refuses it, as one under way is waited for and erased with the rest. An
  endpoint pointed at it stays (it is yours), and its log records expire after
  30 days; a volume restored or forked from its volumes is a volume of its
  own, so erase the sandbox holding it too, or delete it. Its volumes attach
  to nothing until it is done. On a machine that does not answer it still
  removes the vault, logins, rules, schedules, previews and backups, then throws: what
  is left is on that machine.
- **Logs never wake the sandbox.** `Logs.query({ sandbox })` reads
  records even after the sandbox is deleted. Once a new sandbox takes the
  name, the name means the new one, so pass the old id (keep
  `(await box.info()).id`, or find it with
  `Logs.sandboxes({ ref: "<name>", deleted: true })` and read it from
  `.sandboxes[i].sandbox`). `job.logs()` on a
  `ProcessHandle` is the live output of one process and does wake it.

## Confirm before destroying

Ask the user before calling any of these. None can be undone:

- `box.destroy()`: the rootfs, running processes, snapshots, vault, logins,
  header rules, env, schedules and previews; its backups can no longer be restored
  onto it. Its volumes survive, detached, each a disk for another sandbox.
- `box.erase()`: all of that, and the volumes it holds with their snapshots,
  and every backup of it and of those volumes, permanently.
- `Volume.delete`: the volume's data and its snapshots, permanently.
- `Volume.detach` with `force`: `"kill"` kills the processes holding the
  volume; `"restart"` restarts the sandbox, ending every process in it.
- `Volume.restore` with `replace: true`: the volume goes back to the backup,
  and everything written to it since is lost; an attached one's sandbox
  boots cold at its next wake, its processes restarting.
- `Template.delete`: that build. Nothing can roll back to it. Refused (409)
  while a sandbox runs it or is promoted to it, or a snapshot or backup of
  yours can restore it.
- `Template.promote`, `box.promote`: processes restart on another
  build, and anything written outside its volumes is replaced. This applies to
  every sandbox of the name (or just this one), at its next wake or at once
  with `{ now: true }`.
- `box.set({ vcpus, memMb })`: its processes restart at its next wake, or at
  once with `now: true`.
- `Endpoint.removeDomain`: the domain stops reaching the endpoint within
  about 5 s, and adding it back waits for its record and its certificate
  again.
- `snapshots.restore`, `backups.restore`: memory, processes, the root
  filesystem and every volume it holds go back to the checkpoint, at its
  build and size (a volume-only backup: the volume alone), and everything
  written since is lost. Env, vault entries, logins, network rules, schedules, previews and
  endpoints are not touched: a restore does not undo a change to those. Both
  wait until the restore is done and answer its `OperationInfo`.

## Reference files

- `references/api.md` — every class, method and option, with return types,
  and every error code.
- `references/patterns.md` — complete, type-checked recipes: a sandbox per user,
  a volume per user, a dataset shared read-only, a fork per experiment,
  changing env on a live sandbox, a long job with streamed output, retries,
  large files, releasing a build to existing sandboxes and rolling it back,
  backups, following logs, and a trusted helper that signs in for an
  assistant.
- `references/guest.md` — calling s5x from inside a sandbox over plain HTTP:
  the vault, logins, schedules, `whoami`, and holds that keep it awake during
  in-VM work; trusted users, which keep an assistant's own code from the
  vault and logins, and where each kind of secret goes; what a volume looks
  like from inside (its growth, a full one, what holds it at a detach); and
  what the sandbox's kernel has (nftables, iptables, Landlock, user
  namespaces).
