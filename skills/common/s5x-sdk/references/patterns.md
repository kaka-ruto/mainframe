# s5x SDK patterns

Complete recipes. Every `ts` block here compiles against the real SDK; lines
starting `declare` stand for values from your own application.

## Contents

- [A sandbox per end user](#a-sandbox-per-end-user)
- [A volume per end user, a dataset shared read-only, a fork per experiment](#a-volume-per-end-user-a-dataset-shared-read-only-a-fork-per-experiment)
- [Run your own service in a sandbox](#run-your-own-service-in-a-sandbox)
- [A trusted helper that signs in for an assistant](#a-trusted-helper-that-signs-in-for-an-assistant)
- [Changing env on a live sandbox](#changing-env-on-a-live-sandbox)
- [Retrying transient failures](#retrying-transient-failures)
- [A long job with streamed output](#a-long-job-with-streamed-output)
- [Timeouts and cancellation](#timeouts-and-cancellation)
- [Moving files, including large ones](#moving-files-including-large-ones)
- [A stable URL for a webhook](#a-stable-url-for-a-webhook)
- [Releasing a build to your sandboxes, and rolling back](#releasing-a-build-to-your-sandboxes-and-rolling-back)
- [Checkpoints and backups](#checkpoints-and-backups)
- [Reading and following logs](#reading-and-following-logs)
- [Scheduled work](#scheduled-work)

## A sandbox per end user

The product shape s5x is built for: every user gets their own VM, which sleeps
when they leave and resumes mid-conversation when they come back.

```ts
import { Sandbox } from "s5x";
declare const anthropicKey: string;

export async function sandboxFor(userId: string): Promise<Sandbox> {
  // Names are 1-63 chars of lowercase letters, digits, . - _. Never lowercase,
  // replace or truncate an id into a name on its own: two users would share
  // one VM. A readable slug plus a hash of the exact id is at most 53 chars,
  // leaving room for a `-suffix` of up to 10 (`${name}-data`) within 63.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const slug = userId.toLowerCase().replace(/[^a-z0-9._-]/g, "-").slice(0, 34);
  const name = `u-${slug}-${hex.slice(0, 16)}`;

  // THE KEY NEVER ENTERS THE SANDBOX. It gets a placeholder, and a header rule
  // sets the real key on every HTTPS request to api.anthropic.com on the way
  // out. Both at create, so both are there from the first boot: the agent has
  // them from its first request, whether the template's entrypoint starts it
  // or you do.
  const box = await Sandbox.createIfNotExists({
    name,
    template: "agent",           // the latest build; a later promote moves this sandbox
    // Their files survive a new build and a replacement. Made by the first
    // create, on the machine the sandbox is placed on, and attached as it is
    // by every create after.
    volumes: [{ volume: `${name}-data`, path: "/data", create: true }],
    sleepAfter: 120,
    ttlIdle: "30d",              // deletes the VM after 30 idle days; the volume stays, so a returning user gets their files back
    env: { ANTHROPIC_API_KEY: "placeholder" },
    network: { headers: [{ host: "api.anthropic.com", name: "x-api-key", value: anthropicKey }] },
  });

  // A sandbox that already existed gets the rule too. Setting the value it
  // already has changes nothing and drops no connection; a NEW value restarts
  // the sandbox's egress proxy, which drops its open HTTP(S) connections, a
  // streaming completion included.
  await box.network.headers.set("api.anthropic.com", "x-api-key", anthropicKey);
  return box;
}
```

`createIfNotExists` applies `env` and `network` only when it creates the
sandbox. That is why the rule is set again on the path that reuses one.

`ttlIdle` never deletes a volume, and neither does `destroy()`: the volume is
detached, and kept, with its daily backups, until you delete it. A returning
user's next `sandboxFor` creates a new sandbox on it. When your product
deletes a user, delete their volume too:
`` await box.destroy(); await Volume.delete(`${name}-data`) ``, or
`box.erase()`, which takes the volume, its snapshots and every backup with
the sandbox. When another operation, such as a backup, still holds the
sandbox, `destroy()` returns while the rest of its deletion finishes on its
own, and the volume stays attached until then: `Volume.delete` answers 409
`volume_attached`, so delete it again a few minutes later.
`Volume.list()` says which sandbox holds each volume (`attachedTo`, `null`
for one no sandbox holds), so a sweep finds the detached ones.

- **Rotating the key**: call `headers.set` once per sandbox with the new value
  — there is no rule shared across sandboxes. It needs no restart: it is in
  force at once on a `running` or `unhealthy` sandbox (an unhealthy one's
  processes may be running), within about 20 s when the reply says `pending: true`, and at the
  next wake on a sleeping one. It drops the sandbox's open HTTP(S)
  connections once, so do it between turns.
- **A sandbox made when the real key went into env still holds it.**
  `env.set("ANTHROPIC_API_KEY", "placeholder")` over the key, and set the rule.
  A wake resumes the entrypoint with the env it started with, so the placeholder
  reaches it only when it starts again after a wake (by itself, or with
  `restart()` once the user agrees, as below) or the sandbox switches builds. If you
  started the agent with `start()`, `kill()` it, `wait()` for it, and start it
  again with
  `box.start("<cmd>", { name: "agent", timeoutSeconds: 0, env: { ANTHROPIC_API_KEY: "placeholder" } })`
  (as in "Changing env on a live sandbox" below; without `timeoutSeconds: 0`
  the restarted agent is killed after 600 s) — an `env.set` on an awake
  sandbox reaches nothing until its next wake. If the template's
  entrypoint runs the agent, restart it after the next wake with
  `box.processes.get("app").restart()`: s5x ends the entrypoint and what it
  started, and runs it again 2 s later with that wake's env (it loses what it
  held in memory and any request in flight: ask the user first). A restart
  before that wake gets the old env again. The placeholder also reaches it
  when its process exits by itself after a wake, and at a
  `box.promote(newBuild, { now: true })` to another build. Never `start()` a
  second copy; meanwhile the rule replaces the header on each connection it
  opens from then on (one already open to the host, on a sandbox with no
  allowlist, keeps the old key until it closes). Either way, rotate the key: set the rule with a new one, and revoke the old key once
  the provider shows it unused. It is in that sandbox's memory image and
  backups, and revoking it is what makes those copies useless.

Why `createIfNotExists`: two requests for the same new user arrive together,
both see 404, both create, and one gets 409. This method treats that 409 as the
answer it was looking for. A hand-written get-then-create fails exactly then —
under load, when nobody is watching. The request that lost the race waits
until the winner has finished creating the sandbox (up to its `timeoutMs`, two
minutes by default), so the handle it gets is ready for `exec`. It throws
`ClientError` if the sandbox is still being created after that, or is being
deleted. Two different sandboxes asking for the same volume is not this race:
one sandbox holds a volume at a time, and the other gets 409
`volume_attached`, naming the holder in `e.problem.sandbox`: give each
sandbox its own volume name.

One sandbox per user means one VM's isolation per user. Do not share a sandbox
between users and separate them by directory.

## A volume per end user, a dataset shared read-only, a fork per experiment

The sandbox per user above holds its user's volume from its first create.
More attach and detach live, running or asleep, up to 4 volumes and 4
snapshots a sandbox, each on the volume's own machine.

**A dataset every sandbox reads.** Fill a volume once, snapshot it, and attach
the snapshot read-only wherever it is needed: one copy on the machine, cached
once, whoever reads it. A snapshot is attached only on its own machine, so
create the readers with it, and they are placed there.

```ts
import { Sandbox, Volume } from "s5x";

// Filled once by a loader sandbox, then frozen into a snapshot.
const loader = await Sandbox.createIfNotExists({
  name: "loader", template: "agent",
  volumes: [{ volume: "dataset", path: "/dataset", create: true }],
});
await loader.exec("tar -xzf /tmp/corpus.tgz -C /dataset");
await Volume.detach(loader, { path: "/dataset" });   // detached, it snapshots without a pause
const snap = await Volume.snapshot("dataset");

// Every reader holds it read-only beside its own volume.
export async function reader(userId: string): Promise<Sandbox> {
  return Sandbox.createIfNotExists({
    name: `r-${userId}`, template: "agent",
    volumes: [
      { volume: `r-${userId}`, path: "/data", create: true },
      { snapshot: snap.id, path: "/dataset" },
    ],
  });
}
```

A new dataset is a new snapshot: attach it at another path, or detach the old
one and attach the new one, then `Volume.deleteSnapshot("dataset", old)` once
no sandbox holds the old (409 `snapshot_attached` until then).

**A fork per experiment.** A fork is a new volume from a snapshot, made at
once, sharing the snapshot's blocks until it is written. Try something
against a copy of a user's data, and throw the copy away.

```ts
import { Sandbox, Volume } from "s5x";
declare const box: Sandbox;           // the user's sandbox, holding u-1 at /data

const snap = await Volume.snapshot("u-1");            // clean: writes held for an instant
const trial = await Volume.fork(snap.id, { name: "u-1-trial", backupDays: 0 });
await Volume.attach(box, { volume: trial.name, path: "/trial" });
const r = await box.exec("cd /trial && ./migrate --dry-run");
await Volume.detach(box, { path: "/trial", force: "kill" });
await Volume.delete(trial.name);
await Volume.deleteSnapshot("u-1", snap.id);
console.log(r.exitCode);
```

- **A detach never pulls a volume from under a process**: while one holds it,
  the detach is refused (409 `volume_busy`, the processes in
  `e.problem.holders`) unless `force` says what to do with them. Stop your own
  processes first, and `force: "kill"` only what you would kill anyway.
- **A volume is attached only on its machine.** To bring a user's data to a
  sandbox elsewhere, restore a backup of it beside that sandbox:
  `Volume.restore(backupId, { name, nextTo: "<sandbox>" })`, then attach it.
- **A snapshot's `usedBytes` is what keeping it costs**: 0 when taken, and
  growing as its volume changes away from it. Delete the ones you no longer
  read.

## Run your own service in a sandbox

Your own service -- the router that creates your users' sandboxes and delivers
their events, say -- can run in a sandbox like any app. Give it a key of its
own (`s5x key create router`), so revoking it stops nothing else, as
`S5X_API_KEY` in `env` at create, and the SDK in it reads the key as it does
anywhere. That env is sealed at rest but readable by any code in that sandbox,
so do this only for your own code, never for a sandbox that runs an agent or
code you did not write. If that service is compromised, make a new key, give
it to the service, and revoke the old one with `s5x key rm`.

## A trusted helper that signs in for an assistant

The shape an assistant platform runs in each user's sandbox: a small helper,
the one user the template trusts, which signs in to the user's websites and
answers a session, never a secret; and everything else, your harness and the
assistant's shell, file tools and browser, as the image's `USER`. The helper
reads the user's website logins; the harness cannot, because it runs as
another user, so no bug in it and no prompt that steers it reaches a
password.

```ts
import { Logs, Sandbox, Template } from "s5x";
declare const name: string;       // the user's sandbox, named as in "A sandbox per end user"
declare const password: string;   // from your user, never logged
declare const totp: string;       // the otpauth://totp/ URI from their authenticator setup

// The image declares USER agent, which the harness and the assistant's tools
// run as, and has a helper user. Its entrypoint runs as root and starts each as
// its own user.
const build = await Template.build({
  image: "ghcr.io/acme/assistant:1.4.0", name: "assistant", trustedUsers: ["helper"],
});
for (const w of build.warnings) console.warn(`assistant build: ${w}`);

const box = await Sandbox.createIfNotExists({
  name, template: "assistant",
  volumes: [{ volume: `${name}-data`, path: "/data", create: true }],
});
// One login per account: a second with the same username and website is a 409.
const logins = await box.vault.logins.list();
if (!logins.some((l) => l.websites.includes("github.com") && l.username === "ada")) {
  await box.vault.logins.set({ websites: ["github.com"], username: "ada", password, totp });
}

// The passwords and codes the helper read, and the refusals, a minute at a time
// (guest.md, "Logins", says what the log does not hold).
const page = await Logs.query({ sandbox: box.name, source: "system", grep: "login_", since: "1d" });
for (const l of page.lines) console.log(l.at, l.action, l.detail);
```

- **The entrypoint is your start script, as root.** It makes the directories
  each user needs (a fresh volume's root stays root's), then starts the
  helper as `helper` and the harness as `agent`. Restart it with
  `box.processes.get("app").restart()`.
- **The helper signs in from a browser of its own**, with
  `POST http://localhost:8081/v1/vault/logins/get` and `/totp`
  (`references/guest.md`, "Logins"), and hands the harness a session file,
  not the password. A worked image, a helper of under 100 lines on a Unix
  socket, and a sealed sign-in with Chrome over `--remote-debugging-pipe` are
  in `references/examples/`, whose `README.md` says how they fit.
- **Change schedules from here**, with `box.schedules`, which checks no
  trusted user: inside, only the helper may, and the harness cannot leave a
  command behind to run later.
- **A rebuild without `trustedUsers` keeps the list**, so the root start
  script keeps working. `trustedUsers: []` clears it, and the entrypoint then
  runs as `USER` again, where a script that starts the helper as another
  user fails.
- **A new password** is `box.vault.logins.set({ id, password })`, and
  `box.vault.logins.delete(id)` deletes a login at once. A process that
  already read a password keeps what it read.

## Changing env on a live sandbox

`env.set` is for later boots, and `start`'s `env` is for now: a running
process keeps the environment it started with, and on an awake sandbox a
process restarted right after `env.set` still gets the old set. So set it for
later, then restart the process with the value passed in, the same name and
the options it was started with:

```ts
import { Sandbox } from "s5x";
declare const box: Sandbox;
declare const token: string;

await box.env.set("SERVICE_TOKEN", token);        // for later boots and wakes
const server = box.processes.get("server");
await server.kill();                              // SIGTERM, which a program can catch or ignore
// a name is refused while it still runs: give it 10 s, then SIGKILL
const ended = await server.wait({ signal: AbortSignal.timeout(10_000) }).catch(() => null);
if (!ended) { await server.kill({ force: true }); await server.wait(); }
await box.start("bun /app/server.ts", {
  name: "server", timeoutSeconds: 0, env: { SERVICE_TOKEN: token },
});
```

The template's entrypoint (`app`) takes no `env` of its own:
`box.processes.get("app").restart()` runs it again 2 s later with the env
pushed at the sandbox's last boot or wake, so a new value reaches it only from
a restart after the next wake (ask first: it loses its in-memory state). If a
value will change on a live sandbox, run the app with `box.start()`. The
entrypoint also starts again with that env when its process exits by itself,
and at a `box.promote(build, { now: true })` to another build, which restarts
every process in the sandbox.

## Retrying transient failures

The SDK does not retry. Retry `retryable` errors (any that carries
`retryAfter`, and a 502, 503, 504 or 524), honour `retryAfter`, and give up
after a few attempts. Whether a retry can help is the server's to say:
everything that clears by itself carries `retryAfter`, and nothing a retry
does not fix is answered 503, so never decide by the text of `e.message`. The
one exception is yours to know: a call that must not run twice.

```ts
import { ApiError } from "s5x";

// 409s that describe a sandbox partway through a change carry retryAfter, so
// `retryable` is true for them: the same call can succeed a moment later, and
// none of them ran a command. Every other 409 is final.
//   still being created        a create is still booting it; a boot can take
//                              a minute or two when it must fetch the build
//   waking or being suspended  a snapshot or promote({ now: true }) found
//                              a wake, a copy or a restore under way
//   could not be woken         this call waited on another call's wake, which
//                              failed; a retry starts a fresh one (if that wake
//                              left it being deleted, the retry gets a 404,
//                              which withRetry then throws)
export async function withRetry<T>(
  fn: () => Promise<T>,
  // mayRepeat: false for a call that must not run twice, such as exec: then
  // only answers given before the command reached the sandbox are retried.
  { attempts = 10, mayRepeat = true }: { attempts?: number; mayRepeat?: boolean } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof ApiError) || attempt >= attempts) throw e;
      // An answer that says when to retry was refused before anything ran. A
      // 502, 503, 504 or 524 without retryAfter can come after it started.
      if (e.retryAfter === undefined && !(mayRepeat && e.retryable)) throw e;
      const seconds = e.retryAfter ?? Math.min(2 ** attempt, 20);
      await new Promise((r) => setTimeout(r, seconds * 1000));
    }
  }
}
```

Ten attempts wait up to about two minutes in all, enough for a boot that has
to fetch its build first.

**Only wrap operations that are safe to repeat, or pass
`{ mayRepeat: false }`.** `createIfNotExists`, reads, and idempotent writes
(`env.set`, `vault.set`, `Endpoint.point`, `fs.writeFile`) are safe. `exec`
and `start` are not: a 500, or a 502, 503, 504 or 524 without `retryAfter`,
can come after the command started, so retrying `box.exec("charge-card")` on
one can run it twice, and retrying `start` can launch a second copy. Wrap them
only in `mayRepeat: false` mode, which retries just the first group below:
`withRetry(() => box.exec(cmd), { mayRepeat: false })`. Do not retry a
snapshot, a backup or a restore by hand either: each is an operation, and its
wait already rides out what passes. A wait you stopped (`timeoutMs`, `signal`)
leaves the operation running, so `Operation.wait(id)` waits for it again, and
a second one started while it runs is a 409 whose `e.problem?.inProgress`
names it.

### Whether a failed `exec` ran

Every way an `exec` can fail falls in one of four groups, each told apart by
its status and whether it carries `retryAfter`, never by its message. Report
each as what it is, and never as "did not run" unless it is in the first two:

- **Did not run, safe to retry:** any answer that carries `retryAfter` — the
  settling 409s above, and a 503 that clears by itself. Each is refused before
  the command reaches the sandbox.
- **Did not run, and fails the same way again:** any other 4xx except 409,
  410 and 422 — a 400, a 404, a 413.
- **Ran:** a result (`timedOut` included), and a 422, whose exit is
  `e.problem?.exit`, typed `unknown`: check it is a number before using it
  ("Timeouts and cancellation" below shows how). Its exit is 124 when the
  command was killed at `killAfterMs` and did not finish, the same as
  `timedOut`.
- **May have run, so never retry it automatically:** a 409 or 410 without
  `retryAfter` (most are refusals, such as a dead sandbox, but the same
  statuses say the sandbox was deleted, suspended, replaced or died while the
  command was running), a 500 (the command may have been sent and no answer
  came back), a 502, 503 or 504 without `retryAfter`, a 524 (no answer within
  about 100 s; the command may still be running), an abort or `timeoutMs` (a
  `DOMException` named `TimeoutError`, or the signal's reason, not an
  `ApiError`), and any other error that is not an `ApiError` (a dropped
  connection).

A 503 with `retryAfter` usually means there is no capacity right now, or the
sandbox is mid-wake: a call that arrives during a snapshot's or a backup's
copy, or while a restore replaces the sandbox -- seconds each -- waits for it
and is then served; one that waits about 30 s gets that 503 (`taking too long
to wake`, or `your sandbox is being restored; try again in a few seconds`).
Waiting the stated time is the fix. While a backup uploads, or a restore's
backup downloads, the sandbox runs on as it is. A call already running inside
the sandbox when a restore replaces it fails with a 409 `this sandbox was
suspended or replaced while the request was running …` or a 500 `the request
could not be completed` (may have run), and anything it did is discarded by
the restore. Do not run commands on a sandbox while you restore it.
Afterwards it is `sleeping`, and the next call wakes it.

A 503 `no host currently has capacity …` or `no host currently has room to
start …` (`code` `no_capacity`) creates no sandbox, and a volume the
call would have created is not kept either, so a retry can be placed
anywhere. Only a volume that existed before the call ties the retry to where
that volume is, so then the retry succeeds once there is room there.

An error from `Sandbox.create`, or from any call that had to wake the sandbox,
can also mean the VM came up but not ready, which leaves the sandbox
`unhealthy`. Its message says why, for you to read; `retryable` says what to do:

- **`did not take its environment`** (`retryable`): call again. Its next wake
  delivers the environment again.
- **`clock could not be set`** (`retryable`): call again. Its next wake sets
  the clock again.
- **`never became ready`** (`retryable`): the guest did not answer its
  readiness probe. Call once more, which checks again; if it happens again,
  read the console log (`Logs.query({ sandbox: name, proc: "console" })`).
- **`volume would not mount`** (not `retryable`): calling again is likely to
  fail the same way. Stop, read
  `Logs.query({ sandbox: name, proc: "console" })`, and report it with
  `e.requestId`. This comes only from a wake, never from `Sandbox.create`. A
  create whose volume will not mount throws `ApiError` 422 `code`
  `volume_mount_failed` (not `retryable`), naming the drive in
  `e.problem.drive`, and the sandbox is removed at once, so its name is free
  again; a volume the create made stays, empty and detached, and a retry with
  `create: true` attaches it. A `recover()` that cannot mount one throws the
  same 422 and leaves the sandbox dead.

The template's entrypoint waits for the env, which arrives only after every
volume is mounted, so the app never starts without either. After one of the
503s above it has not started yet, and the retry that delivers them starts
it.

When `Sandbox.create` throws one of these, the sandbox **still exists**, and
calling `create` again gets a 409 "already exists". So wrap
`createIfNotExists` in `withRetry`, not `create`; to pick the sandbox up, use it
or `Sandbox.get` — its next call wakes it. Left idle, an unhealthy sandbox is
put to sleep like any other and wakes on its next call.

## A long job with streamed output

```ts
import { Sandbox } from "s5x";
declare const box: Sandbox;

// Unbuffered (-u), or the log arrives in blocks and a timeout kill loses the
// tail; stderr merged into stdout, so one stream carries both and can be followed.
const job = await box.start("python3 -u /app/train.py --epochs 20 2>&1", {
  name: "train",
  timeoutSeconds: 4 * 3600,
  // No keepAlive: a job that works keeps the sandbox awake by itself. Add it
  // for one that goes quiet longer than sleepAfter (a timer, a wait over 5 min).
});

let offset = 0;
const done = (s?: string) => s !== undefined && s !== "running" && s !== "starting";
for (;;) {
  const page = await job.logs({ offset });
  if (page.text) console.log(page.text);
  offset = page.offset;         // the server's byte count; feed it straight back
  if (done(page.status)) break;
  await new Promise((r) => setTimeout(r, 1000));
}
// One more read: output written between the last read and the exit.
const tail = await job.logs({ offset });
if (tail.text) console.log(tail.text);

const final = await job.info();
console.log(`exit ${final.exitCode} (${final.status})`);
```

Follow one stream at a time. `stream: "all"` returns both streams whole on
every read, hands your offset back unchanged and carries no `status`, so a
loop on it reprints everything and never ends.

If you only need the result, not the output, `await job.wait()` resolves when
the process ends and polls with a backoff that stays cheap for long jobs.
`wait({ timeoutMs })` bounds the whole wait: past it, `ClientError`, and the
process keeps running. It throws `ApiError` 404 `no such process` if the
process is gone without a result — a switch to another build, `recover()`, or
restoring a checkpoint from before it started ends every `start()` process —
so treat that 404 as "ended, outcome unknown".

`keepAlive` holds the sandbox awake for the process's lifetime, for a job
that goes quiet longer than `sleepAfter`: it can sleep again the moment the
job ends. A job that works keeps the sandbox awake by itself, and a server
that answers requests does not need it either, because each request wakes
the sandbox.

To re-attach to a job after your own process restarted, address it by the
name you gave it: `box.processes.get("train")`. The same name makes two
simultaneous callers share one run: the second `start` throws `ApiError` 400
and starts nothing. After a 400, read `box.processes.get("train").info()`:
`starting` or `running` is the run already going, to follow as above.

## Timeouts and cancellation

Three different deadlines, each for a different thing:

```ts
import { S5X, Sandbox } from "s5x";
declare const box: Sandbox;

// 1. How long the COMMAND may run inside the sandbox (max 60 s for exec).
// exec starts in the image's WORKDIR, like docker exec (/ with none); cd for any other.
const tests = await box.exec("cd /app && npm test", { killAfterMs: 55_000 });
if (tests.timedOut) console.log("killed at 55 s; its output so far:", tests.stdout);

// 2. How long THIS HTTP REQUEST may take, from the caller's side.
await box.fs.readText("/data/big.json", { timeoutMs: 10_000 });

// 3. The default for every request a client makes (700 s unless you set it),
// for every call that is passed it.
const quick = new S5X({ timeoutMs: 30_000 });
await Sandbox.list({ client: quick });

// And an AbortSignal, when the caller's own request is cancelled.
const controller = new AbortController();
const pending = box.exec("sleep 5", { signal: controller.signal });
controller.abort();
await pending.catch(() => { /* aborted */ });
```

**Aborting stops the wait, not the command.** An abort throws the signal's
reason, and a `timeoutMs` expiry a `DOMException` named `TimeoutError`;
neither is an `ApiError`. The sandbox keeps running the command
until it exits or `killAfterMs` kills it (30 s if you set none), and nothing
tells you how it ended: its output is thrown away and no record of the result
is kept. Bound a command with `killAfterMs`, not with `timeoutMs` or a signal,
and never treat an aborted `exec` as one that did not run. For work you may
need to stop partway, use `box.start()` and stop it with `handle.kill()`.

`killAfterMs` over 60 000 is refused — exec is for commands that answer
quickly. Anything longer is `box.start()`. `killAfterMs: 0` is not "never":
it means the 30 s default. A command still running when
`killAfterMs` runs out is killed, and `exec` RETURNS it rather than throwing:
`timedOut: true`, `exitCode` 124, and what it printed before the kill. Do not
retry it blindly — it ran, and the same command runs out the same limit.

The kill is a SIGKILL of the command's whole process group, so only what
reached stdout or stderr comes back: output a program still held in its own
buffer is lost. Python buffers when its output is not a terminal, which here
it never is, so a snippet that printed and then hung returns nothing. Run it
unbuffered (`python3 -u`), and never pipe it through `head`, `sed` or `grep`,
which buffer too (`| head -c N` also kills a chatty program with SIGPIPE
partway through). To cap what comes back, send the output to a file and read
back a bounded amount:

```ts
import { Sandbox } from "s5x";
declare const box: Sandbox;
declare const code: string;
declare function withRetry<T>(fn: () => Promise<T>, o?: { attempts?: number; mayRepeat?: boolean }): Promise<T>;

const file = `/tmp/run-${crypto.randomUUID()}`;
await box.fs.writeFile(`${file}.py`, code);
// Unbuffered, into a file: a kill keeps all it printed, and no amount of output
// can overflow the reply. mayRepeat: false, because the snippet must run once.
const run = await withRetry(
  () => box.exec(`python3 -u ${file}.py > ${file}.out 2>&1`, { killAfterMs: 20_000 }),
  { mayRepeat: false },
);
// A second exec reads back at most 1 MiB; it runs nothing of the snippet's.
const head = await box.exec(`head -c 1048576 ${file}.out; rm -f ${file}.py ${file}.out`);
console.log(run.timedOut ? "timed out" : `exit ${run.exitCode}`, head.stdout);
```

The file is limited by disk, not by the reply. /tmp is on the sandbox's rootfs
(it is not a tmpfs). A build sizes its rootfs from the image: the image
unpacked plus 2 GiB free, at most 20 GiB, and every file and process in the
sandbox shares that free space. Output beyond it makes the snippet's write
fail with ENOSPC, so the snippet is cut short and comes back as an error.
Other writes to the root filesystem fail too until the file is removed (a
mounted volume is a separate disk). Remove the file once it has been read, as
the example does; if a program can print more than that, write the output
under a volume's path instead, if the sandbox holds one: a volume grows by
itself as it fills, up to its `limitBytes`, and past that a write fails with
ENOSPC. The root filesystem does not grow.

Output larger than an exec reply can carry throws `ApiError` 422: the command
ran, and none of its output came back. A command killed at `killAfterMs`
whose output also overflowed comes back the same way, with exit 124 and a
message saying it `was killed at its … time limit`. Its exit status is in the
problem document, whose extension members are typed `unknown`, so narrow it:

```ts
import { ApiError, Sandbox } from "s5x";
declare const box: Sandbox;

try {
  await box.exec("bun /app/report.ts");
} catch (e) {
  const exit = e instanceof ApiError && e.status === 422 ? e.problem?.exit : undefined;
  if (typeof exit !== "number") throw e;
  // It ran, and exited `exit`. Run it again only if it is safe to run twice,
  // with its output sent to a file (`cmd > /data/out.log 2>&1`), and read that
  // with box.fs.readText. Otherwise check what it did.
  console.log(`exit ${exit}; its output was too large to return`);
}
```

The limit is 16 MiB of the JSON reply, not of the output: in that JSON a
quote, a backslash, or `\b` `\f` `\n` `\r` `\t` takes two bytes, a byte
that is not valid UTF-8 takes three (it becomes U+FFFD), and any other control
byte (including the ESC in ANSI escape codes) or U+2028/U+2029 takes six, so
output full of NUL or other control bytes hits the limit at a few MiB. A byte
that is not valid UTF-8 comes back as U+FFFD even when the reply fits, and the
result then has `binary: true`, so treat `stdout` and `stderr` as text only. Send large
or binary output to a file (`cmd > /data/out.log 2>&1`) from the start and read
it with `box.fs.readText`, `box.fs.readFile` (bytes) or `box.fs.readStream`.

## Moving files, including large ones

```ts
import { openAsBlob } from "node:fs";
import { Sandbox } from "s5x";
declare const box: Sandbox;
declare const pngBytes: Uint8Array;
declare const datasetUrl: string;

// Small files, either direction.
await box.fs.mkdir("/data/in");
await box.fs.writeFile("/data/in/logo.png", pngBytes);
const summary = await box.fs.readText("/data/out/summary.md");

// A file on disk of any size, up to 100 GiB: a Blob is read as it is sent.
await box.fs.writeFile("/data/in/model.bin", await openAsBlob("./model.bin"), {
  onProgress: (p) => console.log(p.placing ? "placing" : `${p.sent} / ${p.total}`),
});

// Data that already has a URL: let the sandbox fetch it, detached, because a
// download can outlast exec's 60 seconds. Its traffic keeps the sandbox awake.
const fetchJob = await box.start(`curl -fsSL -o /data/in/dataset.parquet "${datasetUrl}"`, {
  name: "fetch-dataset", timeoutSeconds: 1800,
});
const fetched = await fetchJob.wait();
if (fetched.exitCode !== 0) throw new Error(`download failed: ${fetched.status}`);

// Large results out: stream, never buffer. Reads have no size cap.
const stream = await box.fs.readStream("/data/out/results.tar");
let bytes = 0;
for await (const chunk of stream) {
  bytes += chunk.byteLength;    // write each chunk to disk or pass it on
}
console.log(`${bytes} bytes`);
```

A file over 32 MiB is an upload, sent in parts and then placed; at most 4 go
into one sandbox at once. A fifth `writeFile` throws `ApiError` 429 with
`retryAfter` 5, and `retryable` is true for it: send it again after
`retryAfter` seconds (`withRetry` above does).

A directory: tar it on one side, move the archive, untar with `exec`. On a
Mac, build the archive with `COPYFILE_DISABLE=1 tar czf app.tgz --no-xattrs
-C ./app .`, or it carries `._*` metadata files; untar with `--no-same-owner`
so the files belong to the sandbox's user, not your Mac's uid. In an
image that declares a `USER`, `exec` runs as that user, so `tar -x` needs a
target that user can write. That rules out `/`, and any directory the image's
build left owned by root (`COPY` without `--chown` leaves it root's).
Directories that `box.fs.mkdir` or `box.fs.writeFile` create belong to the
image's user, and so does a volume's mount point. Unpack into one of those,
e.g. `await box.fs.mkdir("/data/app")` and then
`box.exec("tar xzf /tmp/app.tgz --no-same-owner -C /data/app")`.

A file `writeFile` puts there is always mode 0644, so run a script through its
interpreter (`sh /data/app/run.sh`), and never read bytes back through
`exec`'s `stdout`.

## A stable URL for a webhook

An endpoint outlives the sandbox behind it and can be re-aimed, so it is what
you register with Telegram, Stripe or Slack. A preview is for a person to look
at something for a while.

```ts
import { Endpoint, Sandbox } from "s5x";
declare const box: Sandbox;

await box.start("bun /app/webhook.ts", { name: "webhook", timeoutSeconds: 0 });

const ep = await Endpoint.create({
  name: "stripe-hook",
  sandbox: box.name,
  port: 3000,
  public: true,                 // the caller signs its own requests; otherwise omit
});
console.log(ep.url);            // register this; a sleeping sandbox wakes on the first request

// Later, a replacement sandbox takes over the same URL:
await Endpoint.point("stripe-hook", "webhook-v2");
```

Without `public`, a request must carry `ep.token`: `x-s5x-token: <token>`
(use this one if the request also carries your app's own `Authorization`),
`Authorization: Bearer <token>`, or, in a browser, `?_s5x_token=<token>` on
the URL. The token is returned **once**, at creation — store it then. You can
have at most 500 endpoints, and one stays, still counting, after its sandbox
is destroyed until you `delete` it: a product that gives each user an
endpoint deletes it with the user.

For a quick look at a port instead:

```ts
import { Sandbox } from "s5x";
declare const box: Sandbox;

const preview = await box.previews.create(5173, "24h");   // ttl required, max 90d
// The token is shown once. The URL alone answers 401: a person opens this link,
// which also sets a session cookie so the page's scripts and styles load.
console.log(`${preview.url}/?_s5x_token=${preview.token}`);
```

From code, send the token as `x-s5x-token: <token>` or
`Authorization: Bearer <token>` instead.

## Releasing a build to your sandboxes, and rolling back

A build, once ready, is what a NEW sandbox from the bare name gets; it moves no
sandbox that exists. A promote moves every existing sandbox of the name at its
next wake. So a release is: build, try it on a canary, promote. Because new
sandboxes get the build the moment it is ready, the canary does not keep it
from them: a canary that fails has to promote the previous build again, which
makes that one what new sandboxes get.

```ts
import { Sandbox, Template } from "s5x";
declare const gitSha: string;

// What runs now: the rollback target. Save previous.id with the release
// record; once the new build is ready, `latest` is the new build.
const { builds } = await Template.get("agent");
const previous = builds.find((b) => b.latest);

// Resolves once the build is ready; throws ClientError if it fails.
const ready = await Template.build({
  image: `ghcr.io/acme/agent:${gitSha}`, name: "agent",
});
// From here, a NEW sandbox created from "agent" gets this build. Existing ones
// stay where they are until the promote at the end.

// A canary on exactly this build. It is removed even if exec throws, and if it
// did not pass, `latest` goes back to the previous build.
let passed = false;
try {
  const canary = await Sandbox.create({ name: `canary-${gitSha.slice(0, 7)}`, template: ready.id });
  try {
    const check = await canary.exec("bun /app/selftest.ts");
    if (check.exitCode !== 0) throw new Error(`canary failed: ${check.stderr}`);
    passed = true;
  } finally {
    await canary.destroy();
  }
} finally {
  if (!passed) {
    // Like any promote, this also moves sandboxes made from the failed build
    // in the meantime back, at their next wake. With no previous build there
    // is nothing to go back to: delete the failed one before anyone uses it.
    if (previous) await Template.promote("agent", previous.id);
    else await Template.delete("agent", ready.id);
  }
}

// Every existing sandbox switches to it at its next wake.
const p = await Template.promote("agent", ready.id);
console.log(`${p.marked} switching, ${p.already} already on it`);
```

Later, only if the release turns out bad:

```ts
import { Template } from "s5x";
declare const previousId: string;   // `previous.id`, saved at release time

// Sandboxes that switched go back at their next wake; ones that had not switched
// yet just stay.
await Template.promote("agent", previousId);
```

What a switch keeps and restarts is in SKILL.md ("Moving existing sandboxes to
a new build"): tell the user before promoting. Watch the fleet move with
`Template.get(name)`: each build's `sandboxes` rises and `switching` falls. A
`box.start()` process does not survive a switch, so restart it when the build
changed:

```ts
import { Sandbox } from "s5x";
declare const box: Sandbox;
declare let lastSeenBuild: string;

const info = await box.info();
if (info.templateId !== lastSeenBuild) {
  await box.start("bun /app/server.ts", { name: "server", timeoutSeconds: 0 });
  lastSeenBuild = info.templateId;
}
```

One sandbox, now rather than at its next wake — also the only way a sandbox
with `sleepAfter: 0` ever switches:

```ts
import { ApiError, Sandbox, type TemplateBuild } from "s5x";
declare const box: Sandbox;
declare const build: TemplateBuild;   // from Template.get(name).builds

try {
  await box.promote(build.id, { now: true });   // restarts it on that build immediately
} catch (e) {
  // A 409 that recorded the promotion leaves the sandbox naming the build as
  // pending, so it switches at its next wake: busy (held awake: a keepAlive process or a hold; with
  // sleepAfter: 0 that is never -- call again when its work is done), mid-wake
  // (retrying the call switches it now), or dead (recover() it first). Every
  // other 409 changed nothing: a build not finished, or a sandbox still being
  // created.
  if (!(e instanceof ApiError && e.status === 409)) throw e;
  if ((await box.info()).pendingTemplateId !== build.id) throw e;
}
```

A snapshot is a rollback with the processes too: restoring one puts back the
build it was taken on.

## Checkpoints and backups

```ts
import { Sandbox } from "s5x";
declare const box: Sandbox;

// Kept with the sandbox, fast, named by you. Restores processes, memory, disk
// and every volume it holds exactly -- not env, vault, network rules or schedules.
await box.snapshots.create("before-migration");
const migrate = await box.exec("cd /app && bun run migrate", { killAfterMs: 55_000 });
if (migrate.exitCode !== 0) {
  await box.snapshots.restore("before-migration");   // everything since is discarded
}

// Stored apart from the sandbox. Pauses a running sandbox for the copy
// (seconds), then waits while it uploads -- the sandbox runs on -- and
// answers the finished backup.
const backup = await box.backups.create({
  onStatus: (op) => console.log(op.status, op.phase ?? ""),   // queued, running staging, running sending, done
});
console.log(backup.id, backup.bytes);                 // the server names it
// … later, even after moving on. Waits until the restore is done; the
// sandbox is unavailable only for the seconds it takes to replace it.
const restored = await box.backups.restore(backup.id);
console.log(restored.status);                         // "done"
```

Taking a snapshot or a backup, and restoring either, is an operation. One that
fails throws `ClientError` `your <kind> <id> failed: <why>`. A wait has no end
of its own, and rides out a dropped connection or a deploy's 503; a
`timeoutMs` or `signal` you pass stops the wait and not the operation, and
`Operation.wait(id)` waits for it again. One operation at a time holds a
sandbox; another is a 409 whose `e.problem?.inProgress` names the one running,
which can be s5x's daily backup of one of its volumes (the detail says so).

### Backing up a fleet

A fleet's volumes need nothing from you: s5x backs every volume up once a
day, attached or not, encrypted, without sleeping or waking its sandbox,
skipping a day it did not change, and keeps each its volume's `backupDays` (7
unless given; its newest until a newer one replaces it). It is no activity of
yours, and gives way to any backup, restore, snapshot or erase you start
before it has begun; an erase is never refused for one under way. So taking
your own nightly backups as well only doubles them. They list with
`automatic: true`:

```ts
import { Sandbox, Volume } from "s5x";

await Sandbox.create({ name: "u-1", template: "agent",
  volumes: [{ volume: "u-1-data", create: true, backupDays: 14 }] });
const automatic = (await Volume.backups("u-1-data")).filter((b) => b.automatic);
await Volume.set("u-1-data", { backupDays: 30 });
```

For a backup of every whole machine now, start every backup, then follow them
all with one listing of the unfinished ones, rather than holding a wait per
sandbox; of every volume alone, attached or not, the same with
`Volume.backupInBackground(v.name)` for each of `Volume.list()`. A sandbox where a backup,
restore or snapshot is already under way refuses with a 409 naming it in
`e.problem?.inProgress`: report it and go on, rather than retrying. A listing
holds the newest 100 by default, so the failures are read with `limit: 1000`:

```ts
import { ApiError, Operation, Sandbox } from "s5x";

for (const info of await Sandbox.list()) {
  const box = await Sandbox.get(info.ref);
  try {
    await box.backups.createInBackground();
  } catch (e) {
    if (!(e instanceof ApiError && e.problem?.inProgress)) throw e;
    console.error(`${info.ref}: ${e.message}`);
  }
}
while ((await Operation.list({ kind: "backup", status: "unfinished" })).length > 0) {
  await new Promise((r) => setTimeout(r, 30_000));
}
for (const op of await Operation.list({ kind: "backup", status: "failed", limit: 1000 })) {
  console.error(op.ref, op.error);
}
```

Backups queue fairly: every customer's first backup runs before anyone's
second, and only a few run at a time, so a large fleet's backups read
`queued` until their turn. s5x's daily backups queue with them, at most two
at a time on a machine, so one of yours can wait for one of those to upload. An operation is kept for a day after it finishes;
a backup you took for as long as you keep it (`Backup.list()`), an automatic
one until its `expiresAt`.

A backup restores **only onto the sandbox that took it**. `Backup.list()`
still lists backups of sandboxes that no longer exist, but none of them can be
restored onto a sandbox — so a backup is not a way back after `destroy()`;
`Volume.restore()` still makes a new volume of any volume one holds.
Snapshots are deleted with the sandbox. Both survive a promote, and restoring
either puts back the build it was taken on.

A restore puts back memory, processes, the root filesystem and every volume
the sandbox held (a volume-only backup: the volume alone, and the sandbox
boots its own root filesystem cold), and everything written to them since is
lost — a database on a volume included. A machine backup or snapshot restores
only while the sandbox holds what it held then, by drive, path, and volume or
snapshot (409 `volumes_changed` names the difference): one volume comes back
alone with `Volume.restore(id, { name, drive })`, or `replace: true` over its
own.
It does not touch the sandbox's env, vault entries, network rules, schedules,
previews or endpoints, so it cannot undo a change to those: an entry deleted
since stays deleted.

## Reading and following logs

Reading logs never wakes a sandbox. Records (access, audit, system) are kept
by s5x and outlive the sandbox, readable by its id if a new sandbox has taken
its name. Process output (`proc`/`stream`) is kept with the sandbox and goes
with it, so reading it after `destroy()` is a 410.

```ts
import { Logs } from "s5x";

// What was refused or went wrong in the last two hours — records take
// since/level/grep. "warn" keeps 4xx refusals too; "error" only 5xx and deaths.
const problems = await Logs.query({ sandbox: "u-4411", since: "2h", level: "warn" });
for (const l of problems.lines) console.log(l.at, l.action ?? l.route, l.status);

// What the app printed — process output takes proc/stream/limit only.
const app = await Logs.query({ sandbox: "u-4411", proc: "app", stream: "stderr", limit: 100 });
for (const l of app.lines) console.log(l.text);

// The VM's own console, when the guest itself died.
const consoleLog = await Logs.query({ sandbox: "u-4411", proc: "console", limit: 200 });
console.log(consoleLog.lines.map((l) => l.text).join("\n"));

// Follow until the caller stops. An abort mid-poll rejects with an AbortError.
const stop = new AbortController();
setTimeout(() => stop.abort(), 60_000);
try {
  for await (const line of Logs.follow({ sandbox: "u-4411", proc: "app" }, { signal: stop.signal })) {
    console.log(line.text);
  }
} catch (e) {
  if (!stop.signal.aborted) throw e;
}
```

`since`, `until`, `level` and `grep` apply to records only; combining them with
`proc` or `stream` is a 400. Filter process text yourself.

## Scheduled work

```ts
import { Sandbox } from "s5x";
declare const box: Sandbox;

await box.schedules.add({
  name: "digest",                                // unique on this sandbox
  cron: "CRON_TZ=Europe/Berlin 0 7 * * 1-5",     // UTC without the prefix
  command: "bun /app/daily-digest.ts",
});

// Once, at an instant: it runs, then stays as a disabled record with its run.
await box.schedules.add({
  name: "remind-8812",
  at: new Date(Date.now() + 5 * 86_400_000),
  maxLateness: "2h",                             // later than this: too_late, nothing woken
  command: "bun /app/remind.ts 8812",
});

// Try it now. run() only queues it: it starts at the next poll and its run is
// recorded when it finishes, so wait for the occurrence it queued.
const { schedule } = await box.schedules.run("digest");
let last;
for (let i = 0; i < 150 && !last; i++) {
  await new Promise((r) => setTimeout(r, 2_000));
  last = (await box.schedules.runs("digest", { limit: 1 }))
    .find((r) => Date.parse(r.scheduledAt) >= Date.parse(schedule.nextRunAt));
}
console.log(last?.outcome, last?.exit, last?.output);
```

A schedule wakes the sandbox, runs the command — for five minutes at most,
from the image's `WORKDIR` (`/` with none, or one missing at run time) — and
records how it went. A command is at most 4096 bytes; put a longer script in a
file and schedule `sh /path/to/job.sh`. A name is unique on its sandbox, so every
user's sandbox can have its own `digest`. `add` refuses a name that already
exists there (409): change one in place with
`box.schedules.set(name, { cron, at, command, enabled, maxLateness })`.

**Every occurrence is recorded, and delivery is at least once.** Read
`outcome` before `exit`:

| `outcome` | meaning | `exit` |
|---|---|---|
| `ran` | the command ran | its exit code |
| `not_run` | the sandbox is dead or being deleted; `reason` says which | null |
| `too_late` | it could not start before the occurrence's lateness ran out: the sandbox could not be woken -- its host short of memory, say -- or its wake took that long | null |
| `unknown` | it started and its answer was lost, so it may have run | null |

An occurrence whose sandbox cannot be woken is tried again, with growing
waits, until its lateness runs out: by default the next occurrence (an hour
for a one-shot), or `maxLateness`; one longer than the interval folds the
occurrences it covers into that one try. A sandbox runs at most four of its
schedules at once, and the rest wait. A run can happen twice -- its answer lost,
or the platform restarted under it -- so a command that must not act twice,
such as a message to a user, keeps what it sent keyed on `S5X_SCHEDULE_ID` and
`S5X_SCHEDULED_AT` (the schedule's `id` and the run's `scheduledAt`) and skips
a pair it has seen.

**A herd is spread over its minute; spread it wider yourself.** A 5-field or
`@daily`-style cron runs at a second of its minute fixed for its sandbox (0 to
59, shown in `nextRunAt`), so ten thousand users' `0 7 * * *` fall due across
07:00, not all in its first second; an `@every` runs from when it was made. A minute is still a herd for that many: pick each user's minute from a
hash of their id (`7` and a minute from 0 to 29, say) so their sandboxes wake
across half an hour. A one-shot `at` runs at its instant.
