# s5x SDK — API reference

Every public class and method, with its options and return type. Methods whose
last argument is options accept `{ signal?: AbortSignal; timeoutMs?: number }`
there (`RequestOptions`), and every static also accepts `client?: S5X`
(`CallOptions`); both are omitted below to keep lines short. `Logs.follow`
takes `{ intervalMs?, signal?, client? }`.

## Contents

- [Configuration](#configuration)
- [Sandbox](#sandbox)
- [box.fs](#boxfs)
- [box.processes and ProcessHandle](#boxprocesses-and-processhandle)
- [box.env](#boxenv)
- [box.network](#boxnetwork)
- [box.vault](#boxvault)
- [box.schedules](#boxschedules)
- [box.previews](#boxpreviews)
- [box.snapshots](#boxsnapshots)
- [box.backups](#boxbackups)
- [Operation](#operation)
- [Template](#template)
- [Endpoint](#endpoint)
- [Volume and Backup](#volume-and-backup)
- [Logs](#logs)
- [Errors](#errors)
- [Types](#types)

## Configuration

| | |
|---|---|
| `configure({ apiKey?, fetch?, timeoutMs? })` | sets the default every static uses when it is not passed `{ client }`. For one key per process: call it once, at startup. A later call changes only later calls; a sandbox handle already returned keeps its key |
| `new S5X({ apiKey?, fetch?, timeoutMs? })` | a client: a key, and nothing else. Pass it to any static as `{ client }`, for several keys in one process or a key per request or per customer (calling `configure()` per request races between requests) |
| `whoami()` | `{ id, name, key: { id, name, via } }`: whose API key this is, and which key (`via` is `login` for one `s5x login` made, named for its machine, `key` for one `s5x key create` made for a server, and `operator` for one s5x issued); the cheapest check that a key is good |

With nothing configured, the default reads the environment the first time a
call needs it, never at import time.

`apiKey` falls back to `S5X_API_KEY`. Every call goes to `https://api.s5x.dev`,
and no option or variable changes that. `timeoutMs` is the default per-request
deadline, 700 000 ms, so a large file transfer can
finish. A request the API has not begun to answer within about 100 s fails
sooner, with `ApiError` 524, whatever this is set to. A method that waits
keeps this limit on each request it makes, so a poll that stalls past it
throws a `TimeoutError` before the wait's own deadline. `fetch` swaps the
implementation, for tests. The key is kept in a private field, so logging or
serializing a client or a sandbox never shows it.

## Sandbox

### Statics

Each takes an optional `client` in its options; without it, the default.

| | Returns |
|---|---|
| `Sandbox.create(opts: SandboxCreateOptions)` | `Sandbox`, running. 409 `sandbox_limit`, nothing created, when you already have your account's limit of sandboxes (100 unless s5x set another) |
| `Sandbox.get(name)` | `Sandbox`; `ApiError` 404 if it does not exist. A read; does not wake it |
| `Sandbox.fromName(name)` | `Sandbox`, made without a request (not async). For a sandbox you know exists, such as one per end user: saves `get`'s read on every call. A missing one is the first call's `ApiError` 404; `"."` or `".."` throws `ClientError` at once |
| `Sandbox.createIfNotExists(opts: SandboxCreateOptions)` | `Sandbox` — race-safe get-or-create. If another caller is still creating it, waits for that to finish, up to `timeoutMs` (default two minutes); throws `ClientError` if it is still being created then |
| `Sandbox.list()` | `SandboxInfo[]`: every sandbox you have, in one response (no paging); a read, wakes nothing |
| `Sandbox.usage()` | `Usage`: what your sandboxes are using right now |

`SandboxCreateOptions`:

| Field | Type | |
|---|---|---|
| `name` | `string` | required; your name for it, unique among your sandboxes (the API's `ref`) |
| `template` | `string` | required; `name` (its latest promoted build), `name@<8–64 hex digest>`, or `tpl_…`. No tags: `name:tag` is a 400 |
| `env` | `Record<string,string>` | environment for the guest |
| `sleepAfter` | `number` | whole seconds with nothing happening in it -- no CPU work, no data in or out, no request of its own waiting on an answer, no call from you in flight -- before it sleeps; 30 by default. `0` never sleeps; anything else is at least 5 (`ClientError` below, before any request). It sleeps within about 4 s past it, and no sooner than 5 s after a call that needed the VM (an `exec`, a file or process call, a wake) ends. Room for sandboxes that never sleep is limited: past it, 409 `there is no room right now for another sandbox that never sleeps. Give it an idle timeout …` — give it one, or try again later |
| `ttl` | `string \| null` | delete it this long from now (`"24h"`, `"7d"`), busy or not, unless it is `dead` |
| `ttlIdle` | `string \| null` | delete after this long idle, unless it is `dead` |
| `region` | `string` | omit for any region with capacity; an unknown one is refused with the list |
| `vcpus`, `memMb` | `number` | its size; 1 vCPU and 2048 MB by default (a template has none). At least 256 MB, at most 4 vCPUs and 8192 MB (a 400 past either, naming both: `vcpus must be at most 4: the largest sandbox is 4 vCPUs and 8192 MB`), and no larger than any machine can hold (a 400 `… (at most N MB); give it a memMb of N or less`, not retryable). Every build saves its ready image at the default, so another size boots the build's root filesystem cold: seconds, not milliseconds |
| `volumes` | `AttachSpec[]` | what it holds from its first boot, at most 4 volumes and 4 snapshots: `{ volume, path?, create?, backupDays? }`, a volume read-write, or `{ snapshot, path }`, a snapshot read-only (see [Volume](#volume-and-backup)). Every one is mounted before its app starts; one that will not mount fails the create (422 `volume_mount_failed`, its `drive` named), and a volume the create made stays, empty and detached, for the retry. All on one machine (409 `volumes_on_different_hosts`), which the sandbox is placed on. A sandbox created on an existing volume is a new sandbox: it gets the disk and nothing else (no vault, rules, env or schedules of the one before). Like `env`, `createIfNotExists` applies it only when it creates the sandbox |
| `network` | `{ allowedHosts?: string[], headers?: {host, name, value}[] }` | from the first boot: reach ONLY these exact hosts, and these header rules (see `box.network`). Like `env`, `createIfNotExists` applies it only when it creates the sandbox. |
| `client` | `S5X` | use that client's API key, not the default |

A create's own refusals about volumes: 400 `bad_path` (a path given twice,
or one inside or above another of the request), `bad_name`,
`too_many_volumes`, and a plain 400 for an entry that is both or neither a
volume and a snapshot, a volume or snapshot named twice, or `create` or
`backupDays` on a snapshot; 404 `volume_not_found`, `snapshot_not_found`; 409
`volume_attached` (with `retryAfter` while the sandbox holding it is being
deleted: it is free within minutes), `inProgress` (a restore or erase of the
volume is unfinished), a plain 409 for a `region` other than an existing
volume's (a volume never moves), `volume_cap`;
503 `no_capacity`. Attach and detach more later with `Volume.attach` and
`Volume.detach`; a size changes with `box.set({ vcpus, memMb })`.

### Instance

| | Returns | |
|---|---|---|
| `box.name` | `string` | |
| `box.lastInfo` | `SandboxInfo \| undefined` | what the server last answered about the sandbox, without a request: every call that answers a `SandboxInfo` (`create`, `get`, `info()`, `set()`, `recover()`, `promote()`, and `Volume.attach` and `Volume.detach` given this handle) refreshes it; undefined on a `fromName` handle until one of them answers |
| `box.info()` | `SandboxInfo` | fresh read; does not wake it |
| `box.exec(command, { killAfterMs? })` | `ExecResult` | waits; `killAfterMs` default 30 000, max 60 000, and `0` means the default, not "never". A command still running at the limit is killed with its whole process group (SIGKILL) and this RETURNS `timedOut: true`, `exitCode` 124 and what reached its output; a program's own buffer is lost, so run Python as `python3 -u`. `binary: true` means the output held bytes that are not UTF-8, which came back as U+FFFD: copy files with `box.fs.readFile`, not through exec. A negative `killAfterMs` is a 400. Output too big for the reply throws `ApiError` 422 (the command ran; its exit is `e.problem?.exit`, typed `unknown`: see [Errors](#errors). If it was also killed at `killAfterMs`, that exit is 124. The 422 has no `timedOut` member, so treat that exit as you treat `timedOut`); a request over 1 MiB throws `ApiError` 400 and runs nothing. See below |
| `box.start(command, StartOptions)` | `ProcessHandle` | detached |
| `box.set({ sleepAfter?, ttl?, ttlIdle?, vcpus?, memMb?, now? })` | `SandboxInfo` | `null` clears a deadline. How long a volume's automatic backups are kept is the volume's: `Volume.set(name, { backupDays })`. `vcpus`/`memMb` change its size IN PLACE (leave one out to keep it): the answer has `pendingVcpus`/`pendingMemMb`, and it boots its own disk cold at that size -- processes restart -- at its next wake after a sleep that held nothing; `now: true` does it at once (sleeping it first). 409 `your sandbox never sleeps, so a size change applies only with now` for `sleepAfter: 0` without `now`; 409 `the sandbox is busy; try again when its work finishes; <ref> keeps its new size and changes to it at its next wake` for `now: true` while it is held awake (a `keepAlive` process or a hold), and the size stays pending (`pendingVcpus`/`pendingMemMb`) until its next wake; 409 `this sandbox is dead … <ref> keeps its new size, and its recover boots it at that size.` for `now: true` on a `dead` one: `recover()` it; 409 (`inProgress`) while a restore runs; 400 past the ceilings, as `Sandbox.create`'s (at most 4 vCPUs and 8192 MB); 400 `your sandbox's machine holds at most N MB; pick a size of N MB or less`; 503 `code` `no_capacity` when its machine's disk has no room for a memory image that size now (`retryable`); 409 `machine_lost` on a lost machine. A boot at the new size that does not come up leaves it `dead` with its disk intact: set a size it runs at and `recover()` |
| `box.destroy()` | `{ finished }` | `finished: false` when the deletion carries on without it (see below), and then its volumes stay attached until it ends. Its volumes survive, detached, with their snapshots and backups (each is backed up once more if it changed, then by its `backupDays`); its own snapshots are deleted, and its backups can no longer be restored onto it. Its name is free when this resolves, so a create of the same name can follow at once. If another operation, such as a backup, still holds the sandbox, the rest of the deletion finishes on its own within a few minutes; this does not wait for it |
| `box.recover()` | `SandboxInfo` | for a `dead` sandbox, or one that still reads awake (`running` or `unhealthy`) but whose VM has stopped: same disk, fresh boot, and only the entrypoint restarts; start `start()` processes again. s5x does this by itself for a sandbox whose VM dies awake: at every wake, however many tries failed before (any call wakes it and tries at once -- one that still reads awake too, once a call finds its VM gone, as after its machine restarts -- and calls at the same moment share one try: it is answered by the fresh boot, or a `retryable` 503 `… call it again to try once more`), and on its own for one that never sleeps, until five tries fail (`recovery_failed` with `detail.final`). **A dead sandbox is kept, with everything it has, until you recover or delete it.** One whose guest still answers is refused (409 `only a dead sandbox can be recovered; this one is running and answering`), and so is one whose VM is up but whose guest does not answer (409 `… its VM is up but not answering …`): it may only be busy, so wait and call it again; if it never answers, `recover({ force: true })` restarts it from its disk and ends every process in it, so ask the user first; a sleeping one needs no recover, since any call that needs the VM wakes it. 503 `your sandbox is waking or going to sleep; try again in a moment` and 503 `could not check whether the sandbox is still answering; retry shortly` are `retryable`: retry after `retryAfter`. A boot that is not ready throws a 503 and leaves it `dead`: call `recover()` again. 409 `there is no room right now to bring back <ref> as a sandbox that never sleeps …`: the sandbox has `sleepAfter: 0`, but its disk is intact. Call `box.set({ sleepAfter: 300 })`, then `recover()` again (this is a change followed by a new call, not a retry). The other way out of `dead` is to restore a snapshot or backup (`snapshots.restore(name)`, `backups.restore(id)`). That brings the processes back as they were at the checkpoint but overwrites everything since, so ask the user first. Every volume and snapshot it holds must mount: one that will not is 422 `volume_mount_failed` naming its `drive`, and it stays dead; detach that one with `Volume.detach(box, { path, force: "restart" })`, which recovers it without it, or restore a backup of it. **On a lost machine** (`machineLost`), once s5x has made sure that machine is off (until then it is 409 `machine_lost`, which says so), a sandbox with no volume is moved to another machine and started fresh from its build (its old rootfs stays on the lost machine; ask the user first), and one holding a volume is 409 `machine_lost`: restore a machine backup instead (`backups.restore`; a `volumeOnly` one does not move it) |
| `box.promote(build, { now? })` | `SandboxInfo` | move to another build of its template: at its next wake, or `now: true` immediately. `now` is refused (409) while it is busy (a keep-alive, which is not a guard), waking or dead, and the message then ends `<ref> stays promoted to <build> and switches at its next wake`: tell that 409 from one that changed nothing by `(await box.info()).pendingTemplateId`, which then names the build. `build` is a digest or `tpl_` id. The switch boots the new build: only the image's entrypoint comes back, `start()` processes must be started again, and files outside its volumes are lost; its volumes, env, vault, schedules, previews, endpoints, `box.network` header rules and allowlist, snapshots, backups and its size stay (one not at the default boots cold) |
| `box.shell({ cols, rows }?)` | `ShellConnection` — `{ url, headers, resizeMessage(cols, rows) }` | for a WebSocket terminal; Node `ws` and Bun can send the headers, browsers cannot (Node 20 has no global WebSocket: `import WebSocket from "ws"`). The URL alone is answered 401. An open shell keeps the sandbox awake and pauses its `ttlIdle` clock until it closes; close it when you are done. See below |

`StartOptions`: `name?` (address it by this instead of a generated one: 1-64
of `[A-Za-z0-9._-]`, not `.` or `..`, and not `app` or `console`; while a process by that name is
`starting` or `running`, a second `start` with it throws `ApiError` 400
`a process named "<name>" is already running` and starts nothing. Other 400s from `start`
(a bad name, a `cwd` that is not a directory, a request over 1 MiB) mean
nothing started either, so to join the run already going, read
`box.processes.get(name).info()` after a 400: `starting` or `running` is
that run, and `wait()` and `logs()` follow it. Once that process has ended, the name is free and a
new `start` replaces it and its logs), `cwd?` (default the image's
`WORKDIR`, like `docker exec`; `/` with none, or one missing at run time), `env?` (added for
this process, on top of the sandbox's env as of its last boot or wake),
`timeoutSeconds?` (default 600, `0` never), `keepAlive?` (hold the sandbox
awake while it runs, for a process that goes quiet longer than `sleepAfter`:
a timer, a wait over 5 minutes; one that works keeps it awake by itself.
Under memory pressure it can be overridden, and s5x wakes the sandbox again once its host has room).

Out of memory, the kernel kills what `exec` and `shell` launched first; a
`start` process ranks level with the entrypoint, and nothing restarts it once
killed (the console log, `Logs.query({ sandbox, proc: "console" })`,
shows the kill).

**`exec`'s limits.** The request — the command as JSON, escaping included — is
capped at 1 MiB: over it, `ApiError` 400
`request body is larger than 1048576 bytes`, and nothing runs (`start` has the
same 1 MiB cap, counting its `env`, and answers 400 `request body is too large`). Write a long script with `box.fs.writeFile` and
exec the file. A `killAfterMs` over 60 000 is a 400
`a command's time limit is at most 60s (60000 ms) …`: use `start()`. The reply
is capped at 16 MiB of JSON for `stdout` and `stderr` together, where a quote,
a backslash, or `\b` `\f` `\n` `\r` `\t` counts two bytes, a byte that is
not valid UTF-8 counts three (it becomes U+FFFD), and any other control byte
(including the ESC in ANSI escape codes) or U+2028/U+2029 counts six — so
output full of NUL or other control bytes can hit the 422 under 3 MiB. A byte
that is not valid UTF-8 comes back as U+FFFD even when the reply fits, and the
result says so with `binary: true`: `stdout` is text. Never move file bytes
through `exec`; use `box.fs.readFile`.
`exec` starts in the image's `WORKDIR`, like `docker exec`; with no `WORKDIR`, or
one that is missing at run time, it starts in `/`. It has no `cwd` option, so
use `cd /path && …`. Its stdin is `/dev/null` (so is a
`start` process's), so a program that reads input gets EOF at once, not a
hang: Python's `input()` raises `EOFError`. To give it input, write the input
with `box.fs.writeFile` and redirect it in the command
(`python3 -u /abs/snippet.py < /abs/input.txt`); no `< /dev/null` is needed.

**The shell.** `box.shell()` opens nothing: open a WebSocket to `url` with
`headers`. Binary messages are the terminal, both ways: send keystrokes,
receive output (set `binaryType = "arraybuffer"`). The size is `{ cols, rows }`
at open, 80x24 if you leave it out, and `TERM` is `xterm-256color`. Send
`resizeMessage(cols, rows)` as a text message when your terminal changes size;
any other text message closes the session with code 1003. When the shell
exits, the server sends one text message after its last output, `{"exit": N}`
with the shell's exit status, then closes with code 1000. A close with another
code carries a reason saying why the session ended: 1001 with
`the sandbox was deleted`, `the sandbox was restored or restarted, …` or
`the sandbox stopped unexpectedly; …`, or 1011 with
`the connection to the sandbox was lost; open a new shell`. A close with
neither code 1000 nor a reason is a lost connection, and the shell ended with
it.

A terminal client for Node, with the `ws` package. It is plain JavaScript
because `ws` is not part of this package, so unlike the `ts` blocks it is
not type-checked:

```js
import WebSocket from "ws";

const sh = box.shell({ cols: process.stdout.columns, rows: process.stdout.rows });
const ws = new WebSocket(sh.url, { headers: sh.headers });
ws.binaryType = "arraybuffer";
ws.on("message", (data, isBinary) => {
  if (isBinary) process.stdout.write(Buffer.from(data));   // terminal output
  else process.exitCode = JSON.parse(String(data)).exit;   // {"exit": N}, then a 1000 close
});
ws.on("close", (code, reason) => {
  if (code !== 1000) console.error(`shell ended: ${String(reason) || "connection lost"}`);
  process.exit();                                        // with the shell's status, if it sent one
});
process.stdout.on("resize", () =>
  ws.send(sh.resizeMessage(process.stdout.columns, process.stdout.rows)));
process.stdin.setRawMode?.(true);                      // keys go through as typed
process.stdin.on("data", (keys) => ws.send(keys));   // a Buffer: sent as a binary message
```

## box.fs

Named after `node:fs/promises`. Paths are absolute inside the guest; a relative
one is `ApiError` 400. A path is only ever a file in the sandbox:
`/data/../etc/hosts` names `/etc/hosts`. A path that is not there is an
`ApiError` 404 with `code` `file_not_found` (a 404 without a code is about the
sandbox), a call on a path of the wrong kind (a directory where a file is
meant, a file that exists, say) an `ApiError` 409, and a write to a full disk
a 507. The message is the sandbox's own sentence, such as `open /data/x: no
such file or directory`.

| | Returns | |
|---|---|---|
| `readFile(path)` | `Uint8Array` | buffers the whole file |
| `readText(path)` | `string` | |
| `readStream(path)` | `ReadableStream<Uint8Array>` | for anything large |
| `writeFile(path, data: string \| Uint8Array \| Blob, { onProgress? })` | `{ path, bytes }` | whole or not at all, and on disk once it resolves (a crash of the sandbox or its host does not lose it); `.s5x-partial-*` names are its temporary files (a write to one is refused, 400; one a crash left is removed by the next write there); up to 100 GiB; pass a `Blob` for a file on disk (`openAsBlob`, `Bun.file`). Over 32 MiB it is an upload: its parts go straight to storage and it is then placed, an [operation](#operation) this waits for; `onProgress({ sent, total, placing })`. At most 4 uploads into one sandbox at once: a fifth is `ApiError` 429 with `retryAfter` 5, and your uploads in progress together hold at most 1 TiB (429, `retryAfter` 30). A failed placement throws what a direct write would (a full drive is 507); a part storage would not take is a `ClientError` naming it, with nothing written. The API being away (a 502, 503 or 504, a dropped connection) is ridden out for two minutes while parts are signed and the file completed, and a complete whose answers were lost is settled by reading its operation: a `writeFile` that throws can be sent again, and wrote nothing unless you aborted it after every part was sent or the sandbox's disk failed as the placed file was made durable (the file may then be in place). `timeoutMs` is per request, `signal` for the whole write; an abort once every part is sent stops the wait, not the placement. Always mode 0644, even over an executable; the owner is kept, or is the image's `USER` for a new file |
| `list(path)` | `DirEntry[]` | |
| `mkdir(path)` | `void` | |
| `rm(path, { recursive? })` | `void` | removes a file or an empty directory; with `recursive: true`, a directory and everything in it. `ApiError` 404 if nothing is at `path`, recursive or not; a recursive remove of `/` is refused (`ApiError` 400) |

## box.processes and ProcessHandle

| | Returns |
|---|---|
| `box.processes.list()` | `Process[]` |
| `box.processes.get(name)` | `ProcessHandle` (no request made) |

`ProcessHandle` — returned by `box.start` and `processes.get`:

| | Returns | |
|---|---|---|
| `handle.name` | `string` | |
| `handle.lastInfo` | `Process \| undefined` | what `start`, `info()` or `wait()` last answered, without a request; undefined on a handle from `processes.get` until one of them answers |
| `handle.info()` | `Process` | |
| `handle.wait({ intervalMs?, maxIntervalMs?, timeoutMs? })` | `Process` | resolves when it is no longer `starting`/`running`; polls with capped backoff, and each poll marks the sandbox active. `timeoutMs` bounds the whole wait: past it, `ClientError`, and the process keeps running. `ApiError` 404 (`no such process`, `code` `process_not_found`) if the process no longer exists: a switch to another build, `recover()`, or restoring a snapshot or backup taken before it started ends every `start()` process. Treat that 404 as "ended, outcome unknown" |
| `handle.logs({ stream?, offset? })` | `{ text, offset, status? }` | `stream`: `"stdout"` (default), `"stderr"`, `"all"`. Pass the returned `offset` back to read only what is new. `"all"` returns both streams whole every time, hands your `offset` back unchanged and has no `status`, so it cannot be followed: poll one stream, or merge them in the command (`2>&1`) |
| `handle.kill({ force? })` | `void` | SIGTERM; `force: true` is SIGKILL. Refused for `app`, the image's entrypoint (`ApiError` 400): restart it with `restart()` |
| `handle.restart()` | `void` | for `app` alone, the image's entrypoint, whoever it runs as: s5x ends it and every process it started (SIGTERM, then SIGKILL to what is still running 5 s later), and it starts again 2 s after, with the env of the sandbox's last boot or wake. Any other name is `ApiError` 400: stop a `start()` process with `kill()` and start it again. A process the entrypoint left running in the background, re-parented to PID 1 (a daemon that forked away), is not its child and outlives the restart |

`offset` is the server's byte count, not a string length — always feed back
the number you were given.

## box.env

| | Returns | |
|---|---|---|
| `env.set(name, value)` | `void` | reaches processes started after the sandbox's next boot or wake — on an awake sandbox, not even a process restarted right after it; pass the value to `start({ env })` for that |
| `env.list()` | `string[]` | names only; values are never readable |
| `env.delete(name)` | `void` | |

## box.network

Header rules (a credential set on the way out, never held by the sandbox) and
an optional allowlist. Both in force at once on a `running` or `unhealthy`
sandbox (an unhealthy one's VM, and its processes, can be up; the change
restarts its proxy like any other), and from the next wake on a sleeping one.
None of these wake a sleeping sandbox. `pending: true` means saved, and in
force within about 20 s — a success, not something to retry.

| | Returns | |
|---|---|---|
| `network.get()` | `{ allowedHosts: string[] \| null, headers: {host, name}[] }` | rules by name, never values; `allowedHosts: null` is anywhere. Header names come back canonical (`X-Api-Key`) |
| `network.headers.set(host, name, value)` | `{ host, name, pending }` | set `name: value` (the whole value, so `Authorization` needs `Bearer …`) on every HTTPS request to exact `host`, replacing what the sandbox sent. Plain HTTP never gets it. Setting it again replaces the value; setting the value it already has changes nothing and drops no connection. 409 `that limit is reached; delete something first` past 20 rules (replacing a value is never refused) |
| `network.headers.delete(host, name)` | `{ host, name, pending }` | 404 if there is no such rule |
| `network.allow(hosts)` | `{ allowedHosts, pending }` | reach only these exact hosts, plus rule hosts; `[]` is rule hosts only, `null` lifts it. At most 100 hosts |

What a rule does, and the limits every sandbox has, are in SKILL.md
("Credentials"); the details:

- **A TRACE or TRACK to a rule's host is refused (405)** and never sent: its
  answer would hold the header.
- **A host is one exact name**: no wildcard, IP address or port (400). A rule
  on `anthropic.com` does nothing for `api.anthropic.com`. `Host`,
  `Content-Length`, `Connection` and the other framing headers cannot be set
  (400), and a value is one line of at most 8 KiB.
- **Only HTTPS on port 443 carries a rule.** HTTPS on another port leaves with
  the placeholder, or is refused under an allowlist.
- **The client must trust the proxy's certificate.** Anything that reads the
  image's CA bundle does (OpenSSL, Go, curl, git). So do Node and Bun, through
  `NODE_EXTRA_CA_CERTS` (the CA alone, added to their built-in roots; Node
  does not read `SSL_CERT_FILE`), and Python requests/httpx, through
  `REQUESTS_CA_BUNDLE`/`SSL_CERT_FILE` (the image's bundle, with the CA
  appended by the build). Node and Bun lose it if the image's `ENV` or the
  sandbox's `env` sets one of those itself to a file without the proxy's CA
  (that value wins), or if a launcher that clears the environment starts them:
  `su -`, `sudo` without `--preserve-env`, `env -i`, or a cron daemon in the
  image. Every call to a rule host then fails with
  `UNABLE_TO_VERIFY_LEAF_SIGNATURE`: pass `NODE_EXTRA_CA_CERTS=/s5x/egress-ca.pem`
  through, or run `node --use-system-ca`. The JVM and binaries with compiled-in
  roots (Rust's `webpki-roots`) do not trust it and fail verification on every
  call to a rule host: keep their credential in `env`, and set no rule for that
  host.
- **The proxy speaks HTTP/1.1 to the sandbox**, so a gRPC (HTTP/2-only) client
  cannot call a rule host. A WebSocket (`wss://`) to a rule host works: its
  opening request gets the rule's header like any other, and the connection
  is then relayed both ways for as long as it stays open.
- **A rule's host must present a publicly trusted certificate**: for an
  internal or self-signed one, every request gets 502
  `s5x: the upstream could not be reached`. Other HTTPS is relayed untouched.
- **A protocol where the server speaks first** (SSH to `ssh.github.com:443`,
  say) works on 80 and 443 while the sandbox has header rules and no
  allowlist: after about 2 s of silence from the client, the proxy relays the
  connection untouched, so it takes 2 s longer to open. Under an allowlist it
  is refused.
- **An allowlist lets out only TCP 80 and 443**, to a listed host or a rule
  host. HTTPS is judged by its TLS server name, so a client that sends none (a
  bare IP address) is refused; a refused HTTPS connection gets a TLS
  `access_denied` alert (curl and OpenSSL say `tlsv1 alert access denied`, Node
  `alert access denied`, Bun `TLSV1_ALERT_ACCESS_DENIED`). Plain HTTP is judged
  request by request on its `Host`, and an unlisted one gets a 403. Refusals
  are not written to `Logs`. A pinned address (`/etc/hosts`,
  `curl --resolve`) is ignored: the proxy connects to the name through its own
  resolver. Everything else
  the sandbox opens is refused at once: a database port, SSH, HTTPS on another
  port, DNS to any resolver but the sandbox's own. Lookups through that
  resolver (public, 1.1.1.1) can still name any domain, a narrow channel the
  allowlist does not close. Listing `db.example.com`
  does not let Postgres through. `http://localhost:8081/v1` (vault, schedules, holds) keeps working,
  and requests into the sandbox through previews and endpoints are not
  affected. It needs no rebuild. To have it from the first boot, pass
  `network.allowedHosts` to `Sandbox.create`.
- **QUIC (UDP 443) is refused** while a sandbox has any rule or an allowlist;
  clients fall back to TCP.
- **Each change restarts the egress proxy** of a sandbox that already has
  rules or an allowlist. The proxy carries ports 80 and 443, so connections
  through it drop and clients must reconnect; a new allowlist also cuts
  connections open on other ports.
- **Without an allowlist, a connection opened before a sandbox's first rule
  skips it until it closes.** It goes out directly, with whatever the process
  sent. With an allowlist, the first rule restarts the proxy and the
  connection drops.
- **None of these calls lifts the limits every sandbox has** (port 25, private
  ranges, the connection rate and counts: SKILL.md). Under an allowlist, a
  mail provider's API host has to be listed.
- **Rules belong to the sandbox alone**: a sandbox created on an existing
  volume starts with none, and a volume a backup is restored into carries
  none.
  Promote and restore keep them.

## box.vault

What code in the sandbox must read or update itself -- the tokens from an
OAuth flow it runs, a refresh token it rotates, a webhook secret it generates
and checks -- and reads with no credential at
`http://localhost:8081/v1/vault/get` (`references/guest.md`). It is the
sandbox's alone and ends with it. An API key the sandbox only spends belongs in
a `box.network.headers` rule, which nothing in the sandbox holds.

| | Returns | |
|---|---|---|
| `vault.set(key, value, { ifVersion? })` | `{ version }` | with `ifVersion`, only if the entry is still at that version, so a writer that read, refreshed and writes back cannot overwrite a newer value: `ApiError` 409 means it changed since (read it again and retry), 404 that the key is gone. A key is 1-127 letters, digits, `.`, `-`, `_` or `/`, starting with a letter or digit; a value is at most 65 520 bytes (a vault is for credentials, not storage) |
| `vault.get(key)` | `{ key, value, version }` | 404 when the key is not set |
| `vault.list()` | `VaultEntry[]` — keys and versions, no values | |
| `vault.delete(key)` | `void` | |

An error saying `secrets are unavailable because of a fault on s5x's side, so nothing was read or stored …`
changed nothing. `this value cannot be read …` is about one value. Neither is
`retryable`, and a retry fails the same way: contact s5x support.

### box.vault.logins

Website logins: a username and password for one or more websites, and
optionally a TOTP seed, which your trusted helper types into the site's sign-in form.
Written here; read inside the sandbox only by its template's trusted users
(`Template.build({ trustedUsers })`), at `http://localhost:8081/v1/vault/logins/...`
([guest.md](guest.md#logins)), where s5x computes each TOTP code so the seed
never enters the sandbox. **There is no `get`**: no call from outside, API,
SDK or CLI, returns a password or a seed.

| | Returns | |
|---|---|---|
| `logins.set(input: LoginInput)` | `Login` | without `id`, creates one: `websites` and `password` are required. With `id`, changes that login, sending only what is given: a `password` or `totp` replaces the stored one, and `totp: null` removes the seed. Answers the login without its secrets. 400 for a field out of bounds (below), `this TOTP seed is not valid`, or `this request is not valid JSON`, each a fixed sentence that quotes nothing you sent; 404 for an `id` the sandbox has no login of; 409 `this sandbox already holds 100 logins, the limit; delete one first`; 409 `<website> already has a login with that username, lg_…` |
| `logins.list()` | `Login[]` | every login of the sandbox, never a password or seed |
| `logins.delete(id)` | `void` | at once; 404 for an `id` the sandbox has no login of |

- **`websites`**: 1 to 10 hostnames, lowercase, each a valid DNS name, with no
  scheme, port, path or wildcard. `example.com` is also found for
  `www.example.com`; nothing else is implied.
- **`username`** up to 256 bytes, `""` for none; **`password`** 1 to 1024
  bytes; **`hint`** up to 500 bytes, for your own notes, not secret.
- **`totp`**: an `otpauth://totp/` URI, or a bare base32 seed (SHA-1, 6
  digits, 30 s). It is read when set: 6 to 8 digits, a period of 15 to 120 s,
  SHA-1, SHA-256 or SHA-512.
- **Two logins with one username never list the same website**, or a website
  and its `www.` form (`""` counts as one username), so inside, a website and
  a username always find one login at most.
- **At most 100 logins a sandbox.** Like its vault, they are the sandbox's: a
  promote, a resize and a restore keep them; `destroy()` and `erase()` delete
  them (`erase()` counts them in `removed.logins`).
- **A login is named in the body, never the path**, so request logs never hold
  a website list.

Reads inside are recorded in the sandbox's system log, counted per minute
(`login_read`, `login_code`, `login_refused`), within the bounds
[guest.md](guest.md#logins) states:
`Logs.query({ sandbox, source: "system", grep: "login_" })`.

## box.schedules

| | Returns | |
|---|---|---|
| `schedules.add({ name, cron \| at, command, maxLateness?, enabled? })` | `Schedule` | `cron`: 5-field, `@daily`, `@every 15m`; UTC unless prefixed `CRON_TZ=Zone/City`, where a fixed hour runs once on every local day across DST. A 5-field or `@daily`-style cron runs at a second of its minute fixed for the sandbox (0 to 59, shown in `nextRunAt`), so the same cron on many sandboxes is spread across the minute; `@every` runs from when it was made. `at`: a `Date` or an RFC 3339 string with its offset -- runs once, then stays as a disabled record (`completedAt`) that does not count toward the cap; up to 5 minutes past runs at once, further past is 400. `maxLateness` (`"30m"`, 1m to 7d): how late an occurrence may still start. `command` runs from the image's `WORKDIR` (`/` with none, or one missing at run time) and is at most 4096 bytes: put a longer script in a file and schedule `sh /path/to/job.sh`. Each run gets five minutes, then is killed and recorded as exit 124. At most 100 schedules per sandbox |
| `schedules.list()` | `Schedule[]` | this sandbox's only |
| `schedules.set(name, { cron?, at?, command?, maxLateness?, enabled? })` | `Schedule` | change it in place, keeping its history; `cron` and `at` replace each other; `maxLateness: null` puts the default back. A one-shot that has run is 409 |
| `schedules.run(name)` | `{ schedule, nextPollAt }` | queued: it starts at the dispatcher's next poll, `nextPollAt`, and its run is recorded when it finishes |
| `schedules.runs(name, { limit? })` | `ScheduleRun[]` | every occurrence, newest first, with its `outcome`; without `limit`, every one kept (up to 50) |
| `schedules.delete(name)` | `void` | |

A schedule's name is unique on its sandbox: each of your sandboxes can have
its own `nightly`. `delete`, `run`, `runs` and `set` act only on this
sandbox's schedule of that name; one it does not have is `ApiError` 404
`<ref> has no schedule named <name>`. If the sandbox itself no longer exists,
every one of these, `list` included, is `ApiError` 404
`sandbox "<ref>" does not exist`. `add` refuses a name this sandbox already
has with `ApiError` 409 `this sandbox already has a schedule named "x"`; change
that one with `set`, or pick another. Code that adds a schedule every time it
runs must `list()` first, since the second `add` of the same name is that 409.

Every occurrence is a `ScheduleRun` with an `outcome`: `ran` (`exit` is the
command's), `not_run` (the sandbox is dead or being deleted), `too_late` (it
could not start before its lateness ran out -- by default the next
occurrence, or an hour for a one-shot), or `unknown`
(it started and its answer was lost, so it may have run). `reason` says why
for all but `ran`, whose `exit` is the only one not null. Delivery is at least
once: dedupe on the schedule's `id` with the run's `scheduledAt`, which the
command sees as `S5X_SCHEDULE_ID` and `S5X_SCHEDULED_AT`.

## box.previews

| | Returns | |
|---|---|---|
| `previews.create(port, ttl)` | `Preview` | `ttl` required, greater than zero, max `"90d"`; `port` 1-65535, but not 8081 (the guest agent's). The result carries `url` and a `token` shown once |
| `previews.list()` | `Preview[]` | |
| `previews.delete(id)` | `void` | |

A preview is always token-guarded and dies with the sandbox. For a URL that
must outlive it, use an endpoint.

`url` alone answers 401. A request carries the token one of three ways:

- **In a browser**, `` `${preview.url}/?_s5x_token=${preview.token}` ``. That
  first visit sets a session cookie for the preview's hostname, valid 12 hours
  at most and never past the preview's expiry, so the page's scripts, styles
  and fetches load too. Opening the same link again renews it.
- **From code**, the header `x-s5x-token: <token>`. Use this one when the
  request also carries the app's own `Authorization`.
- **From code**, `Authorization: Bearer <token>`.

**What the app receives.** s5x reads `Authorization` only when it is
`Bearer` followed by an s5x token (they start `pv_` for a preview, `ep_` for
an endpoint), and removes only that. Any other `Authorization` -- the app's
own JWT or API key -- reaches the app exactly as sent, on a public endpoint
and behind a token alike. The s5x token never reaches the app in any form.
The app is told `x-s5x-sandbox` (the sandbox id), `x-s5x-route` (`preview` or
`endpoint`) and `x-s5x-route-id` (that preview's or endpoint's id). Every
other `x-s5x-*` header a caller sends is removed, so an app can trust the
ones it gets.

**When s5x refuses a request**, the answer is `application/problem+json` and
carries an `x-s5x-refused` header whose value is also the problem's `code`
member. An error your app returns itself never carries that header, so its
presence tells an s5x refusal from the app's own 502 or 503. The codes are
stable; the `detail` sentence may change. Every 503 below was not delivered
to the app, so sending it again after `Retry-After` seconds is safe.

| Status | `code` | Meaning |
|---|---|---|
| 401 | `token_invalid` | the token is missing or wrong |
| 403 | `suspended` | s5x suspended the sandbox or its account; nothing is delivered until s5x lifts it, so retrying changes nothing |
| 404 | `not_found` | no preview or endpoint has this address |
| 409 | `detached` | the endpoint's sandbox was deleted; point it at another |
| 410 | `expired` | the preview has expired |
| 502 | `unavailable` | s5x could not route the request just now; retry shortly |
| 502 | `port_reserved` | the port is one s5x never serves (8081, the guest agent's) |
| 502 | `no_response` | the app took the request and closed the connection or did not answer; it was **not** sent again, because the app may have acted on it |
| 503 | `port_closed` | nothing accepted a connection on the port: within 10 s (the app is not running, still starting, or listens on `127.0.0.1`), or the app stopped accepting just before the request reached it (it crashed); nothing was delivered |
| 503 | `wake_failed` | the sandbox was asleep and could not be woken just now |
| 503 | `waking_no_capacity` | the sandbox is asleep and its machine has no room to wake it just now; nothing was delivered |
| 503 | `creating` | the sandbox is still being created |
| 503 | `deleting` | the sandbox is being deleted |
| 503 | `dead` | the sandbox is dead and a request does not wake it: `box.recover()` |
| 503 | `not_running` | the sandbox is not running for another reason |
| 503 | `moved` | the endpoint was pointed at another sandbox a moment ago; send it again |
| 503 | `not_resent` | an upload the app refused in the moment before it was sent; send it again |

## box.snapshots

Taking a snapshot and restoring one are [operations](#operation): the plain
verbs wait until it is done, and the `…InBackground` ones answer the
`OperationInfo` at once. Every wait takes `{ onStatus?, intervalMs?,
timeoutMs?, signal? }` (`WaitOptions`) and has no end of its own.

| | Returns | |
|---|---|---|
| `snapshots.create(name, WaitOptions?)` | `OperationInfo`, done | kept with the sandbox, fast, named by you (1-64 letters, digits, `.`, `-`, `_`, starting with a letter or digit, not ending `.staging` or `.previous`); a snapshot of the same name is replaced. Pauses a running sandbox for the copy -- seconds, the `staging` phase -- and then it runs on. `ClientError` `your snapshot snp_… failed: <why>` if it fails: normally because the sandbox held a keep-alive (under memory pressure the copy goes ahead, the job frozen while it is taken), or because its VM was found gone (recover it). 409 (`inProgress`) while another operation holds the sandbox, or a restore from that snapshot runs |
| `snapshots.createInBackground(name)` | `OperationInfo`, `queued` | the same, answered at once |
| `snapshots.list()` | `Snapshot[]` | |
| `snapshots.restore(name, WaitOptions?)` | `OperationInfo`, done | puts back memory, processes, the root filesystem and every volume it held as they were at the snapshot, and everything written since is lost. Env, vault entries, network rules, schedules, previews and endpoints are not touched. Only while the sandbox holds what it held then, by drive, path, and volume or snapshot: 409 `volumes_changed` names the difference (a snapshot it held that has since been deleted never matches: restore the volumes alone, `Volume.restore`). The sandbox runs on as it is while the snapshot is copied (`staging`), and is unavailable for the seconds it takes to replace it (`committing`); calls made then wait. `ClientError` `your restore rs_… failed: <why>` if it fails. 404 for a snapshot that does not exist; 409 if the build it was taken on has since been deleted, or while another operation holds the sandbox (`inProgress`) |
| `snapshots.restoreInBackground(name)` | `OperationInfo`, `queued` | the same restore, answered at once: wait with `Operation.wait(id)` |
| `snapshots.delete(name)` | `void` | `ApiError` 404 if there is no snapshot of that name; 409 (`inProgress`) while an unfinished operation names it |

## box.backups

Operations too, as a snapshot's are.

| | Returns | |
|---|---|---|
| `backups.create(WaitOptions?)` | `BackupInfo` | its machine and every volume it holds read-write, stored apart from the sandbox (one volume alone is `Volume.backup`); the server mints the id, which is the operation's too. Waits until it is taken, then answers the backup: `queued`, then `staging` (a running sandbox is paused for the seconds the copy takes, and put back), then `sending` (the sandbox runs on), then done. `ClientError` `your backup bk_… failed: <why>` if it fails: a process in it held a keep-alive (`your sandbox was busy: …`; under memory pressure the copy goes ahead, the job frozen while it is taken), there was not enough room to take it, the upload stalled. Past a `timeoutMs` you pass, `ClientError` `… it carries on: Operation.wait("bk_…") waits for it again`. 409 while another backup is unfinished or a restore or snapshot holds the sandbox: `e.problem?.inProgress` names it; wait on that. It can be s5x's daily backup of one of its volumes, once begun (the detail says so); one not yet begun gives way to yours, which takes its place |
| `backups.createInBackground()` | `OperationInfo`, `queued` | the same backup, answered at once. For a fleet: one of these per sandbox (a 409 naming `e.problem?.inProgress` is a sandbox with one under way: report it and go on), then `Operation.list({ kind: "backup", status: "unfinished" })` until it is empty, and `Operation.list({ kind: "backup", status: "failed", limit: 1000 })` for the failures |
| `backups.list()` | `BackupInfo[]` | finished backups of this sandbox, newest first. Every backup of one volume, its daily ones (`automatic: true`) and the sandbox backups holding it, is `Volume.backups(name)` |
| `backups.restore(id, WaitOptions?)` | `OperationInfo`, done | puts back memory, processes, the root filesystem and every volume it held as they were at the backup, at its build and its size (a pending promotion or resize is cancelled) -- or, for a `volumeOnly` backup, the volume alone, and the sandbox boots its own rootfs cold with it at its next wake -- and everything written since is lost. A machine backup restores only while the sandbox holds what it held then, by drive, path, and volume or snapshot: 409 `volumes_changed` names the difference, and one volume of it comes back alone with `Volume.restore(id, { name, drive })`. On a lost machine, once s5x has made sure that machine is off (until then it is 409 `machine_lost`), a machine backup moves the sandbox to another with the backup and the volumes it holds, dropping what it holds that the backup does not; env, vault entries, network rules, schedules, previews and endpoints are not touched. A `volumeOnly` one, s5x's automatic ones included, is 409 `machine_lost` there: it comes back only as a new volume, `Volume.restore(id, { name })`. `queued`, `downloading` (the sandbox runs on as it is), `committing` (unavailable for seconds; calls made then wait and are served by the restored sandbox), done. `ClientError` `your restore rs_… failed: <why>` if it fails. **Only onto the sandbox that took the backup** — any other sandbox, including a replacement with the same name, gets 409. 404 for a backup not yet taken or one that failed; 409 if the build it was taken on has since been deleted, or while another operation holds the sandbox (`inProgress`) |
| `backups.restoreInBackground(id)` | `OperationInfo`, `queued` | the same restore, answered at once |
| `backups.delete(id)` | `void` | 409 while it is still being taken, or while a restore from it runs |

## Operation

Every backup, restore and snapshot, and every file over 32 MiB being placed by
`writeFile`, is an operation: one record, `OperationInfo`, read and waited on
the same way whatever it is. An operation is kept for a day after it finishes.

| | Returns | |
|---|---|---|
| `Operation.get(id)` | `OperationInfo` | as it stands now; 404 for an id you have no operation of, or one that finished more than a day ago |
| `Operation.list({ kind?, status?, limit? })` | `OperationInfo[]` | newest first. `kind`: `"backup"`, `"restore"`, `"snapshot"` or `"upload"`; `status`: `"unfinished"` (uploading, queued or running), `"done"` or `"failed"`; `limit` 1-1000, default 100. One read follows a whole fleet |
| `Operation.wait(id, WaitOptions?)` | `OperationInfo`, done | `ClientError` `your <kind> <id> failed: <why>` if it fails; 404 at once for an id you have no operation of |

`WaitOptions` is `{ onStatus?(op), intervalMs?, timeoutMs?, signal? }`, the
same for every wait on an operation. `onStatus` is called once for each status
and phase the operation reaches, the first look included. It looks after
`intervalMs` (default 1 s), then half as long again each time, up to 15 s. A
look that fails in passing (a dropped connection, a 502, 503 or 504, or a
`retryAfter`) is taken again, after `retryAfter` when the server says; any
other error ends the wait. **There is no default timeout**: every operation
ends, and one past its limit is failed. `timeoutMs` and `signal` end the wait,
never the operation.

## Template

| | Returns | |
|---|---|---|
| `Template.build({ image, name, trustedUsers?, onStatus?, intervalMs? })` | `TemplateBuild`, ready | waits until the build is ready: until then the bare name still gives new sandboxes the previous build. It waits as an operation's wait does (from every second to every 15 s, through a failure in passing, `onStatus` hearing each status once), and ends when the build does: a build that runs past 30 minutes is failed. Throws `ClientError` on `failed`, with the build's `error` (why it failed) at the end of its message, and past a `timeoutMs` you pass, which is not a failure — see below. `image` must be in a registry s5x can pull from. Once ready it is what the name gives a NEW sandbox (the later build wins, whichever finishes first); it moves no existing sandbox until promoted. **A template has no size**: the size is given at the sandbox's create (`Sandbox.create({ vcpus, memMb })`). Its root filesystem, /tmp included, is sized from the image: the image unpacked plus 2 GiB free, at most 20 GiB; an image that does not fit in that with its 2 GiB free fails the build. A create can also name one build exactly (`"name@<digest>"` or its `tpl_` id). Can throw a retryable 503 `too many builds are already running` (`retryAfter` 30). `trustedUsers` names the users of the image, or `@group`s, at most 16, that may read the vault and logins or change schedules from inside its sandboxes; root always may and is never named. With it the image must declare a `USER` it does not trust, its entrypoint runs as root, and the build fails naming an entry the image does not have, root, `nobody`, or a `USER` that is missing, root or trusted. Left out, a build keeps its name's last build's list; `[]` clears it. See [the in-sandbox reference](guest.md#trusted-users) |
| `Template.buildInBackground({ image, name, trustedUsers? })` | `TemplateBuild`, `pending` | the same build, answered at once without waiting: for code that cannot hold a connection that long, such as a request handler. Keep the build it answers (its `name` and `id` are enough) and call `waitUntilReady(build)` later. `timeoutMs` is this one request's |
| `Template.waitUntilReady({ name, id }, { onStatus?, intervalMs?, timeoutMs? })` | `TemplateBuild` | reads that one build until it is `ready`, as `build` does: pass what `buildInBackground` answered, or its template `name` and its `id`. A build passed as `pending` or `building` is first read after `intervalMs` (a build's status only moves forward), and `onStatus` hears each status after the one passed; any other is read at once. What it answers is always the build as read, never the object passed. Throws `ClientError` on `failed`, with the build's `error` (why it failed) at the end of its message, and past a `timeoutMs` you pass, which is not a failure — see below. A build that does not exist, such as a mistyped `id`, throws `ApiError` 404 at its first read |
| `Template.get(name)` | `TemplateInfo` — `{ name, builds: TemplateBuild[] }` | every build of one name, newest first, with `latest`, `sandboxes`, `switching` and `expiresAt` |
| `Template.list()` | `TemplateBuild[]` | every build of every name, in one flat list |
| `Template.promote(name, build)` | `Promotion` — `{ name, templateId, digest?, marked, already }` | new sandboxes get `build`, and every sandbox of the name switches to it at its next wake. **Rollback is promoting the older build.** A sandbox keeps its size; one not at the default switches cold |
| `Template.delete(name, build)` | `{ name, templateId, digest, freedBytes }` | the build deleted, with its digest however you named it (`null` for a build that never became ready), and the bytes of disk freed. By digest or `tpl_` id; refused (409) while a sandbox runs or is promoted to it, while a snapshot or backup of yours can restore it (`your snapshot <name> of <sandbox> restores …` or `your backup bk_… restores …`), and for `latest` while the name has another build |

s5x keeps every build in use, the 20 newest builds of each template, and
anything built in the last 30 days; other builds are deleted 30 days after
they were built. In use means a sandbox runs it or is promoted to it, it is
the name's latest, a snapshot or backup of yours can restore it (a backup only
while the sandbox it was taken from exists, since it restores onto nothing
else), or an operation in progress needs it. `expiresAt` says when each other
build is deleted.

Use an image with a shell and the usual tools (alpine, debian). A distroless
or scratch build succeeds and boots too; `exec`, `start()` and `box.shell()`
then run in s5x's own minimal shell.

**A timeout from `build` or `waitUntilReady` is not a failed build.** Without
a `timeoutMs` they wait until s5x finishes the build or fails it, which it does
past 30 minutes (`the build did not finish within 30 minutes`, or `the build
was interrupted on s5x's side; build it again` when s5x stopped running it on
its side). With one,
`build tpl_… was still building after …ms` means it is still running; it is
the newest build in `Template.get(name)`. Do not call `build()` again — that
starts a second build. Wait for it with `Template.waitUntilReady(build)`.

Some `error` reasons are s5x's, not the image's:
`no build host is available right now`, `could not run on its build host`
or `could not be stored` ("a fault on s5x's side, not in the image"),
`the build was interrupted on s5x's side; build it again` and
`refused before it started: too many builds are already running`. Build the
same image again; nothing in it needs fixing. The refused
attempt still appears in `Template.list()` and `Template.get()` as a failed build. s5x deletes
failed builds a day after they started (`expiresAt`).

## Endpoint

A stable hostname that outlives the sandbox behind it, which is why it is not
on `box`.

| | Returns | |
|---|---|---|
| `Endpoint.create({ name, sandbox, port?, public? })` | `EndpointInfo` | `name` is 1-40 lowercase letters, digits or dashes, not starting or ending with a dash: it becomes part of a hostname. `port` 1-65535 but not 8081, default 80. The `token` is returned once, unless `public`; a request presents it the ways a preview's does (`?_s5x_token=` in a browser, `x-s5x-token` or `Authorization: Bearer` from code). At most 500 endpoints: past that, `ApiError` 409 `you already have 500 endpoints, the limit; delete one first`. An endpoint stays after its sandbox is destroyed, and still counts toward the 500, until you `delete` it |
| `Endpoint.list()` | `EndpointInfo[]` | |
| `Endpoint.point(name, sandbox)` | `EndpointTarget` | re-aim at another sandbox; `""` detaches. Same URL, same token. Takes effect within about 5 s |
| `Endpoint.delete(name)` | `void` | takes effect within about 5 s, and removes its domains too |
| `Endpoint.addDomain(endpoint, domain)` | `DomainInfo` | serve the endpoint at `domain` too, once a CNAME from it to the endpoint's hostname (`target`) is seen; `pending` until then. The name is lowercased and turned to IDNA (`www.bücher.de` is `www.xn--bcher-kva.de`). 400 `domain_invalid` (not a hostname under a public suffix of at most 64 characters, a wildcard or an IP address), `domain_apex` (an apex cannot hold a CNAME: use `www.`), `domain_ours` (an s5x name); 404 for an endpoint that does not exist; 409 `domain_exists` (on one of your endpoints already: a domain belongs to one) or `domain_limit` (20 an account, in every state) |
| `Endpoint.domains()` | `DomainInfo[]` | every domain of yours, in every state, by name |
| `Endpoint.checkDomain(domain)` | `DomainInfo` | look for its CNAME now, a `failed` one restarting with a fresh 7 days, and answer where it stands. Within 10 s of its last look, and for one `issuing` or `active`, it answers the domain as it stands. 404 for a domain you do not have |
| `Endpoint.removeDomain(domain)` | `void` | stops serving it within about 5 s. 404 for a domain you do not have |

A `DomainInfo` is `domain`, `endpoint`, `state` (`pending`, `issuing`,
`active` or `failed`), `reason` (what s5x saw, in your terms; null when there
is nothing to say), `target` (the CNAME's value), `url` (`https://<domain>`,
serving once `active`), `since` (when it entered its state), `checkedAt` and
`createdAt`. `issuing` is already served while Cloudflare makes its
certificate. Another account's domain is a 404, like a missing one.

## Volume and Backup

A volume is a read-write ext4 disk on one machine, which outlives the
sandboxes it is attached to. One sandbox holds it at a time, and only on its
machine. It is made by an attach with `create: true` (or that entry in
`Sandbox.create({ volumes })`), by `Volume.fork`, or by `Volume.restore`. A
snapshot (`vsn_…`) is a clean, read-only copy of one, on its machine, attached
to any number of sandboxes there. A volume is a disk: a sandbox created on it
is a new sandbox. Wherever a call takes a volume's `name`, it takes its `vol_`
id too. A name is 1-63 lowercase letters, digits, dots, dashes or
underscores, starting with a letter or digit, and may not start `vol_` or
`vsn_` (400 `bad_name`). Every lookup is your account's: another account's
volume, snapshot or backup is a 404, like a missing one.

**It has no size.** A new volume is a 2 GiB filesystem that grows on its own,
online, as it fills (2, 4, 8, … 64, 128, 192 GiB …), to its `limitBytes`: the
lesser of 1 TiB and a quarter of its machine's disk past the margin s5x keeps
free on it. What you delete is given back to the machine, so `usedBytes`, what
it is billed, falls; the filesystem itself never shrinks. All your volumes and snapshots together hold at most your
account's cap, 1 TiB unless s5x support raised it. At either limit, and for
as long as its machine has no room to grow it, a write gets ENOSPC, disk full,
never an I/O error; at the cap a new volume is refused too, 409 `volume_cap`.
A writer faster than it grows, or one that reserves more than
half of it at once (`fallocate`), can meet ENOSPC until its next step.

`AttachSpec`, what `Volume.attach` and each entry of `Sandbox.create({ volumes
})` take:

| Field | Type | |
|---|---|---|
| `volume` | `string` | a volume, by name or `vol_` id, attached read-write at the lowest free drive, `rw0`-`rw3` |
| `snapshot` | `string` | instead of `volume`: a snapshot (`vsn_…`) of one, attached read-only at `ro0`-`ro3` |
| `path` | `string` | where it is mounted: absolute, at most 255 bytes, not `/`, not under `/s5x`, `/proc`, `/sys` or `/dev`, neither inside nor above another attachment's of the sandbox. `/data` for a volume unless given; a snapshot names its own. Mounted over a directory that has files, it hides them until it is detached |
| `create` | `boolean` | make the volume, on the sandbox's machine, if you have none of that name; one you have is attached as it is. Without it a missing name is 404 `volume_not_found`. Never with a `vol_` id: no volume is made under an id |
| `backupDays` | `number` | how many days each automatic backup of a volume this makes is kept: 7 unless given, 0 to 30, `0` for none (`ClientError` past them, before any request). One that exists keeps its own |

| | Returns | |
|---|---|---|
| `Volume.attach(box \| name, AttachSpec)` | `SandboxInfo` | attach a volume or a snapshot to a running or sleeping sandbox, which is woken for it; its app sees it mounted when this answers. A `Sandbox` handle's own client is used, and its `lastInfo` refreshed. Refused, with nothing attached: 400 `bad_path`, `bad_name`; 404 the sandbox, `volume_not_found`, `snapshot_not_found`; 409 `path_in_use` (its path is, or is inside or above, another attachment's), `drives_full` (4 of that kind already), `volume_attached` (another sandbox holds it: `e.problem.sandbox` and `.path` say where), `snapshot_attached_here`, `volume_on_another_host` (a volume or snapshot on another machine: create a sandbox with it, or restore a backup of it `nextTo` this one, or fork the snapshot there), `machine_lost`, `sandbox_dead` (`recover()` it first), `volume_cap`, `inProgress` (a backup, restore or snapshot is unfinished); 422 `volume_mount_failed` (the guest would not mount it, in the kernel's words; `e.problem.drive`); 503 `no_capacity` (`create` with no room on the sandbox's machine), and a plain 503 when its machine stayed busy (`retryable`) |
| `Volume.detach(box \| name, { path, force? })` | `SandboxInfo` | unmount what is at `path`, and free it. 409 `volume_busy` while processes in the sandbox hold it: `e.problem.holders`, at most 32, each `{ pid, command, uses }` by the first way it holds it (`cwd`, `root`, an open `file`, a memory `map`, the `device`, or a `mount` namespace of its own: a container, Chromium's sandbox, `unshare -m`). `force: "kill"` kills them first; `force: "restart"` restarts the sandbox without it (its processes restart), awake, asleep or dead. A dead sandbox refuses the others (409 `sandbox_dead`): nothing in it can unmount. If a `restart`'s boot fails, the volume is detached all the same and the sandbox left dead: 422 `volume_mount_failed` names the drive that would not mount. 404 for nothing at the path; a plain 409 with `retryAfter` while it is still being attached or detached; 409 `machine_lost`, `inProgress`; a plain 503 when its machine stayed busy (`retryable`). A volume detached with `backupDays` above 0 is backed up once more if it changed |
| `Volume.list()` | `VolumeInfo[]` | every volume, attached or not |
| `Volume.get(name)` | `VolumeInfo` | 404 for none |
| `Volume.set(name, { backupDays })` | `VolumeInfo` | how many days each automatic backup is kept, 0 to 30, `0` for none. s5x backs up every volume once a day, the first time 15 minutes after it is made, or after you turn its backups on while it has none, attached or not, encrypted, never sleeping or waking its sandbox, and skips a day it did not change; its newest is kept until a newer one replaces it or the volume is deleted |
| `Volume.delete(name)` | `void` | the volume, its data and its snapshots, permanently. 409 `volume_attached` while a sandbox holds it, including one still being deleted (`e.problem.sandbox`; delete it again once that deletion finishes, within minutes), `snapshot_attached` while sandboxes hold one of its snapshots (`e.problem.sandboxes`), `inProgress` while it is being backed up or restored. Its automatic backups expire as they would; yours stay until you delete them. A sandbox destroyed by its `ttl` or `ttlIdle` leaves its volumes, which only this call deletes |
| `Volume.snapshot(name)` | `SnapshotInfo` | a clean snapshot, at once: attached, its sandbox is woken and its writes held for the instant of a copy that shares every block with it; detached, it must have been unmounted cleanly. 409 `volume_unclean` (detached, not unmounted cleanly: attach it and take it there), `volume_fragmented` (too fragmented to hold briefly: detach it and take it detached), `too_many_snapshots` (20 a volume), `machine_lost`, `inProgress`; 503 `snapshot_not_clean` (`retryable`: nothing was kept, take it again), and a plain 503 when its machine stayed busy |
| `Volume.snapshots(name)` | `SnapshotInfo[]` | newest first |
| `Volume.deleteSnapshot(name, id)` | `void` | 409 `snapshot_attached` while sandboxes hold it (`e.problem.sandboxes`); 404 for none of that volume's |
| `Volume.fork(snapshotId, { name, backupDays? })` | `VolumeInfo` | a new volume from a snapshot, detached, on the snapshot's machine, at once: it shares the snapshot's blocks until it is written. Its automatic backups are kept 7 days unless `backupDays` says otherwise. 400 `bad_name`; 404 the snapshot; 409 `name_taken`, `volume_cap`, `machine_lost`; 503 `no_capacity` |
| `Volume.backup(name, WaitOptions?)` | `BackupInfo` | a backup of the volume alone, attached or not, waited for as `box.backups.create` is: attached, through its sandbox, which is never slept (paused for the milliseconds the copy takes, even under a keep-alive; nothing from memory is in it); detached, directly. 409 `machine_lost`, `inProgress` |
| `Volume.backupInBackground(name)` | `OperationInfo`, `queued` | the same backup, answered at once; `Backup.waitUntilReady(id)` waits for it |
| `Volume.backups(name)` | `BackupInfo[]` | its own backups and the sandbox backups that hold it, newest first |
| `Volume.restore(backupId, VolumeRestoreOptions & WaitOptions)` | `VolumeInfo` | makes a volume of a backup's, waits, and answers it (read by the id its operation names). `{ name, drive?, nextTo?, region?, backupDays? }`: a NEW volume, detached, from a volume's backup or from one `drive` (`rw0` unless given) of a sandbox's, of a sandbox that still exists or not; `nextTo: <sandbox>` puts it on that sandbox's machine, the only one it can then be attached to there, and otherwise it goes wherever there is room, in `region` if given; it is charged at what the backup's volume held. `{ name, drive?, replace: true }`: the backup put back over the volume it was taken of, which `name` must be (409 `not_this_volume`), everything written to it since lost; an attached one's sandbox boots cold at its next wake, its processes restarting, and it keeps its own `backupDays`. `ClientError` `your restore rs_… failed: <why>` if it fails, and a new volume's name is free again. 400 `bad_name`; 404 the backup, its `drive`, `nextTo`; 409 `name_taken`, `volume_cap`, `machine_lost`, `inProgress`; 503 `no_capacity` |
| `Volume.restoreInBackground(backupId, VolumeRestoreOptions)` | `OperationInfo`, `queued` | the same restore, answered at once; `Operation.wait(id)` waits for it |

`Backup` holds every finished backup you have; `box.backups` and `Volume`
take and restore them, and one still being taken is an
[operation](#operation).

| | Returns | |
|---|---|---|
| `Backup.list()` | `BackupInfo[]` | every finished backup, newest first, including backups of sandboxes that no longer exist — which can be listed and deleted, but not restored onto anything |
| `Backup.get(id)` | `BackupInfo` | one finished backup; 404 for an id you have no backup of, and 404 saying so for one still being taken (`Operation.get(id)` reads it) or one that failed |
| `Backup.waitUntilReady(id, WaitOptions?)` | `BackupInfo` | waits for a backup `createInBackground()` started, from any process, as `Operation.wait` does, and answers the backup; `ClientError` `your backup bk_… failed: <why>` if it failed, 404 at once for a mistyped id |
| `Backup.delete(id)` | `void` | 409 while it is still being taken, or while a restore from it runs |

## Logs

Not on a sandbox: the sandbox whose history matters most is usually one that
has been destroyed.

None of these wake a sandbox. Records (access, audit, system) outlive it, but
a name resolves to the live sandbox first, so a deleted one whose name was
reused is reachable only by its id; the page's `deleted` says which one you
got. Process output (`proc`, `stream` or `source: "process"`) was kept with
the sandbox and went with it, so asking for it after the sandbox is deleted is
an `ApiError` 410. It also goes at a switch to another build (a promote), and a
snapshot or backup restore drops what was written since the checkpoint (and
clears `console`); read it first if you need it.

| | Returns | |
|---|---|---|
| `Logs.query(q: LogQuery)` | `LogPage` — records: `{ sandbox, ref, deleted, lines, cursor, retentionDays, more? }`; process: `{ sandbox, ref, deleted: false, proc, lines, cursor, retentionBytes, procs?, more?, droppedBytes? }` | one page. A process page carries no `retentionDays`: its bytes are capped by size (`retentionBytes`), not by age. `more: true` means there is more past this page: query again with `cursor` |
| `Logs.stats(q)` | `LogStats` — `{ total, info, warn, error, first?, last?, since?, … }` | counts records. With no `sandbox`, `since` or `until`, it counts the last 24 hours, not the whole retention window, and `since` says where the count starts. Spread a records page's `cursor` into `q` to count only what was written since that page |
| `Logs.sandboxes({ ref?, deleted? })` | `LogSandboxes` — `{ sandboxes: { sandbox, ref, last, events, deleted }[], truncated, retentionDays }` | what you still have logs for, most recently active first; `sandbox` is the id; `ref` narrows to the sandboxes that ever had that name; `truncated: true` means only the 500 most recent were returned, so pass a `ref`. Iterate `.sandboxes` |
| `Logs.follow(q, { intervalMs?, onPage?, signal?, client? })` | `AsyncGenerator<LogLine>` | `onPage(page)` is called with each `LogPage` before its lines are yielded, for `droppedBytes`, `deleted` and `procs`. Records are waited for on the server (`wait: 25` past the cursor), so a line is yielded within about a second of being written; process output is polled every `intervalMs` (2 s), and at once when a page says `more`; stop it with `signal`. Each line is yielded once, however much is written between polls. With `limit`, records yield the newest `limit` first and then only new lines; process output starts from its last `limit` lines. A `sandbox` name is resolved once: if a new sandbox takes the name mid-follow, the loop keeps following the one it started on. An abort that lands during a poll rejects the loop with the signal's reason (an AbortError), so catch it. An abort between polls ends the loop cleanly at the next poll |

`LogQuery` fields, all optional: `sandbox` (name or id), `source` (`"access"`,
`"audit"`, `"system"`, `"process"`), `since` / `until` (a duration ago —
`"30m"`, `"2h"`, `"1d"`), `level` (`"warn"` or `"error"`, meaning that and
above), `grep`, `limit`, `proc` (`"app"` is the entrypoint, `"console"` the
VM's serial console: kernel and init messages, where a panic or an OOM kill
shows up), `stream` (`"stdout"`, `"stderr"`, `"all"`).

**Watching a fleet:** `source: "system"` with no `sandbox` is every
sandbox's lifecycle, in order, and each line's `sandbox` names whose it is.
With `after` (a page's cursor), `wait: <seconds>` (at most 60) holds the read
until a line past it is written, and answers an empty page if none is. The
actions: `slept` (`detail.reason`: `idle`; `memory_pressure`, its host short
of memory, with `leases`, how many holds and `keepAlive` processes it was slept through,
`connections`, the open ones closed, and `through` when it was slept mid-work, which s5x wakes
again once its host has room; `operation`, a snapshot, backup or
promote now; or `suspended`, s5x suspended it or your account: nothing wakes
it, and calls answer 403 `suspended`, saying why, until s5x lifts it), `woke` (`detail.wakeMs`, how long the call that woke it
waited; `detail.restoreMs`, its machine restoring or booting the sandbox, and
`detail.readyMs`, until s5x's own agent inside it answered, counted from the
same start, so it includes `restoreMs`: neither covers your app, which the
gateway waits for on its own; `detail.path`, `resume` when its processes came
back as they were), `created` (its first boot: `detail.restoreMs` and
`detail.readyMs` as for `woke`, and `detail.bootMs`, the whole boot), `cold_booted`, `recovered` (`detail.automatic` when s5x
did it), `recovery_failed` (s5x's try did not come up: `detail.attempt`,
and `detail.final` on the fifth, after which s5x stops trying on its own; every call that wakes it still tries), `promoted`, `resized`
(`detail.from`, `detail.to`: its size changed and its processes restarted),
`machine_lost` (its machine has not answered; calls that wake it answer 409
`machine_lost`; a second such line says s5x has made sure the machine is off,
and the ways back are open), `moved` (`detail.how`, the line's `at` when: it
now runs on another machine after a restore or recover off a lost one, which
was off; the copy left there is destroyed when it answers), `died`
(`detail.autoRecover`: whether s5x still tries on its own, i.e. its five tries are not spent; a call that wakes it tries regardless),
`unhealthy` (`detail.reason`: `readiness`, `env`, `volume` or `clock`; the
next call that wakes it checks again, and a wake that fails again adds no
second line), `volume_growth_refused` (`detail.volume` it holds was not grown
as it filled, so its writes meet ENOSPC at the size it has; `detail.reason`:
`limit`, the most a volume grows to on its machine; `tenant_cap`, your volumes
and snapshots at your cap; `host_full`, its machine short of room for now; at
most once a volume an hour), `drives_reconciled` (a wake found its machine
holding other volumes than s5x records for it, so it was booted fresh from
its disks with the volumes s5x records: its processes restarted, and nothing
written was lost) and `deleted` (`detail.reason`: `request`, `create_failed`,
`ttl` or `ttl_idle`; once per
sandbox, however many times its delete is called). Keep the page's `cursor` and pass it to the next
query (or use `Logs.follow`) to see each one once.

Two families, and the filters do not cross. **Records** (access, audit,
system) take `since`, `until`, `level`, `grep` and `after`. **Process output**
(`proc` or `stream` set, or `source: "process"`) refuses all five with a 400:
its lines carry no timestamp, severity *is* the stream (`stream: "stderr"` for
errors), there is no server-side search — filter the returned text yourself —
and it resumes at `stdout` and `stderr` instead of `after`. Use `limit` to
bound either.

Every page returns a `cursor`: `{ after }` for records, `{ stdout, stderr }`
for process output. Spread it into the next query (`{ ...q, ...page.cursor }`)
to read exactly what was written since, in the order it was written: a slow
call's record is written when the call ends, so it can come after records
stamped later. `follow()` does this for you.

`LogLine` has `source`, `level`, and — per source — `at`, `method`, `route`,
`status`, `ms`, `reqId`, `action`, `detail`, or for process output `proc`,
`stream`, `text`. Process lines carry no timestamp, by design. A call your
own code abandoned before its answer has `status` 499, at `info`: nothing
failed. An `exec`'s audit line (`process_exec`) and a `start()`'s
(`process_start`, with its `detail.name`) name its program and how many
arguments followed it (`detail.program`, `detail.args`), never the command
line, whose words are often your users'; variables set ahead of the program
(`NAME=value node app.js`) are not its program, and not counted. Your code
knows what it starts: to start a process again, after a `recover()` say, run
it from there.

## Errors

| Class | When | Useful fields |
|---|---|---|
| `ApiError` | the server answered with an error | `status`, `message`, `requestId`, `retryable` (the server sent `retryAfter`, or the status is 502, 503, 504 or 524: the server alone says whether a retry helps, so never decide by the text of `message`), `retryAfter` (seconds), `code` (a refusal's stable name, when it has one: the table below; a 404 about the sandbox itself has no code), `problem` (typed `Problem \| undefined`, but always set on an error the SDK throws: the RFC 9457 document, or `{}` when the body was not a JSON object, such as a gateway's HTML page, whose text then follows the status in `message`; a volume's members are typed -- `sandbox`, `path`, `sandboxes`, `drive`, `holders` -- and other extension members, such as `exit`, `retryAfter` and `inProgress`, are `unknown`). A file or process call the sandbox refuses is a problem document like any other, with the sandbox's sentence as `message`. Test `typeof e.problem?.detail === "string"` to tell s5x's own problem document from those, not `e.problem === undefined` |
| `ClientError` | the SDK refused on its own: before sending (a name, ref or id that is `.` or `..`), an operation or a build that failed (`your backup bk_… failed: <why>`), or a wait that ran past the `timeoutMs` you gave it (`wait`, `Operation.wait`, `Template.build`, `waitUntilReady`, `createIfNotExists`) | `message` |
| `ConfigError` | no credential could be found, or a `client` option holds no client made with `new S5X()` (`undefined`, `null`, or one from another copy of the package; leave `client` out to use the default); nothing was sent | `message` |
| `DOMException` | `timeoutMs` ran out (`name` is `"TimeoutError"`); an abort throws the signal's reason instead (an `AbortError` unless you gave one) | `name`, `message` |

The three classes are exported from `"s5x"`. A timeout or an abort stops the wait, not the work: treat it as
"may have run", like a dropped connection.

Every `code`, the same one the server sends in `x-s5x-refused`. A refusal
without one is still an `ApiError`; `inProgress` (a 409 naming the unfinished
operation in the way, to `Operation.wait` on) has no code.

| `code` | Status | What it means, and what to do |
|---|---|---|
| `waking_no_capacity` | 503 | the sandbox's machine has no room to wake it right now; nothing ran. `retryable` |
| `no_capacity` | 503 | no machine (or not the one it must be on) has room for what you create, a sandbox or a volume, right now; nothing was created. `retryable` |
| `file_not_found` | 404 | the path is not in the sandbox |
| `process_not_found` | 404 | no process by that name is in the sandbox, as after a switch to another build or a `recover()` |
| `machine_lost` | 409 | the machine has not answered for a while (10 minutes by default); nothing was asked of it. It clears if the machine answers again. Once s5x has made sure the machine is off, `message` names the ways back; until then it says they open then. `sandbox` names the sandbox involved, when one is |
| `incompatible_machine` | 409 | a build has no image for the machine a sandbox is on, so a promote switched none of them (`Template.promote`) or did not promote it (`box.promote`), or a snapshot or backup restore was refused because the build it was taken on has none: build it again to make one, or use another build |
| `sandbox_dead` | 409 | the sandbox is dead: `recover()` it, or, for a detach, `force: "restart"` |
| `suspended` | 403 | s5x suspended your account, and refuses every call of it, or this sandbox, and refuses every call naming it but `Sandbox.get` and `Sandbox.list` (which show `suspended`); `message` says since when and why. Nothing in it runs or wakes, and nothing of it is deleted, until s5x lifts it: retrying changes nothing. Its previews and endpoints answer 403 `suspended` too |
| `bad_path` | 400 | a path that is not absolute, is `/`, is under `/s5x`, `/proc`, `/sys` or `/dev`, is over 255 bytes, or is given twice or inside or above another in one request |
| `bad_name` | 400 | a volume name that breaks the naming rules, or starts `vol_` or `vsn_` |
| `too_many_volumes` | 400 | more than 4 volumes or 4 snapshots in one create |
| `volume_not_found` | 404 | no volume of that name: pass `create: true` to make it |
| `snapshot_not_found` | 404 | no such snapshot of yours |
| `volume_attached` | 409 | another sandbox holds the volume: `sandbox` and `path` say where, and `Volume.detach(p.sandbox, { path: p.path })` frees it. With `retryAfter` while that sandbox is being deleted: it is free within minutes |
| `snapshot_attached` | 409 | sandboxes hold the snapshot, or a snapshot of the volume: `sandboxes`; detach it there first |
| `snapshot_attached_here` | 409 | the snapshot is attached to this sandbox already |
| `path_in_use` | 409 | the sandbox has something attached at the path, or inside or above it |
| `drives_full` | 409 | the sandbox holds 4 volumes (or 4 snapshots) already: detach one |
| `volume_on_another_host` | 409 | the volume or snapshot is on another machine than the sandbox: create a sandbox with it, restore a backup of it `nextTo` the sandbox, or fork the snapshot where it is |
| `volumes_on_different_hosts` | 409 | a create's volumes and snapshots are on different machines; a sandbox's must share one |
| `volume_busy` | 409 | processes in the sandbox hold the volume: `holders`; stop them, or detach with `force` |
| `volume_mount_failed` | 422 | the guest would not mount `drive`, in the kernel's words: nothing of an attach is kept, a create fails, a `recover()` leaves the sandbox dead. Not `retryable` |
| `sandbox_limit` | 409 | a create, when you have as many sandboxes as your account's limit (100 unless s5x set another), dead ones included; nothing was created. Delete one (one being deleted no longer counts), or ask s5x support to raise it. Not `retryable` |
| `volume_cap` | 409 | your volumes and snapshots hold your account's cap: delete some, or ask s5x support to raise it |
| `name_taken` | 409 | you have a volume of that name |
| `not_this_volume` | 409 | `replace` names another volume than the one the backup holds |
| `volume_unclean` | 409 | a detached volume that was not unmounted cleanly: attach it, and take the snapshot there |
| `volume_fragmented` | 409 | too fragmented to snapshot while attached: detach it and take the snapshot detached |
| `too_many_snapshots` | 409 | the volume has 20 snapshots: delete one |
| `snapshot_not_clean` | 503 | the snapshot could not be taken clean; nothing was kept. `retryable` |
| `volumes_changed` | 409 | a sandbox restore over attachments other than the ones the backup or snapshot recorded: `message` names the difference; attach them as they were, or restore the volumes alone (`Volume.restore`) |

Statuses that do not say what they seem to:

- **524** — the API closes a request it has not begun to answer within about
  100 s, and the work behind it goes on: `no answer within about 100 s, so the
  connection was closed (524). The operation may still be running: check its
  result before you retry.` `retryable`, but check first.
- **503** `your sandbox is being restored; try again in a few seconds` — a
  call that waited out a restore's replacement of the sandbox, which is still
  being recorded. `retryable` after `retryAfter`; `e.problem?.inProgress`
  names the restore.
- **410** `this sandbox was deleted while the request was running; whatever it
  was doing may not have finished`, **409** `this sandbox was suspended or
  replaced while the request was running (a snapshot, backup, restore or
  promote --now does that); …`, and **409** `this sandbox died while the
  request was running; …` — an exec, file, process or process-log call that
  may have run partway. After the last, `box.recover()` brings it back on the
  same disk.
- **429** from `writeFile` — four uploads into that sandbox already running,
  or 1 TiB of yours in progress; wait `retryAfter` and send it again.

Narrow an extension member before using it. The exit of an `exec` whose
output was too large (422):

```ts
import { ApiError } from "s5x";
declare const e: unknown;

const exit = e instanceof ApiError && e.status === 422 ? e.problem?.exit : undefined;
if (typeof exit === "number") { /* it ran, and exited `exit` */ }
```

## Types

Every SDK class and type this page names (`Sandbox`, `Template`,
`ProcessHandle`, `Process`, `TemplateBuild`, `SandboxInfo`,
`SandboxCreateOptions`, `CallOptions`, `Promotion` and the rest) is exported
from "s5x". Import it; do not derive it. A class is the entry point
(`Endpoint`), and the record it answers is the same name with `Info`
(`EndpointInfo`); a template's record is `TemplateBuild`, one build.

`SandboxState`: `"creating" | "running" | "sleeping" | "unhealthy" | "deleting" | "dead"`.
A sandbox being woken reads `"sleeping"` (or `"unhealthy"`) until it is up,
and one paused for a snapshot's or a backup's copy, or being replaced by a
restore, reads `"sleeping"` for those seconds.
`"creating"` means a create is still booting it, and calls that need it
running get 409 meanwhile. A create finishes even if its caller stops
waiting (a 524), so the sandbox then turns `"running"` or `"unhealthy"` by
itself. A create the host refused is removed at once and its name freed;
only one whose host stopped answering stays `"creating"` (and its name
taken) for 15 to about 20 minutes before it is destroyed.
`"dead"` means its VM stopped and there is no memory image to resume: a
sandbox that never sleeps, or one whose VM crashed while awake (it reads
`"dead"` usually within a minute, and `Logs` has a system record
`died`).
`recover()` boots it again on its own disk, as every call that wakes it
tries to; until then it is kept. `"unhealthy"` means its last create or wake came up not
ready: the guest never answered or did not take its env (from either), or a
volume it holds would not mount (from a wake). That call got an error saying
which. The next call that needs it running wakes it again; in the volume case
that likely fails the same way, so that error is not `retryable`. A create
whose volume will not mount throws 422 `volume_mount_failed`, naming the
drive, and nothing of the sandbox is kept; a volume it made stays, empty and
detached.

`SandboxInfo`: `id`, `ref`, `state`, `region?`, `regionPin?` (the region you
required at create, if you did), `templateId` (the
`tpl_` id of the build it runs now, the same value as that build's
`TemplateBuild.id`), `template?` (the template's name, e.g. `"agent"`, without a digest),
`pendingTemplateId?` (promoted, switches at its next wake),
`pendingVcpus?` and `pendingMemMb?` (resized: the size it boots at at its next
wake), `machineLost?` (its machine has not answered for a while, 10 minutes by
default),
`allowedHosts?` (its allowlist, when it has one: it can reach only these exact
hosts plus its header-rule hosts; absent is anywhere, `[]` is its rule hosts
only), `templateDigest?` and `pendingDigest?` (same `sha256:` form; the
digests of the build it runs and of the one it switches to at its next wake), `vcpus`, `memMb`,
`diffBytes`, `volumes` (`Attachment[]`: every volume and snapshot it holds, in
drive order, `[]` for none; each `{ drive, path, mode: "rw" | "ro", volume,
snapshot?, state }`, `volume` the volume's name -- a snapshot's is the
volume it was taken of -- `snapshot` its id, and `state` `"attaching"`,
`"attached"` or `"detaching"`), `wakes`, `idleTimeoutS?`,
`ttlIdleS?`, `expiresAt?`,
`lastActivityAt?`, `lastActivityKind?` (what last
happened in it: `cpu`, `traffic`, `awaiting` -- a request of its own waiting on
an answer --, `request` or `hold`), `lastActivityRemote?` (for `traffic` the
address that moved the most, for `awaiting` the one waited on longest; read live
from an awake sandbox), `createdAt?`, and live metrics
once they have been reported: `cpuUsec`, `memBytes`, `memPeakBytes`, `pids`, `metricsAt`,
`req2xx`, `req4xx`, `req5xx`.

`ExecResult`: `exitCode`, `stdout`, `stderr`, `timedOut` (killed at `killAfterMs`; `exitCode` is then 124 — a command that exits 124 by itself has `timedOut: false`), `binary` (the output held bytes that are not UTF-8, which came back as U+FFFD, so `stdout` and `stderr` are not byte for byte what it printed: copy files with `box.fs.readFile`, not through exec). After a kill, `stdout` and `stderr` hold only what reached them: a program's own buffer dies with it ([patterns.md](patterns.md#timeouts-and-cancellation)). A command killed by a signal (e.g. the OOM killer) has `timedOut: false` and `exitCode` -1, or 128+n if the shell outlived it; it ran and was cut short.

`Process`: `name`, `pid`, `status` (`"starting" | "running" | "completed" |
"failed" | "killed" | "timeout"`), `exitCode` (`null` until it ends; with
`timeout` it is 124, s5x having killed its process group at `timeoutSeconds`;
with `killed`, a signal ended it, it is -1; a program that exits 124 by itself
is `failed`, so read `status`, not the code, to tell them apart),
`command`, `workingDir?`, `startedAt?`.

`TemplateBuild`: `id`, `name`, `digest?` (the build's address, unique to it:
`sha256:` plus 64 hex; absent until ready. Errors and the CLI show its first
12 hex after `sha256:`, and every call takes either form. To match a short
digest, strip the prefix
(`b.digest?.replace(/^sha256:/, "").startsWith(short)`), or better, carry
`id`s), `image`, `imageDigest?` (the image it was made
from; not an address), `status` (`"pending" | "building" | "ready" | "failed"`),
`error?` (why a failed build failed: `<step>: <the tool's message>`, such as
`pulling <image>: …`, or s5x's own words when the fault was on its side; only
when `failed`), `trustedUsers` (as the build named them, `[]` for none), `warnings` (what the build
found in the image that could give another user a trusted user's reach, one sentence each, which it
reports and does not refuse; `[]` when it found nothing), `promotedAt?`, and on list reads (no size: a template has none)
`latest?`, `sandboxes?`, `switching?`, `expiresAt?` (when s5x deletes it; `null` while it is
kept or still building); `createdAt?`.

`Login`: `id` (`lg_…`), `websites`, `username` (`""` for none), `hint`,
`hasTotp`, `createdAt`, `updatedAt`; never a password or seed.
`LoginInput`: `id?`, `websites?`, `username?`, `password?`, `totp?` (a
string, or `null` to remove the seed), `hint?`.

`Schedule`: `id`, `sandboxId`, `name`, `cron?` or `at?`, `maxLatenessS?`,
`command`, `enabled`, `nextRunAt`, `completedAt?` (a one-shot that has run),
`lastRunAt?`,
`lastExit`, `lastOutput?`, `lastCommand?`, `runs?`, `createdAt`.
`ScheduleRun`: `scheduledAt`, `outcome`, `reason?`, `startedAt?`, `exit`
(null unless `ran`), `lagS?`, `durationMs?`, `command`, `cron?`, `output?`.

`EndpointInfo`: `id`, `name`, `hostname`, `url?`, `port`, `auth`, `sandboxId` and
`sandboxRef` (the sandbox it points at, by id and by name; `null` when
detached), `token?`, `createdAt?`.
`Preview`: `id`, `hostname`, `port`, `url?`, `token?`, `expiresAt?`, …

`BackupInfo` (a finished backup), of two kinds. A sandbox's (`volumeOnly:
false`): `id`, `sandboxId`, `ref` (the sandbox's name, kept after it is
deleted), `bytes` (the stored copy's size), `templateId`, `templateName?`,
`templateDigest?` (same `sha256:` form; the build it was taken on), `memMb`,
`vcpus`, and `drives` (each volume it held, which it holds too, `{ drive,
path, volumeId, fsBytes }`, and each snapshot it held, `{ drive, path,
snapshot }`; `[]` for none). A volume's (`volumeOnly: true`): `id`, `bytes`,
`volumeId`, `fsBytes` (its filesystem's size), and `sandboxId` and `ref` only
when its volume was attached then; no build or size. Both: `automatic` (s5x
took it, of a volume, as it does daily; one you took is `false` and never
expires), `expiresAt?` (an automatic one's: when it is deleted, unless it is
still its volume's newest), `createdAt` (the moment it holds: when it was
begun, at or just before its copy).
`OperationInfo`: `id` (`bk_…`, `rs_…`, `snp_…`, `upl_…` or `er_…`; a backup's is the
backup's id), `kind` (`"backup" | "restore" | "snapshot" | "upload" | "erase"`),
`status` (`"uploading" | "queued" | "running" | "done" | "failed"`;
`uploading` is an upload's only, while its parts are sent), `phase?` (while it
runs: `"staging" | "sending" | "downloading" | "committing" | "assembling" |
"placing" | "destroying" | "erasing"`), `sandboxId?`, `ref?` (the sandbox's
name when it started; on a volume's backup or restore only when it goes
through the sandbox holding the volume), `volumeId?` and `volumeOnly?` (a
volume's backup or restore, and its volume), `removed?` (an erase's:
`{ sandbox, volumes, volumeSnapshots, snapshots, backups, objects,
vaultEntries, headerRules, schedules, previews, logins }`, the volumes by name and
their snapshots by id),
`automatic?` (a backup s5x takes daily of a volume), `error?` (why, when `failed`), `errorStatus?` (a failed upload's HTTP status),
`backupId?` and `snapshot?` (what a restore restores from, or the snapshot a
snapshot takes), `templateId?` (the build a restore puts back), `path?` and
`bytes?` (an upload's), `expiresAt?`, `createdAt`, `startedAt?`,
`finishedAt?`. An optional field is absent, never `null`.
`Snapshot`: `name`, `bytes?`, `createdAt?` (Unix seconds, unlike every other
timestamp here).
`VolumeInfo`: `id` (`vol_…`), `name`, `region`, `usedBytes` (what it holds on
its machine as last measured, blocks it shares with its snapshots and forks
included: what it is billed), `fsBytes` (its filesystem's size now),
`limitBytes` (the most it grows to), `attachedTo` (`{ sandbox, path, drive }`,
the sandbox by name, or `null` while detached), `backupDays`, `forkOf` (the
snapshot it was forked from, or `null`), `provisionedAt?` (when its file was
made; absent until then), `createdAt`.
`SnapshotInfo` (a volume's snapshot; contrast `Snapshot`, a sandbox's
checkpoint): `id` (`vsn_…`), `volume` (its volume's name), `usedBytes` (what
only it holds, 0 until measured: what keeping it costs), `fsBytes`,
`attachedTo` (`{ sandbox, path, drive }[]`, `[]` for none), `createdAt`.
Only snapshots that are taken are listed.
`DirEntry`: `name`, `dir`, `size?`, `mode?`, `modified?`.
`Usage`: `sandboxes`, `running`, `sleeping`, `memMb`, `diskBytes`, `wakes`.
`diskBytes` counts only existing sandboxes: a volume is not in it
(`Volume.list()` shows every volume and what it holds).
