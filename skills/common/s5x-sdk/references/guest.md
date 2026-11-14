# Calling s5x from inside your sandbox

Code running **in** your sandbox reaches s5x over plain HTTP, with no library
and no key, at one base URL:

```
http://localhost:8081/v1
```

It serves your sandbox's own vault, its website logins, its schedules, which
sandbox it is, and holds that keep your sandbox awake through what s5x cannot
see.

The `s5x` SDK is not for this. It is for code **outside** a sandbox, and for
your own service inside one, given a key of its own (`s5x key create`) as
`S5X_API_KEY` in its env (`patterns.md`, "Run your own service in a
sandbox"). Everything here is a `fetch`, a `curl` or your language's HTTP
client.

## Contents

- [No key, by design](#no-key-by-design)
- [The rules every request follows](#the-rules-every-request-follows)
- [Who can reach what](#who-can-reach-what)
- [Trusted users](#trusted-users)
- [Where a secret goes](#where-a-secret-goes)
- [The API](#the-api)
- [The vault](#the-vault)
- [Logins](#logins)
- [Who am I](#who-am-i)
- [Schedules](#schedules)
- [Keeping your sandbox awake: holds](#keeping-your-sandbox-awake-holds)
- [Your volumes, from inside](#your-volumes-from-inside)
- [What your sandbox's kernel has](#what-your-sandboxs-kernel-has)
- [Refusals](#refusals)

## No key, by design

s5x knows which sandbox is calling from the network path the request arrived
on, which code in the sandbox cannot forge, and answers only for that sandbox.
Nothing here needs an s5x API key. **Never put one inside a sandbox that runs
an agent or code you did not write**: it would be captured in the memory image
and in every snapshot and backup, and anyone with code execution in the
sandbox would hold every sandbox you have.

This address works only from inside a sandbox. Anywhere else the requests
fail to connect: use the SDK or the CLI there.

## The rules every request follows

A browser inside your sandbox loads pages from anywhere, and s5x cannot tell a
page's request from your code's by who sent it. So it answers only requests a
web page cannot make:

- **Every POST sends `content-type: application/json`**, with a JSON body:
  `{}` when there is nothing to say. JSON is the one body type a page cannot
  send here without a CORS preflight, and no preflight is ever answered.
  Every POST without it is refused 403: a bare `curl -X POST`, or a string
  body with no type (it goes out as `text/plain`), whatever runtime or
  framework sends it.
- **Call it by one of its own names**: `localhost`, any IP address, or a name
  under `.internal` (`host.docker.internal`, `host.containers.internal`, …),
  on any port, so `ssh -L 9000:localhost:8081` works. Never a name of your own
  for it in `/etc/hosts`: a page using DNS rebinding arrives with its own
  name, and is refused.
- **No `OPTIONS`.** Every preflight is answered 403.

Whether your code also sends `Origin` or `Sec-Fetch-*` makes no difference on
a template without trusted users, nor on the routes every user may call:
server code forwards a visitor's headers on ordinary calls, so nothing there
is judged by them. On a template with trusted users, the routes only they may
call refuse a request that carries `Origin` or `Sec-Fetch-Site`
([Trusted users](#trusted-users)).

## Who can reach what

| caller | `http://localhost:8081/v1` |
|---|---|
| a process in your sandbox, as any user, or in a container there | holds, `whoami` and reading schedules. The vault and changing schedules too, unless the template names trusted users: then only they and root may. Logins only they and root may read, and only on a template that names them ([Trusted users](#trusted-users)). All of it for your sandbox alone: never another sandbox's vault, logins or schedules, whatever headers it sends. Everything else on the port is 403: exec, files, processes, env and the shell are driven from outside, through the API |
| a web page a browser in your sandbox loaded | nothing it can use: any POST that is not JSON, any preflight, and any request under DNS rebinding is 403, and the browser keeps every other reply from the page. On a template with trusted users, a route only they may call also refuses any request carrying `Origin` or `Sec-Fetch-Site`, whichever user the browser runs as |
| anything outside your sandbox | unreachable |

Code that runs as the image's `USER`, your harness and everything the
assistant runs, is kept from the vault, logins and schedule changes by naming
a small helper of yours, and only it, in the template's `trustedUsers`:
[Keeping one user's code away from s5x](#keeping-one-users-code-away-from-s5x).

## Trusted users

A template can name the users of its image that may read secrets inside its
sandboxes, its **trusted users**, when it is built:

```ts
import { Template } from "s5x";

await Template.build({
  image: "ghcr.io/acme/assistant:1.4.0",   // declares USER agent, which is not trusted
  name: "assistant",
  trustedUsers: ["helper"],                // users, or "@group"; root is always trusted
});
```

`s5x template build <image> --name assistant --trusted-users helper`, or
`template push`, does the same. In every sandbox of that build only those
users and root may read the vault and logins or change schedules. s5x knows
who is calling from the kernel, by the user that opened the connection to
`localhost:8081`, never from anything the request says:

| route | template without trusted users | with them: a trusted user or root | with them: any other user, or a container s5x cannot name (below) |
|---|---|---|---|
| the vault: `POST /v1/vault/get`, `POST /v1/vault/put`, `POST /v1/vault/list` | any process | yes | 403 |
| logins: `POST /v1/vault/logins/list`, `POST /v1/vault/logins/get`, `POST /v1/vault/logins/totp` | 403 | yes | 403 |
| changing schedules: `POST /v1/schedules`, `PATCH /v1/schedules/{name}`, `DELETE /v1/schedules/{name}` | any process | yes | 403 |
| reading schedules: `GET /v1/schedules`, `GET /v1/schedules/{name}/runs` | any process | yes | yes |
| holds: `GET /v1/keepalive`, `POST /v1/keepalive` | any process | yes | yes |
| who am I: `POST /v1/whoami` | any process | yes | yes |

- **Who is trusted.** Each entry is a user of the image, or `@group`: every
  user the image's `/etc/group` lists in that group, and every user whose
  primary group it is. At most 16 entries, each a name of letters, digits,
  `.`, `-` and `_`, starting with a letter or `_`, at most 32 characters.
  Root is always trusted and never named. An entry the image does not have,
  or one that is or includes root or `nobody` (uid 0 or 65534), fails the
  build, naming it.
- **The image declares a `USER` that is not trusted.** `exec`, the shell and
  scheduled commands run as `USER`, so a build with trusted users fails when
  the image declares no `USER`, or one that is root or trusted.
- **The entrypoint runs as root**, with root's home unless the image's `ENV`
  sets `HOME`. Your start script drops each program to its user: the helper
  to the trusted user, everything else, your harness included, to `USER`
  (`setpriv`, `runuser`, `su`). One is
  [examples/trusted-helper/start.sh](examples/trusted-helper/start.sh),
  beside its image, the helper and a harness.
- **A rebuild keeps them.** A build that leaves `trustedUsers` out takes its
  name's last build's list, so the root entrypoint keeps working; `[]`
  (`--trusted-users ""`) clears it. A sandbox takes a build's list when it
  switches to that build.
- **The build warns, and does not refuse.** A build with trusted users lists
  in `warnings` (the CLI prints each as `warning: …`) what in the image could
  give another user a trusted user's reach: binaries with
  `cap_net_bind_service`, setuid, setgid or file capabilities; `sudo` rules
  for users that are not trusted; untrusted members of `docker`, `disk` or
  `lxd`; `/etc/subuid` or `/etc/subgid` ranges that include a trusted uid;
  and `dockerd`, `containerd` or `podman` in the image. Read them.
- **A request a browser sent is refused** on every route only trusted users
  may call, 403, whichever user the browser runs as: one carrying `Origin` or
  `Sec-Fetch-Site`. Every browser sends `Origin` on a POST, so a page loaded
  in a trusted user's own browser cannot read a login. `Sec-Fetch-Mode` alone is
  fine: Node's `fetch` sends it on every request. A trusted server that
  forwards its visitors' headers to s5x must drop those two.
- **A container counts as the user whose socket reaches s5x.** s5x asks the
  kernel who owns the client end of each connection in the sandbox's own
  network. A container on a bridge network of its own under a root daemon
  (Docker's default) connects from another network namespace and names no
  user: it gets holds, `whoami` and schedule reads, and nothing only trusted
  users may call. A rootless container (Podman, or rootless Docker) reaches
  s5x through a socket its network helper (slirp4netns or pasta) opens in the
  sandbox, owned by the user that started the runtime, so it has that user's
  trust; one started with `--network host` is judged by the user it runs as
  in the sandbox, so a root one is trusted. **A trusted user never starts a
  container, or anything else, for untrusted code**: start the assistant's
  containers as `USER`.
- **Each process's output stays private.** The files where s5x keeps what
  each process prints (`/s5x/proc`) are root's alone, so other users in the
  sandbox cannot read a trusted process's output. Read it from outside:
  `Logs.query({ sandbox, proc })`, or a `ProcessHandle`'s `logs()`.
- **A fresh volume's root stays root's** (`root:root`, mode 0755), where it is
  otherwise given to `USER`: your root start script makes the directories each
  user needs on it.

### When the vault refuses every caller

A build makes `/` root's, writable by no other user, and replaces whatever the
image put in `/s5x`. If, when s5x's agent in your sandbox starts, either one
is owned by another user or writable by its group or others (an entrypoint
running as root ran `chmod 777 /`, say), the agent refuses the vault, logins
and schedule changes to every caller in that sandbox, on every template, with
or without trusted users, and says why in the console log
(`Logs.query({ sandbox, proc: "console" })`). Exec, files, holds, `whoami` and
schedule reads still work.

Treat it as a compromise by root. While `/` or `/s5x` was loose, any user in
the sandbox could replace s5x's own files there, which run as root at the next
boot, and a resize or `box.recover()` boots that same root filesystem, so
putting the modes back is not enough. Stop what loosened them, then promote
the sandbox to a fresh build of its template,
`box.promote(build, { now: true })`, which replaces everything outside its
volumes: a rebuild of the same image counts, the build it already runs does
not.

### Keeping one user's code away from s5x

Give secret access to the least code that needs it. The only trusted
user is a small helper of yours that signs in to websites and never answers
a secret; everything else, your harness included, runs as the image's
`USER`. A harness is large and reads untrusted input all day, the user's
messages, web pages, tool output, so as `USER` no bug in it and no prompt
that steers it can reach a password. [examples/README.md](examples/README.md)
works it through: [examples/trusted-helper/helper.ts](examples/trusted-helper/helper.ts),
under 100 lines, answers the logins (never a password) and a sign-in (a
session file) on a Unix socket only it and `USER` can reach, and nothing
else.

Code that runs as `USER` can still take holds, ask `whoami` and read
schedules; it cannot read the vault or logins, or add, change or delete a
schedule, whatever it sends. It needs no firewall rule of yours, and a sleep,
a resize or a recover keeps it; a promote gives the sandbox the new build's
list.

- **It holds against a user that cannot become root.** Root can read
  anything in the sandbox. Give `USER` no `sudo` and nothing setuid it can
  use; the build's `warnings` list what it found.
- **Change schedules from your server.** The API and the SDK change them with
  your key and check no trusted user (`box.schedules.add`), so the assistant
  cannot leave a command behind to run later. A scheduled command runs as
  `USER`, so on a template with trusted users it cannot read the vault
  either: one that needs a secret asks the helper, or the work is driven
  from outside ([Schedules](#schedules)). Passing schedule changes through
  the helper turns that protection off.
- **What a trusted process starts runs as that user**, and one that is not
  root cannot start anything as another. So the start script, as root,
  starts the helper as the trusted user and the harness as `USER`, as
  [examples/trusted-helper/start.sh](examples/trusted-helper/start.sh) does,
  and the helper starts nothing for the harness but a sign-in.
- **The helper never fetches a URL the harness chose.** s5x trusts whoever
  opens the connection, so a request the helper sends is the helper's,
  wherever its URL came from. A server the harness names could answer with a
  redirect to `http://localhost:8081/v1/vault/get`, and an HTTP client that
  follows redirects sends it as the trusted user. The helper builds each URL
  itself, from a website a login lists and a path it checked, turns redirects
  off where it fetches (`redirect: "error"`), and never hands the harness an
  answer from `localhost:8081` verbatim.

**If your harness must hold a secret itself**, make it the trusted user, and
run what the assistant asks for as `USER`: the start script, as root, starts
a runner as `USER` beside the harness, and the harness hands it each command
over a socket only the two can reach. Then the rules above for the helper
apply to the whole harness: it starts nothing for untrusted code, fetches the
assistant's URLs from the runner, turns redirects off wherever it fetches
itself, and never hands the assistant an answer from `localhost:8081`
verbatim. Every feature of the harness has to keep them, which is why the
helper is the default.

## Where a secret goes

Four places, each for one kind of secret. Pick by what code in the sandbox
does with it:

| the secret | set from outside | code inside | who in the sandbox can read it |
|---|---|---|---|
| an API key it only sends, in an HTTPS header | a header rule: `box.network.headers.set(host, name, value)` | holds a placeholder; s5x sets the header on the way out | no one: it never enters the sandbox |
| a website's password and TOTP seed, typed into a sign-in form | a login: `box.vault.logins.set({ websites, username, password, totp })` | `POST /v1/vault/logins/get` and `/totp` ([Logins](#logins)) | the template's trusted users and root; the seed never enters the sandbox, only each code |
| a value it reads or updates itself: a refresh token it rotates, a webhook secret it made | the vault: `box.vault.set(key, value)`, or code inside with `POST /v1/vault/put` | `POST /v1/vault/get` ([The vault](#the-vault)) | any process; on a template with trusted users, only they and root |
| a credential a header rule cannot carry: a database URL, a key a JVM or gRPC client sends | env: `Sandbox.create({ env })`, `box.env.set(name, value)` | `process.env` | every process started after it arrives |

Only the vault can be read back from outside (`box.vault.get`); a rule, a
login's password and seed, and env never can.

## The API

Base URL `http://localhost:8081/v1`, plain HTTP: the request never leaves the
machine your sandbox runs on. A failure is a problem document,
`{"type", "title", "status", "detail"}`, and `detail` says what to fix.

A small helper is all a TypeScript or JavaScript program needs:

```ts
const S5X = "http://localhost:8081/v1";

/** One request to s5x from inside the sandbox; throws with its explanation. */
async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(S5X + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try { detail = JSON.parse(text).detail ?? text; } catch { /* not JSON */ }
    throw Object.assign(new Error(`${method} ${path}: ${res.status} ${detail}`), { status: res.status });
  }
  return (text ? JSON.parse(text) : undefined) as T;
}
```

Answers every endpoint can give:

| status | meaning |
|---|---|
| 403 | a rule above refused it, a caller the template does not trust ([Trusted users](#trusted-users)), or s5x has suspended your sandbox or account (`suspended`); the detail says which |
| 404 | not set, no such schedule, no login for that website, or a path s5x does not serve (`… is not a path s5x serves in your sandbox …`) |
| 405 | a method that path does not take; `Allow` lists the ones it does |
| 413 | a body over 1 MiB |
| 429 | more than 50 vault, login, schedule and whoami requests a second from your sandbox: keep what you read instead of asking again; it answers again within a second |
| 500 | a fault on s5x's side; nothing was read or stored |
| 502 | s5x did not answer in time; retry in a moment |
| 503 with `Retry-After` | `this sandbox is not registered yet`: code that runs during your sandbox's first boot can arrive before s5x has recorded it. Retry after the seconds it gives |

## The vault

Your sandbox's own encrypted store, **for what code in your sandbox must read
or update itself**: the tokens from an OAuth flow it runs and the refresh token
it rotates, a webhook signing secret it checks requests with, a password a
library sends over a protocol that is not HTTPS (IMAP, a database driver), a
cursor it resumes a sync from. It is your sandbox's alone, through a resize, a
promote, a restore and a move off a lost machine, and it ends with your
sandbox: a new sandbox on the same volume starts without it.

**An API key your sandbox only spends does not belong here.** If code in the
sandbox sends a static key to an HTTPS API in a header, set it from outside
with `box.network.headers.set(...)`. s5x puts it on each request on the way
out, and nothing in the sandbox ever holds it: not the vault, not `env`, not a
prompt-injected agent. A value you deliver that the sandbox does read is
`box.env`, and a website's password for a sign-in form is a
[login](#logins).

Any process may call the vault, unless the template names trusted users: then
only they and root may ([Trusted users](#trusted-users)).

| endpoint | body | answers |
|---|---|---|
| `POST /v1/vault/get` | `{"key": "webhook_secret"}` | 200 `{"value": "…", "version": 3}`; 404 when the key is not set |
| `POST /v1/vault/put` | `{"key": "webhook_secret", "value": "…", "ifVersion": 3}`; `ifVersion` is optional | 200 `{"version": 4}`; 409 `that value changed since you read it` (read again and retry), 404 with `ifVersion` when the key is gone, 409 `this vault is full` (1000 keys), 400 for a key or value out of bounds |
| `POST /v1/vault/list` | `{}` | 200 `{"keys": ["webhook_secret", …]}`: names, never values |

A key is 1 to 127 letters, digits, `.`, `-`, `_` or `/`, starting with a
letter or digit; a value is at most 65 520 bytes. Without `ifVersion` a put
creates the key or overwrites it. With it, the put lands only if the entry is
still at that version, so two writers that each read, change and write back
cannot lose one another's write. There is no delete from inside; from outside,
`box.vault` reads, changes and deletes the same entries. The key travels in
the body, never the path, so your key names stay out of request logs.

```ts
declare function api<T>(method: string, path: string, body?: unknown): Promise<T>;
declare function verify(secret: string, req: Request): Promise<boolean>;
declare const req: Request;

// Made once, the first time the sandbox runs, and read on every webhook.
const keys = (await api<{ keys: string[] }>("POST", "/vault/list", {})).keys;
if (!keys.includes("webhook_secret")) {
  const secret = crypto.randomUUID();
  await api("POST", "/vault/put", { key: "webhook_secret", value: secret });
}
const { value } = await api<{ value: string; version: number }>("POST", "/vault/get", { key: "webhook_secret" });
if (!(await verify(value, req))) throw new Error("bad signature");
```

```bash
curl -sS -XPOST http://localhost:8081/v1/vault/get \
  -H 'content-type: application/json' -d '{"key":"webhook_secret"}'
```

Values are encrypted at rest, and are in your process's memory image only
while your code holds them: read one when you need it rather than keeping it
in a global for the life of the process.

## Logins

A login is a website's username and password, and optionally its TOTP seed.
Your platform stores it from outside (`box.vault.logins.set`,
`s5x sandbox vault login set`), and a small helper of yours, the template's
one trusted user, reads it inside to sign in to that website for the
assistant, in a browser the assistant does not drive. No call from outside, API, SDK or CLI, returns a
password or a seed, and the seed never enters the sandbox: s5x computes each
code. Only a template with trusted users serves logins
([Trusted users](#trusted-users)).

**What s5x guarantees and does not.** The one adversary this defends
against: code running inside the sandbox as a user that is not trusted,
including an assistant under prompt injection with a shell, file tools and a
browser of its own.

s5x claims:
- no API, SDK, CLI, log or event shows a password or seed;
- a stolen database, dump or disk yields ciphertext;
- inside a sandbox, only a trusted user's process can read a login or the
  vault, or change schedules, and every login read is recorded, within the
  bounds the audit below states.

s5x does not claim:
- that the assistant cannot see a password: that depends on the platform
  running its tools as another user and signing in from a sealed browser;
- anything against root inside the VM, or a user who can become root, or a
  binary with `cap_net_bind_service` while a tenant's root has removed s5x's
  routing rules;
- that a container in the sandbox started as root by the platform is
  contained by this: it is root of its own namespace, and only s5x's routing
  rule for forwarded packets keeps it from the door, the address the agent
  forwards these requests to;
- that operators, host root, or anything holding the tenant key cannot reach
  a password (the key can run commands, and its file writes run as root);
- that the edge never sees a `logins.set` body (TLS ends there);
- that deleting a login removes it from backups and memory images.

| endpoint | body | answers |
|---|---|---|
| `POST /v1/vault/logins/list` | `{}` | 200 `{"logins": [{"id": "lg_…", "websites": ["github.com"], "username": "ada", "hint": "…", "hasTotp": true}, …]}`: never a password or seed |
| `POST /v1/vault/logins/get` | `{"website": "github.com", "username": "ada"}`; `username` is optional | 200 `{"id": "lg_…", "username": "ada", "password": "…"}`; 404 when no login lists that website, or none that does has that `username`; 409 when several do and no `username` picks one, naming their usernames |
| `POST /v1/vault/logins/totp` | the same | 200 `{"code": "492039", "expiresAt": "2026-10-30T12:00:30Z"}`; 404 as for `get`, or when the login found has no TOTP seed; 409 as for `get` |

- **Which login a website finds.** A login lists 1 to 10 websites, each a
  lowercase hostname. One that lists `example.com` is found for `example.com`
  and for `www.example.com`; nothing else is implied (`login.example.com` is
  not). `username` narrows to logins with exactly that username, and `""` to
  the login with none; left out, or `null`, any login of that website. Two
  logins with one username never list the same website, or a website and its
  `www.` form, so a website and a username always find one login at most.
- **A code comes with at least 5 s to use it.** When fewer remain in the
  current step, `totp` waits for the next step, at most 5 s, and answers its
  code. Within one step the same code comes back, and a website accepts each
  code once (RFC 6238), so a second sign-in to the same website within one
  step waits until `expiresAt` and asks again.
- **`get` and `totp` answer a fixed size**, the JSON followed by spaces (which
  `JSON.parse` ignores), so no request log's byte count holds a password's
  length, and carry `Cache-Control: no-store`.
- **Only a running sandbox is answered.** One caught on its way to sleep gets
  409 with `Retry-After` (`this sandbox is not running right now …`): retry
  in a moment. One whose last create or wake did not pass its readiness
  check (`unhealthy`) gets 409 `this sandbox has not passed its readiness
  check, and logins are read only in a running sandbox`, with no
  `Retry-After`: it is answered again once a call from outside that needs it
  running, an `exec` say, has checked it again and found it ready.
- **Reads are recorded** in your sandbox's system log, which your platform
  reads with `Logs.query({ sandbox, source: "system" })` and can show its
  users. `login_read` counts `get`s, `login_code` counts `totp`s, and
  `login_refused` counts refused requests to any of the three, with their
  `kind` (`untrusted`, `unknown`, `browser`, `no-trusted-users`, …). Each line
  counts one minute's uses (`detail.count`) by one caller (`detail.uid`), and
  when a password or code was handed out names the login (`detail.login`) and
  which of its websites matched (`detail.website`): never a password, code or
  seed. A `list` that was answered is not recorded. A minute's lines are
  written once it has ended, stamped with its start. Past 64 lines in a minute
  for one sandbox, the rest of that minute's uses are one line per action,
  whose `detail.omitted` says how many.
- **What the log does not hold.** Past 50,000 lines in a minute for all your
  sandboxes together, or 200,000 for every account on s5x, a use is counted,
  but not recorded in its sandbox's log. Refusals past about 10 a second from
  one sandbox are refused and not counted. And a minute still open when s5x's
  control plane stops without warning is lost.

In your helper, as the trusted user:

```ts
declare function api<T>(method: string, path: string, body?: unknown): Promise<T>;
declare function fill(selector: string, text: string): Promise<void>;

// The helper's own browser, not the assistant's: the password goes from here
// into the form and nowhere else.
const login = await api<{ id: string; username: string; password: string }>(
  "POST", "/vault/logins/get", { website: "github.com" });
await fill("#login_field", login.username);
await fill("#password", login.password);
const { code } = await api<{ code: string; expiresAt: string }>(
  "POST", "/vault/logins/totp", { website: "github.com" });
await fill("#app_totp", code);
```

```bash
curl -sS -XPOST http://localhost:8081/v1/vault/logins/totp \
  -H 'content-type: application/json' -d '{"website":"github.com"}'
```

A sealed sign-in, a fresh Chrome over `--remote-debugging-pipe` with a
throwaway profile in the trusted user's home, its cookies exported and the
profile deleted after, is
[examples/sealed-sign-in/sign-in.ts](examples/sealed-sign-in/sign-in.ts),
which the helper runs for the harness;
[examples/README.md](examples/README.md) says how the pieces fit and why not
an agent-browser credential plugin.

## Who am I

| endpoint | body | answers |
|---|---|---|
| `POST /v1/whoami` | `{}` | 200 `{"sandbox": "sb_…", "ref": "user-4411"}`: your sandbox's id, and the name you created it with |

It is not `whoami()` from the SDK, which runs outside and says whose API key
it holds.

## Schedules

Your sandbox can schedule its own work, on a cron or once at an instant. Each
run wakes the sandbox, runs the command -- for five minutes at most, from the
image's `WORKDIR` (`/` with none, or one missing at run time) -- and records
how it went. Schedules are REST: a schedule's name is not a secret, so it is in
the path.

| endpoint | body | answers |
|---|---|---|
| `GET /v1/schedules` | | 200 `{"schedules": [schedule, …]}`: every schedule on your sandbox, ones made with an API key included |
| `POST /v1/schedules` | `{"name", "cron" or "at", "command", "maxLateness"?, "enabled"?}` | 201 the schedule; 409 a name your sandbox already has, or 100 schedules already; 400 a name, timing or command out of bounds |
| `PATCH /v1/schedules/{name}` | any of `cron`, `at`, `command`, `maxLateness`, `enabled` | 200 the schedule, its history kept; 404; 409 a one-shot that has had its occurrence |
| `DELETE /v1/schedules/{name}` | | 204; 404 |
| `GET /v1/schedules/{name}/runs?limit=N` | | 200 `{"runs": [run, …]}`, newest first, up to the 50 kept; 404 for a schedule that does not exist (an empty list means it has not run yet) |

- `name`: 1 to 63 lowercase letters, digits, `.`, `-` or `_`, unique on your
  sandbox. A one-shot that has run stays, disabled, as a record, and keeps its
  name until you delete it or 100 newer one-shots have run on your sandbox:
  s5x keeps the 100 newest, and deletes older ones with their history.
- `cron`: 5 fields, `@daily`, or `@every 30m`; at most once a minute. UTC,
  unless it starts `CRON_TZ=Europe/Berlin`, and then a fixed hour runs once on
  every local day, DST changes included. 5 fields or `@daily` runs at a
  second of its minute fixed for your sandbox (0 to 59; `nextRunAt` shows it),
  not at `:00`; `@every` runs every interval from when you made it. `at`
  instead: one RFC 3339 instant, with its offset, run at that instant.
- `command`: at most 4096 bytes. Put a longer script in a file and schedule
  `sh /path/to/job.sh`.
- `maxLateness`: how late an occurrence may still start (`"1h"`); later than
  that it is recorded `too_late` and not run. By default, until the next
  occurrence, or an hour for a one-shot. `""` clears it.
- A schedule in the answer carries `id`, `nextRunAt`, `lastRunAt`, `lastExit`
  and `lastOutput` besides what you sent; `maxLateness` comes back as
  `maxLatenessS`, in seconds.
- A run has an `outcome`: `ran` (with its `exit`), `not_run` (your sandbox is
  dead or being deleted), `too_late` (it could not be woken in time), or
  `unknown` (it started and its answer was lost, so it may have run).

Any process may read the schedules. Adding, changing and deleting them is any
process's too, unless the template names trusted users: then only they and
root may ([Trusted users](#trusted-users)), and you change them from your
platform's server instead, with the API or the SDK (`box.schedules.add`),
which check your key and no trusted user. Schedules made outside, with an API
key, are the same schedules.

A scheduled command runs as the image's `USER`, as `exec` does. On a template
with trusted users that user may not read the vault, so a schedule that
refreshes a token only pings your trusted helper, which reads and writes the
vault (below).

Delivery is at least once. A command that must not act twice -- a message to
a user -- keeps what it has done keyed on `S5X_SCHEDULE_ID` and
`S5X_SCHEDULED_AT`, which every run sees in its environment, and skips a pair
it has seen.

```ts
declare function api<T>(method: string, path: string, body?: unknown): Promise<T>;
type Schedule = { name: string; cron?: string; at?: string };

// This runs at every start, and add refuses a name that exists: add only what
// is missing. The command only pings the trusted helper, on a port of its own.
const { schedules } = await api<{ schedules: Schedule[] }>("GET", "/schedules");
if (!schedules.some((s) => s.name === "refresh")) {
  await api("POST", "/schedules", {
    name: "refresh", cron: "@every 30m", command: "curl -fsS -XPOST http://127.0.0.1:7070/refresh",
  });
}

// Once: a reminder in two days.
await api("POST", "/schedules", {
  name: "remind-8812",
  at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  maxLateness: "1h",
  command: "bun /app/remind.ts 8812",
});

await api("PATCH", "/schedules/refresh", { cron: "@every 1h" });
const { runs } = await api<{ runs: { outcome: string; exit: number | null }[] }>(
  "GET", "/schedules/refresh/runs?limit=5");
console.log(runs[0]?.outcome, runs[0]?.exit);
```

```bash
curl -sS -XPOST http://localhost:8081/v1/schedules \
  -H 'content-type: application/json' \
  -d '{"name":"digest","cron":"0 3 * * *","command":"sh /app/digest.sh"}'
curl -sS http://localhost:8081/v1/schedules/digest/runs?limit=5
```

The helper's side of the ping, as the trusted user: read the token, refresh
it, and write it back only if no other writer changed it meanwhile.

```ts
declare function api<T>(method: string, path: string, body?: unknown): Promise<T>;
declare function refreshAt(provider: string, refreshToken: string): Promise<string>;

/** Called when POST /refresh arrives on the helper's port. */
export async function onRefreshPing(): Promise<void> {
  const cur = await api<{ value: string; version: number }>("POST", "/vault/get", { key: "refresh_token" });
  const next = await refreshAt("https://oauth.example.com/token", cur.value);
  await api("POST", "/vault/put", { key: "refresh_token", value: next, ifVersion: cur.version });
}
```

## Keeping your sandbox awake: holds

Your sandbox sleeps once nothing has happened in it for its sleepAfter (CPU,
traffic, a request of its own awaiting its answer, a call from outside). Hold
it only for what that cannot see: a timer or `sleep`, a wait for an answer
over 5 minutes, a streamed answer quiet for longer than sleepAfter, heartbeats
rarer than sleepAfter, and QUIC. An agent turn waiting on a model, a sync or a
job your own code started keeps your sandbox awake while it works, and needs
no hold. Work that goes quiet past what s5x can see is frozen when your
sandbox sleeps: nothing is lost, but nothing wakes it either until something
outside touches the sandbox. `GET /v1/keepalive` says what your sandbox is waiting on.

**A hold keeps your sandbox awake for as long as its HTTP request stays
open.** Open it when the work starts and close it when the work ends; if your
process exits or is killed, the kernel closes the connection and the hold
ends with it. There is no id to keep and nothing to renew, and a crash cannot
leave one behind.

| endpoint | body | answers |
|---|---|---|
| `POST /v1/keepalive` | `{"name": "sync"}`, or `{}`; the name is at most 64 bytes, for reading in `GET /v1/keepalive` | 200 at once, `content-type: application/x-ndjson`: the line `{"held":true,"name":"sync"}`, then the same line every 5 s, for as long as the connection is open; 400 a body that is not `{"name": …}`; 403 a rule above; 429 when your sandbox already has 256 holds open |
| `GET /v1/keepalive` | | 200 `{"held": 2, "holders": ["hold sync", "process"], "awaiting": [{"remote": "104.18.32.7:443", "ms": 42000}], "top": "142.250.64.78:443", "released": 4000}`: what is keeping your sandbox awake from inside, holds by their names and each `keepAlive` process as `process` (its name is for the API's process list, outside); every request of its own still waiting on an answer, oldest first, at most 16 (a wait counts for 5 minutes); the address that moved the most data in the last second, absent when none did; and how many ms ago your last hold or `keepAlive` process ended, absent when none has (your sandbox sleeps its sleepAfter after that, not sooner) |

- **The first line means you hold it.** Start the work once it has arrived.
  A sleep that had already made its last check of your sandbox still goes
  ahead: the check comes just before s5x writes your sandbox's unsaved files
  to disk and freezes it, usually a few milliseconds, longer when a lot is
  still unwritten. The work then carries on at the next wake.
- **The hold ends when the connection closes**: your code closes or aborts
  the request, or your process ends. A client that only half-closes -- `nc`
  when its input ends -- ends it too.
- **Read the lines, or leave them; do not time them out.** One arrives every
  5 s so that a client's read timeout of 5 s or more never ends the hold;
  set none on this request if your client lets you.
- **If the stream ends while your work still runs, the hold is gone** (the
  agent restarted): take another.
- **Across a sleep, a hold stays.** When its host runs short of memory s5x
  sleeps a sandbox even through its holds; the connection is inside your
  sandbox, so it is still open when the sandbox wakes, and holds again. A cold
  boot -- a recovery, or a move to a new build -- starts your processes
  afresh, and every hold ends with the process that held it.

A process you start from outside with `keepAlive: true` (`s5x sandbox proc run
--keep-alive`) is held the same way for as long as it runs; when you control
how the work starts, that is simpler. Hold only around real work: a sandbox
that never sleeps keeps its memory the whole time, which is the cost s5x
exists to save.

In TypeScript or JavaScript:

```ts
/** Keep this sandbox awake while fn runs, and no longer. */
async function holding<T>(name: string, fn: () => Promise<T>): Promise<T> {
  let ac = new AbortController();
  const take = async () => {
    ac = new AbortController();
    const res = await fetch("http://localhost:8081/v1/keepalive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
      signal: ac.signal,
    });
    if (!res.ok || !res.body) throw new Error(`hold ${name}: ${res.status} ${await res.text()}`);
    const lines = res.body.getReader();
    await lines.read(); // the first line: held
    return lines;
  };
  let done = false;
  // Read the lines until fn ends. A stream that ends sooner is a hold that is
  // gone (the agent restarted): take another, once a second until one is held.
  const keep = (async (lines) => {
    while (!done) {
      try { while (!(await lines.read()).done); } catch { /* aborted, or cut */ }
      while (!done) {
        try { lines = await take(); break; }
        catch { if (!done) await new Promise((r) => setTimeout(r, 1000)); }
      }
    }
  })(await take());
  try {
    return await fn();
  } finally {
    done = true;
    ac.abort(); // closes the connection, which ends the hold
    await keep;
  }
}
```

```ts
declare function holding<T>(name: string, fn: () => Promise<T>): Promise<T>;
declare function waitForBatch(): Promise<string>;

// A batch API that answers in up to an hour: a wait over 5 minutes.
const result = await holding("batch", () => waitForBatch());
```

In a shell, for as long as one command runs. The command starts only once the
hold is taken, and the hold ends within 5 s of it, when curl's next line finds
no one reading:

```bash
curl -sSfN -XPOST -H 'content-type: application/json' -d '{"name":"backup"}' \
  http://localhost:8081/v1/keepalive | { read -r _ && /app/backup.sh </dev/null; }
```

Keep the `</dev/null`: the command must not read the hold's stream. Without
it, anything in the command that reads its input reads hold lines, and a
daemon it starts with that input keeps the pipe, and so the hold, open after
the command ends. The hold ends when the last process holding the pipe exits.

In Python, with `requests`:

```python
import requests

with requests.post("http://localhost:8081/v1/keepalive", json={"name": "sync"}, stream=True) as hold:
    hold.raise_for_status()
    lines = hold.iter_lines()  # keep it: a dropped iterator closes the connection
    next(lines)                # the first line: held
    run_sync()
# leaving the block closes the connection, which ends the hold
```

From a container in your sandbox, call it as `host.docker.internal` (with
`extra_hosts: ["host.docker.internal:host-gateway"]` in compose) or as the
bridge address, `172.17.0.1`: `http://host.docker.internal:8081/v1`, every
endpoint above, for your sandbox. On a template with trusted users, a
container on a bridge network of its own names no user s5x can see, so it
gets holds, `whoami` and schedule reads, and nothing only trusted users may
call; a rootless container, or one on the sandbox's own network, counts as a
user ([Trusted users](#trusted-users)).

## Your volumes, from inside

Each volume your sandbox holds is an ext4 filesystem mounted at its path, and
each snapshot one mounted read-only, where a write fails with EROFS. Find them
by path, never by device name (`/dev/vd…`), which is no promise.

- **A volume grows by itself.** A new one is 2 GiB; s5x watches how full it
  is and grows it, online, each time half of it is used: 2, 4, 8, 16, 32, 64
  GiB, then 64 GiB at a time, up to its `limitBytes`. `df` shows its size now.
  There is nothing to do from inside: `resize2fs` on a mounted volume fails
  with `Resource busy` and changes nothing, since no process in your sandbox,
  root included, can open a mounted volume's device for writing. Never resize
  a volume yourself, not even unmounted: one grown past what s5x gave it
  fails its writes with I/O errors.
- **Full is ENOSPC, never an I/O error.** At its limit, at your account's
  cap, or while its machine has no room to grow it, a write fails with ENOSPC
  (`No space left on device`) and the filesystem stays writable. The
  sandbox's system log says which (`volume_growth_refused`, its `reason`
  `limit`, `tenant_cap` or `host_full`). Delete what it, or your other volumes
  and snapshots, no longer need and writing works again; at your account's
  cap, s5x support can raise it. A writer faster than it grows, or one
  reserving more than half of it at once (`fallocate`), can meet ENOSPC for a
  moment, until the next step lands; retry the write. An I/O error writing to
  a volume nobody resized is s5x's fault, not yours: its machine's disk
  filled, and s5x is alerted. One resized from inside meets I/O errors past
  what s5x gave it (above): a backup from before the resize puts it back,
  `Volume.restore(id, { name, replace: true })`, which discards what was
  written since, so ask first.
- **What you delete is given back.** Freed blocks go back to the machine, by
  discard and a trim each hour, so the volume's `usedBytes`, what you are
  billed, falls. The filesystem itself never shrinks.
- **A detach waits for your processes.** It unmounts only once nothing in
  your sandbox holds the volume: a process whose working directory or root is
  on it, that has a file on it open or mapped, that has its device open, or
  whose own mount namespace still has it mounted (a container, Chromium's
  sandbox, `unshare -m`). Until then it is refused, naming up to 32 of them
  by pid and command; `force: "kill"` SIGKILLs them, and `force: "restart"`
  restarts your sandbox without the volume. Close what you hold on it, and
  `cd` out of it, before you ask for a detach.
- **Mounted over a directory that has files, a volume hides them** until it is
  detached. Nothing is copied or deleted.
- **An empty volume's root is the image's user's**, so the app can write to
  it at once; a volume that holds files keeps their owners. On a template
  with trusted users it stays root's (`root:root`, mode 0755): your root start
  script makes the directories each user needs on it.

## What your sandbox's kernel has

Your sandbox boots s5x's own build of Linux 6.18, a long-term line, made for
microVMs: `uname -r` says `6.18.<n>-s5x`, and `/proc/config.gz` is its whole
configuration. Whatever its point release, it has:

- **nftables** in the `ip` and `inet` families, with `reject`, connection
  tracking (`ct state`), NAT and `masquerade`, and matching the user or group
  a packet comes from (`meta skuid`, `meta skgid`).
- **iptables**, nft and legacy, with `-m owner` and `-j REJECT`.
- **Landlock**, for a process to confine what it may open.
- **User namespaces** for any user, **overlayfs** and **FUSE**, so rootless
  containers and `unshare` work.
- **cgroup v2**, with the cpu, memory, io, pids and cpuset controllers, which
  you mount: `mount -t cgroup2 none /sys/fs/cgroup`.
- **No IPv6.** It is off from boot: listen on `0.0.0.0`, not `::`.
- **Links and files in sticky directories are guarded**
  (`fs.protected_symlinks=1`, `protected_hardlinks=1`, `protected_regular=2`,
  `protected_fifos=2`): in a sticky directory others may write, such as
  `/tmp`, a process, root included, cannot follow a symlink, nor open with
  `O_CREAT` a regular file or FIFO, that another user owns, unless the
  directory's owner owns it; and a user cannot hard-link a file it does not
  own unless it may read and write it. Have each user write its own files, or
  in a directory of its own.
- **`ip rule` holds three rules of s5x's own**, at priority 0, which keep
  every user but root, and every packet forwarded from a container, off the
  address the agent forwards your vault, logins and schedules to. Rules you
  add are consulted after them. Root can remove them; s5x puts them back
  within 10 s, and until then, on a template with trusted users, refuses
  what only they may call.

Nothing inside your sandbox can change the running kernel: there are no
loadable modules, no kexec and no `/dev/mem`. `dmesg` is for root.

**Your sandbox keeps the kernel it booted with** while it sleeps and wakes. It
moves to a newer one when you build or push the template again and promote the
sandbox to it.

## Refusals

A refusal names its reason:

| The refusal says | Fix |
|---|---|
| `a POST to s5x inside your sandbox must send Content-Type: application/json (…)` | send `content-type: application/json` with a JSON body (`{}` when there is nothing to say) |
| `Host "…" is not a name s5x answers to here` | call it as `localhost`, by an IP address, or by a name under `.internal`, on any port |
| `… is served only to the s5x host, not to a process inside the sandbox` | exec, files, processes, env, volumes and the shell are driven from outside, with the SDK or the CLI |
| 404 `… is not a path s5x serves in your sandbox …` | the path is not one on this page: check its spelling, and that it has no trailing slash |
| 429 `this sandbox is calling its vault, schedules and whoami more than 50 times a second …` | keep what you read (a vault value, the schedule list) instead of asking again on every request |
| 429 `this sandbox already has 256 holds open …` | close holds you no longer need: one per piece of work, not one per request it serves |
| 413 `request body is larger than 1048576 bytes` | a request is at most 1 MiB |
| 400 `this request is not valid JSON` | send one JSON object with only the fields this page names. On the vault and logins the answer never quotes your body, since it may hold a secret |
| 400 `a vault value is at most 65520 bytes; …` | keep data in a file (on a volume, to keep it); the vault holds secrets |
| 409 `this sandbox already has a schedule named "…"` | list first and add only what is missing, or `PATCH` the one that is there |
| 409 `… was a one-shot and has had its occurrence …` | it is a record now; add a new one |
| 403 `only this template's trusted users may call …; this request came from uid 1000, which is not one of them` | call it from code running as a trusted user, or leave the secret to that code ([Trusted users](#trusted-users)) |
| 403 `only this template's trusted users may call …, and this request came from a user s5x could not tell (…)` | a container on a bridge network of its own: call it from a trusted process outside that container |
| 403 `… is served only to a template's trusted users, and this sandbox's template names none: build it with trustedUsers …` | logins need a template with trusted users: build it with `trustedUsers`, and promote the sandbox to that build |
| 403 `… refuses … when it carries Origin or Sec-Fetch-Site, as a web page's request does …` | drop those two headers from what your server forwards; a page in a browser is refused by design |
| 403 `this sandbox's / and /s5x are not both root's alone (…), so s5x refuses …` | root in the sandbox loosened them: treat it as a root compromise, and promote the sandbox to a fresh build ([When the vault refuses every caller](#when-the-vault-refuses-every-caller)) |
| 403 `this sandbox's list of trusted users (/s5x/trusted-uids) could not be read …` | build the template again and promote the sandbox to the new build |
| 403 `… cannot keep users other than root off its door right now, … retry in a moment …` | retry in a moment: s5x puts its rules back within 10 s |
| 404 `no login of this sandbox lists that website` | ask for a website a login lists (`POST /v1/vault/logins/list`), or have your platform set one |
| 404 `the login for that website has no TOTP seed` | your platform sets one from outside, with `totp` |
| 409 `N logins list that website; send the username of the one you want, one of: …` | send `username` with the website |
