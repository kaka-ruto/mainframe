---
name: s5x-cli
description: Drive s5x microVM sandboxes from the terminal with the `s5x` CLI (also installed as `sbx`) — create sandboxes from Docker images, run commands and long-lived processes inside them, copy files, publish preview and stable URLs, attach durable volumes, set encrypted env vars and website logins, add header rules and host allowlists, schedule cron jobs, snapshot/backup/restore, read logs, and ship a new template build to existing sandboxes (promote) or roll it back. Use this whenever the user mentions s5x, sbx, an s5x sandbox or template, or wants to deploy an agent, bot, webhook handler or dev environment into a sandbox that sleeps when idle and wakes on request — even if they only say "put this in a sandbox", "give it a URL", "run this in the VM", "why did my sandbox die", "keep the key or password out of the sandbox", "why can't it reach this host", or paste an `s5x` error. Prefer the s5x-sdk skill instead when the user is writing TypeScript/JavaScript code that calls s5x programmatically.
---

# s5x CLI

s5x runs each sandbox as its own microVM. The one property that
shapes everything else: **a sandbox sleeps when it goes idle and resumes as the
same running process tree** — same pids, same heap, same open files — the next
time anything touches it. Waking takes tens of milliseconds. There is no
`sleep` or `wake` command because there is nothing to drive: every command that
needs the sandbox wakes it.

The full list of commands and flags is in `references/commands.md` (generated
from the CLI itself, so it is exact). This file is about choosing the right
command and avoiding the mistakes that cost people data or time.

## Before the first command

Run `s5x whoami`. It proves three things at once: the binary is on `PATH`, a
credential is configured, and whose key it is.

- **`command not found`** — stop and tell the user the CLI is not installed.
  It installs only through `curl -fsSL https://s5x.dev/install.sh | sh`
  (macOS and Linux, arm64 and x64): suggest that and no other install path.
  It is not on npm, and the SDK (`bun add https://s5x.dev/sdk/<version>`) is a
  library, not the CLI.
- **`not signed in`** — sign in through the user's browser. `s5x login` waits
  for the browser for up to 15 minutes, longer than a foreground command may
  run, so:
  - With the user's browser on this machine, run `s5x login` **in the
    background** and tell the user to approve it in the tab it opens (it
    prints the link too). Exit 0 means the key is stored.
  - Otherwise (SSH, a container, a cloud agent), run
    `s5x login --no-browser --json`, give the user its `url`, and ask them to
    paste it into their browser's address bar rather than click it: a link
    clicked in a web page, this chat included, does not carry their sign-in,
    and the page then asks for an invite. When they read back the code the
    page shows (`XXXX-XXXX`), run `s5x login --code <code>`. The code works
    only here, once, for 10 minutes.

  The first time, the page asks for the invite s5x sent the user. An invite
  works once and signs in that one browser, which then approves with one
  click for 30 days from its last approval (90 at most); in any other
  browser, the page asks for an invite again. You get a key for the machine
  you run on and nothing more. Never read, print or copy a key: not from
  `~/.s5x/credentials.json`, not into a command, where it stays in shell
  history.
- A server or CI job signs in with `S5X_API_KEY`, which the user sets to a
  key they make with `s5x key create <name>` in their own terminal. It prints
  the key once. Never run `key create` yourself: whatever you run lands in
  the conversation and its logs, and it refuses without a terminal or under
  `--json` anyway. Give the user the command, in the form
  `k=$(s5x key create <name>) && <set it where the server reads it>`.
- `s5x key ls` lists the keys `s5x key create` made and `s5x key rm <id>`
  revokes one. Both use the key `s5x login` stored on this machine, never
  `S5X_API_KEY`.
- `S5X_API_KEY` in the environment **wins** over a stored login. If `whoami`
  names a key you did not expect, it is set. `s5x --json whoami` is
  `{name, id, key, source}`, where `key` is `{id, name, via}` (`via` is
  `login` for a key `s5x login` made, `key` for one `s5x key create` made,
  `operator` for one s5x issued) and `source` is `S5X_API_KEY` or the file
  the key is stored in.
- `s5x login` again replaces the stored key, and revokes the old one if a
  login made it; `s5x logout` revokes it the same way. Neither touches
  `S5X_API_KEY`. Any other key stays live, since a server may hold it.
  `s5x key rm` revokes one `s5x key create` made, once nothing uses it.
  `s5x key ls`'s last used is to the hour, so a time less than an hour old
  does not show the key is idle: check after an hour has passed.

## The model in five nouns

| Noun | What it is | Outlives the sandbox? |
|---|---|---|
| **template** | a Docker image turned into a bootable snapshot. It has no size: a sandbox is 1 vCPU / 2048 MB unless its create names another | yes |
| **sandbox** | one microVM booted from a template, addressed by your name for it (its *ref*) | — |
| **volume** | a durable disk on one machine, attached to one sandbox at a time at a path (`/data` by default), at create or later, running or asleep. It has no size: it grows on its own as it fills. A disk and nothing else: a sandbox created on an existing one is a new sandbox | **yes** — `sandbox rm` keeps it, detached |
| **endpoint** | a stable URL aimed at a sandbox's port; re-aim it with `endpoint point` (in force within about 5 s) | **yes** |
| **preview** | a token-guarded URL onto one sandbox's port, with an expiry | no |

Everything else — processes, env, network (header rules and allowed hosts),
vault, schedules, snapshots, backups — hangs off one sandbox and is reached as
`s5x sandbox <thing> <verb> <ref> ...`.

**Without a volume, nothing a sandbox writes survives it being replaced.** If
the user's data matters, give it a volume at create (`--volume <name>
--create`, at `/data`; `--volume <name>:<path>` for another path), or attach
one later (`s5x volume attach <ref> <name> --create`). `--create` makes a
volume you do not have yet; without it a name you have no volume of is
refused, so a typo never becomes a new, empty disk. A volume has no size to
choose: it starts small and grows on its own as it fills, up to a limit
`volume info` prints. Put the data under its path. A sandbox holds up to 4
volumes and 4 snapshots (`vsn_…`, read-only), each on the volume's own
machine. A sandbox created on an existing volume is a new sandbox: it gets
the disk and nothing else (no vault, header rules, env or schedules of the
one before). To change a sandbox's size, use `sandbox set --mem`, never rm
and create.

## Which command for which job

| The user wants to… | Use | Why this one |
|---|---|---|
| run a quick command | `sandbox exec <ref> "<cmd>"` | synchronous, **60 s hard cap** (`--timeout <seconds>`, default 30); exits with the command's exit code, or 124 if killed at its limit |
| run a server or bot that answers requests | `sandbox proc run <ref> "<cmd>" --name <n> --timeout 0` | detached, survives sleep as the same process; incoming requests wake it. **The default timeout is 600 s** — without `--timeout 0` a server is killed after ten minutes |
| run a background job (batch, crawl, build, training) | `sandbox proc run <ref> "<cmd>" --name <n> --timeout <s>` | a job that works -- CPU, data in or out, a request waiting on its answer -- keeps the sandbox awake by itself. Add `--keep-alive` only for one that goes quiet longer than `--idle`: a timer or `sleep`, a wait over 5 minutes. A job frozen by a sleep resumes when something touches the sandbox (`s5x sandbox exec <ref> true`) |
| watch one process's live output | `sandbox proc logs <ref> <name> --follow` | byte-exact; follows stdout (`--stream stderr` for the other; without `--follow`, both); wakes the sandbox and keeps it awake while you watch |
| find out what happened / why it failed | `s5x logs <ref> --since 1h --level warn` | **never wakes the sandbox**, and still works after it is deleted (by id if a new sandbox has taken the name) |
| show someone a port for a while | `sandbox preview create <ref> <port> --ttl 24h` | tied to this sandbox, token-guarded, max 90 days. Prints the URL, a link to `open in a browser` (`<url>/?_s5x_token=<token>`; the first visit swaps the token for a session cookie of at most 12 h) and a `curl` line. Code sends the token as `Authorization: Bearer <token>` or `x-s5x-token: <token>` |
| a URL that must not change (webhooks, prod) | `endpoint create <name> <ref> <port>` | survives the sandbox being replaced; add `--public` only for callers that sign their own requests. Without it the token is printed once, with a browser link, as for a preview |
| serve an endpoint at the user's own domain | `endpoint domain add <endpoint> <domain>`, then `endpoint domain check <domain>` | one CNAME at the domain's DNS provider, which `add` prints; no apex, DNS only on Cloudflare. See "Your own domain for an endpoint" |
| give the sandbox an API key or token it never holds (sent as an HTTPS header) | `sandbox network header set <ref> <host> <header>`, or `--header <host>:<header>` at create; **pipe the value in** either way | the value is added on the way out and never enters the sandbox, which holds only a placeholder; see "Credentials the sandbox never holds" below |
| let the sandbox reach only named hosts | `sandbox network allow <ref> api.github.com,pypi.org` (`--all` lifts it, `--none` allows only header-rule hosts), or `--allow-hosts` at create | enforced below the guest. Only TCP 80/443 to those hosts gets out, so a database or SSH host on the list stays unreachable. DNS lookups still leave through its resolver and can name any domain: a narrow channel the allowlist does not close |
| give the sandbox any other credential | `sandbox env set <ref> NAME` with the value piped in, or `--env` at create | encrypted at rest, names readable but values never; the sandbox holds the value. Leave the value off and pipe it in (`printf '%s' "$TOKEN" \| s5x sandbox env set <ref> TOKEN`), which keeps it out of shell history and `ps`; with nothing piped it fails with `<NAME> needs a value` (on a terminal it prompts instead, which you cannot answer). `--env` at create takes the value as an argument: pass `"$VAR"`, never the literal (`ps` shows it during the call) |
| store a website's password, and its TOTP seed, for your trusted helper to sign in with | `sandbox vault login set <ref> --website github.com --username ada`, the password piped in or typed at the hidden prompt; `--totp-stdin` takes the seed from stdin | write-only: no command shows a password or seed again, and the seed never enters the sandbox. Only the template's trusted users read a login inside (`http://localhost:8081/v1/vault/logins/...`, the s5x-sdk skill's `references/guest.md`). `vault login ls` lists websites, usernames and hints; `vault login rm` deletes one |
| keep the assistant's own code from the vault, logins and schedule changes | `template build <image> --name <n> --trusted-users helper` (or `push`), then `template promote` | only those users of the image (`@group` for a group) and root may read the vault and logins or change schedules inside. The image declares a `USER` it does not trust, which `exec`, the shell and schedules run as, and its entrypoint runs as root to start each program as its own user: a small helper as the one trusted user, everything else, the harness too, as `USER` |
| a value code in the sandbox must *read or update itself* (tokens from an OAuth flow it runs, a refresh token it rotates, a webhook secret it generates and checks) | `sandbox vault get <ref> <key>` (and `vault set`, the value piped in as for env) from outside; code inside reads and writes it over plain HTTP at `http://localhost:8081/v1/vault/...`, with no credential (the s5x-sdk skill's `references/guest.md`) | the sandbox's own store, ending with the sandbox. An API key the sandbox only spends is a header rule instead (`sandbox network header set`), which the sandbox never holds |
| checkpoint before a risky change | `sandbox snapshot create <ref> <name>` | fast, you name it; restore is in place; at most 10 per sandbox (a name it already has is replaced; `snapshot rm` deletes one). **Pauses a running sandbox for a few seconds** for the copy, like a backup |
| keep a user's data backed up | nothing: every volume is backed up **every day, automatically**, the first time 15 minutes after it is made (a fork and a restore into a new volume too), attached or not; `volume set <name> --backup-days <n>` keeps each 1 to 30 days (7 by default), `0` stops them | the volume alone, encrypted, at a time of day of its own, **never sleeping or waking its sandbox**: a running one is paused for the milliseconds the copy takes, after its writes are flushed, so the backup holds the volume as a power cut would leave it. A day it did not change -- detached, or its sandbox asleep or dead, since its last backup -- is skipped, and its newest is kept until a newer one replaces it or the volume is deleted. It is no activity of the sandbox's, and a backup, restore, snapshot or erase you start before it has begun takes its place. `volume backups <name>` shows them as `automatic`. Memory and processes are only in a sandbox's backup, which you take |
| a copy that survives losing the machine | `sandbox backup create <ref>` | the same as a snapshot, but kept in object storage off the machine, encrypted: the sandbox is paused only for the copy (seconds) and runs on while it uploads; `create` waits until it is taken, and Ctrl-C stops the wait, not the backup (`--no-wait` answers at once with its id). Restores **only onto this same sandbox**. `backup ls` with no ref lists all of your finished backups, a deleted sandbox's too; `backup rm <id>` deletes one. Kept until you delete it |
| back up a user's data while their agent works | `volume backup <name>` | the volume alone, attached or not: **never sleeps its sandbox** -- it is paused for the milliseconds the copy takes, even under a keep-alive -- and holds no memory, so nothing the guest had in RAM. A dead sandbox's volume can be backed up too. `volume restore <backup-id> <name> --replace` puts it back over the volume; an attached one's sandbox boots cold at its next wake |
| bring a sandbox back after its machine is lost (`sandbox ls` says `machine lost`) | `sandbox backup restore <ref> <backup-id>` of a machine backup (`sandbox backup create`); with no volume, `sandbox recover <ref>`; a volume alone, `volume restore <backup-id> <new-name>` of its newest | the restore moves the sandbox to another machine with the backup and the volumes it holds, under the same name, losing what it wrote since; the recover moves one with no volume and starts it fresh from its build; a volume's backup, automatic ones at most a day old, makes a new volume elsewhere. If the machine answers again, its sandboxes and volumes come back as they were, so ask the user first. The restore and the recover wait until s5x has made sure the lost machine is off (until then they are refused, 409 `machine_lost`); the volume's restore does not |
| clone a user's data onto a new disk | `volume restore <backup-id> <new-name> [--next-to <ref>]`, then `volume attach <ref> <new-name>` | makes a NEW volume of a volume's backup, or of one `--drive` of a sandbox's: a disk and nothing else. `--next-to` puts it on that sandbox's machine, the only place it can be attached to it; without it, any machine with room |
| try something on a copy of a user's data | `volume snapshot take <name>`, then `volume fork <vsn_…> <new-name>` and `volume attach <ref> <new-name>:<path>` | a snapshot is a clean copy, at once, on the volume's machine; a fork is a new volume of it, at once, sharing its blocks until written. Attach a snapshot itself read-only to any number of sandboxes there: `volume attach <ref> <vsn_…>:<path>` |
| make a sandbox bigger or smaller | `sandbox set <ref> --mem <MB> [--vcpus N] [--now]` | the same sandbox, everything kept; it boots its own disk cold at the new size -- its processes restart -- at its next wake after a sleep, or at once with `--now` (needed for one with `--idle 0`). Never `sandbox rm` and create again to resize |
| delete a user ("delete my account") | `sandbox erase <ref>` | the sandbox and everything derived from it: its vault, logins and header rules, the volumes it holds and their snapshots, its own snapshots, schedules, previews, and every backup of it and of those volumes, in storage too. Prints what it removed. An endpoint pointed at it stays (it is yours), and its log records expire after 30 days; a volume restored or forked from its volumes is a volume of its own, so delete it too. Refused while another operation of yours runs on it (s5x's daily backup never refuses it: one under way is waited for, and erased with the rest), and while a snapshot of one of its volumes is attached to another sandbox; its volumes attach to nothing until it is done. On a machine that does not answer it still removes the vault, logins, rules, schedules, previews and backups, and fails saying what is left is on that machine |
| follow a backup, restore, snapshot or erase you stopped waiting for | `operation show <id>`, `operation wait <id>` | each is an **operation**, with an id (`bk_…`, `rs_…`, `snp_…`, `er_…`): where it is, or why it failed. `operation ls --kind backup --unfinished` is every backup still under way, across all your sandboxes -- how a fleet's backups are followed -- and `--failed --limit 1000` the ones that failed. Kept a day after it finishes |
| run something on a schedule | `sandbox schedule add <ref> <name> --cron "..." --exec "..."` | wakes the sandbox, runs (for at most five minutes), records exit code and output |
| restart the image's entrypoint (`app`) | `sandbox proc restart <ref> app` | ends it and what it started, and starts it again 2 s later, with the env of the sandbox's last boot or wake; it loses what it held in memory, so ask first. `proc kill app` is refused |
| bring back a sandbox in state `dead` | `sandbox recover <ref>` | same disk, fresh boot: only the entrypoint comes back; start `proc run` processes again. s5x does this itself for a sandbox whose VM died awake (at every wake, and on its own with `--idle 0` until five tries fail; `s5x logs --source system` shows `died`, `recovered`, `recovery_failed`, and `resized`, `machine_lost` and `moved` for a size change, a lost machine and a move off one). A dead sandbox is kept until you recover or delete it (`references/workflows.md`, "Bring back a dead sandbox", which also covers restoring a snapshot or backup instead) |
| ship a new build to sandboxes that already exist | `template promote <name> <build>` | a push alone gives only NEW sandboxes the build; this switches existing ones at their next wake, keeping their volumes; **rollback is promoting the older build** |
| take a volume off a sandbox, or give it to another | `volume detach <ref> <path>`, then `volume attach <other> <name>[:<path>]` | refused while processes in the sandbox hold it, naming them: stop them, or `--force kill` (kills them) or `--force restart` (restarts the sandbox without it, the one way off a dead sandbox). A volume is attached only on its own machine |

Ports are **positional**: `endpoint create api web 3000`, not `--port 3000`.

## Things that behave differently from what you would guess

- **`env set` reaches only processes started after the sandbox's next boot or
  wake.** A running process keeps its env through sleeps and wakes, and on an
  awake sandbox an `exec`, or a process restarted straight after `env set`,
  still gets the old set. Give env at create (`--env`); it is there from the
  first boot. To change a value a `proc run` process uses now, `env set` it for
  later boots, `proc kill` the process, and once `proc ls` no longer shows it
  `running`, start it again with `--env NAME="$VALUE"` and the flags it was
  started with (`--timeout 0` for a server; a job's `--timeout`,
  `--keep-alive`, `--cwd`). The kill-and-wait loop, with the `-9` escalation,
  is in `references/troubleshooting.md`, "A new env var is not visible to the
  app".
- **If the image's entrypoint runs the app, give it env, header rules and
  allowlist at create** (`--env`, `--header`, `--allow-hosts`). As the
  supervised process `app` it refuses `proc kill`, and
  `s5x sandbox proc restart <ref> app` starts it again with the env of the
  sandbox's last boot or wake, so it sees a later `env set` only once it
  starts again after the next boot or wake: a `proc restart` then (ask first:
  it loses what it holds in memory), an exit of its own, or
  `sandbox promote <ref> <another build> --now`.
  If a value will need to change, start the app with `proc run` instead. The
  trade-off: `app` is restarted 2 s after any exit, a crash or out-of-memory
  kill included, and nothing restarts a `proc run` process (`proc ls` shows how
  it exited).
- **The image's `CMD`/`ENTRYPOINT` must keep running.** It runs as `app` with
  no terminal and its stdin empty, so a runtime image's default command
  (`oven/bun`, `python`, `node`, `alpine`: a REPL, a shell or a usage message)
  exits at once. `app` then restarts every 2 s for the life of the sandbox,
  each exit adds a `--- s5x: entrypoint exited rc=N, restarting ---` line to
  its stderr (`s5x logs <ref> --proc app`), and `proc ls` still shows `app`
  `running`. For an image you drive with `proc run`, end its Dockerfile with a
  command that stays up, such as `CMD ["tail", "-f", "/dev/null"]`.
- **`exec` takes the command as one quoted argument.** `s5x sandbox exec dev "ls
  -la /srv"`, not `... exec dev ls -la /srv`.
- **Commands start in the image's `WORKDIR`, like `docker exec`**: `exec`,
  `shell`, scheduled commands and `proc run`, as the entrypoint does. With no
  `WORKDIR`, or one that is missing at run time, they start in `/`. `proc run`
  takes `--cwd`; `exec` doesn't, so use `cd /path && …`, as in
  `s5x sandbox exec dev "cd /srv/tools && make"`. In an image with a `USER`, a
  relative write fails where that user cannot write: `/`, or a `WORKDIR` the
  Dockerfile made before `USER`, which is root's.
- **Never start a server or job with `exec "… &"` or `nohup`.** What it leaves
  has no name for `proc ls`/`logs`/`kill`, its output is deleted when `exec`
  replies, and it keeps `exec`'s out-of-memory rank, among the first killed.
  Use `proc run`.
- **A kill at the time limit (`exec --timeout`, `proc run --timeout`) is a
  SIGKILL, so a program's own output buffer dies with it**: only what reached
  its stdout or stderr comes back. Python buffers when its output is not a
  terminal, which in a sandbox it never is: run it as `python3 -u`. Do not
  pipe through `head`, `grep` or `sed`, which buffer too; send the output to a
  file instead.
- **A value that starts with `-`** needs `--` before it, or it is read as a flag:
  `s5x sandbox env set dev FLAGS -- --verbose`.
- **A sandbox sleeps once nothing has happened in it for its sleepAfter (30 s
  unless you set it): no CPU work, no data in or out, no request of its own
  waiting on an answer, and no call from you in flight. Hold it awake
  (`POST http://localhost:8081/v1/keepalive`, or a `keepAlive` process) only
  for what that cannot see: a timer or `sleep`, a wait for an answer over
  5 minutes, a streamed answer that goes quiet for longer than sleepAfter, a
  connection whose heartbeats are rarer than sleepAfter, and a QUIC request.**
  So an agent turn, a build or a job needs no hold while it works. It sleeps
  within about 4 s past `--idle`, and no sooner than 5 s after an `exec`, a
  `cp`, a `proc` call or a wake ends; `--idle` is 0 or at least 5.
  `s5x sandbox stats <ref>` says what it last did (`last activity  traffic →
  142.250.64.78:443, 1 s ago`).
- **A browser in a sandbox:** launch it through Puppeteer or Playwright, or
  pass `--disable-background-networking --disable-component-update` to a raw
  launch: a browser's own background traffic otherwise keeps your sandbox
  awake.
- **Keeping a sandbox awake is rarely right.** `--idle 0` (never sleep) holds
  memory permanently *and* gives up the memory snapshot — if its VM dies there is
  nothing to resume, so it goes `dead` and the process tree is lost (s5x boots
  it again on its own disk by itself). Endpoints and
  previews wake a sleeping sandbox on the first request, so a URL does not need
  it. Use `--idle 0` only when a ~tens-of-ms wake on the first request is
  genuinely unacceptable.
- **An open connection keeps a sandbox awake, a WebSocket included.** A
  request through a preview or endpoint counts as activity until it ends, so a
  socket a client leaves open (a page left in a tab, a live feed) holds the
  sandbox awake for as long as it stays open. Close idle sockets from the
  client, or have the app close them. Only a host short of memory, with nothing
  else to free, sleeps it anyway, last of all, and closes its connections.
- **The app behind a preview or endpoint must listen on `0.0.0.0`**, not
  `127.0.0.1` or `::1`, on the port the URL names. A request that arrives while
  the app is still starting (just after `create` or `recover`, or while a
  crashed app restarts) waits for the port, up to 10 s, then goes through
  whole. Past that it gets a 503 naming the port: see troubleshooting.md.
- **`exec`, `proc run`, `shell` and scheduled commands run as the image's
  `USER`** (`USER app` means `app`, like `docker exec`), with its primary group
  only, like the entrypoint (which runs as root instead on a template built
  with `--trusted-users`). No flag runs a command as root. **`cp` is
  different: it reads and writes with root's reach**, so it can put a file
  where `exec` cannot and copy out one `app` cannot read. What it creates
  (the file and any directories it makes) belongs to `app`; a file it replaces
  keeps its owner, so replacing a root-owned file leaves one `app` cannot
  change.
- **`sandbox cp` moves one file; never copy through `exec`'s output**
  (`exec dev "cat /data/x.tgz" > x.tgz`, or a `tar czf -` stream): binary
  arrives corrupted, with exit 0 (`exec` then says `the output was not text`
  on stderr). Copied into a directory (`.`, `dir/`, `<ref>:/data/`), a file
  keeps its name. A file of up to 100 GiB copies in (over 32 MiB it goes in
  parts and is then placed; at most 4 at once into one sandbox), and
  downloads have no cap. A copy in that finishes is on the sandbox's disk:
  a crash of the sandbox or its host does not lose it. An upload lands at mode 0644, even over an
  executable: run a copied script as `sh /data/job.sh`, or `chmod +x` it with
  `exec`. A directory goes as a tarball unpacked where the image's user can
  write; data that already has a URL, the sandbox can download itself as a
  detached `proc run`. Both recipes: `references/workflows.md`, "Get code and
  data in and out".
- **Schedules run in UTC** unless the expression is prefixed:
  `--cron "CRON_TZ=Europe/Berlin 0 3 * * *"`; a fixed hour there runs once on
  every local day, DST changes included. A 5-field or `@daily`-style cron runs
  at a second of its minute that is fixed for its sandbox (0 to 59;
  `nextRunAt` shows it, e.g. 03:00:37), so the same cron on many sandboxes does
  not wake them all in the same second; `@every 15m` runs every 15 minutes from
  when you made it. `--at <RFC 3339>` runs once instead, at that instant.
  A name is unique on its sandbox. `schedule run` starts it at the next poll,
  within seconds. `schedule runs` shows every occurrence's outcome: `ran`,
  `not_run`, `too_late` or `unknown` (it may have run) -- delivery is at least
  once, so a command that must not act twice dedupes on `S5X_SCHEDULE_ID` +
  `S5X_SCHEDULED_AT`.
  A command is at most 4096 bytes: put a longer script in a file in the
  sandbox and schedule `sh /path/to/job.sh`. **A run is killed after five
  minutes (exit 124), and no option extends it.** Longer work is a
  `s5x sandbox proc run <ref> "<cmd>" --name <n> --timeout <s>` job (with
  `--keep-alive` if it goes quiet longer than `--idle`) started from a timer
  of your own (cron on your machine, a CI schedule),
  with `<s>` above its longest run, because the 600 s default would kill it.
  The call wakes a sleeping sandbox, and a fixed `--name` is refused while the
  previous run is still going. Recipe: `references/workflows.md`, "Run
  something every night".
- **Move a sandbox to a new build with `sandbox promote`, not `rm` + `create`**:
  promote keeps its snapshots and backups. `sandbox rm` deletes the snapshots,
  and a new sandbox with the same name is a different sandbox, so the old one's
  backups are refused on it. They are still stored until you delete them:
  `s5x sandbox backup ls` (no ref) lists every backup you have, the SANDBOX
  column naming the one it came from, and `s5x sandbox backup rm <id>`
  deletes one.

## Where a secret goes

Four places, each for one kind of secret. Picking the wrong one is a security
bug:

| the secret | set it with | code inside reads it | read back from outside |
|---|---|---|---|
| an API key the sandbox only sends, in an HTTPS header | `sandbox network header set <ref> <host> <header>`, the value piped in | never: s5x sets the header on the way out (below) | never |
| a website's password and TOTP seed, for your trusted helper to type into a sign-in form | `sandbox vault login set <ref> --website <host>`, the password piped in | `POST http://localhost:8081/v1/vault/logins/get` and `/totp`, by the template's trusted users and root alone; the seed never enters the sandbox | never |
| a value code inside reads or updates itself: a refresh token it rotates, a webhook secret it made | `sandbox vault set <ref> <key>`, the value piped in | `POST http://localhost:8081/v1/vault/get`; on a template with trusted users, by them and root alone | `sandbox vault get` |
| a credential a header rule cannot carry: a database URL, a key a JVM or gRPC client sends | `sandbox env set <ref> <NAME>`, the value piped in, or `--env` at create | its environment, from the next boot or wake | never |

**Trusted users keep the assistant's own code from the vault and logins.** A
template built with `--trusted-users helper,@ops` names the users of its
image (and `@group`s) that may read the vault and logins or change schedules
inside its sandboxes; every other user and a web page get 403. A container
counts as the user whose socket reaches s5x: a rootless one as the user that
started it, one on the sandbox's network as the user it runs as, and one on a
bridge network of its own as no user, which gets 403 too. Run a small helper
as the only trusted user, one that signs in and never returns a secret, and
everything else, your harness too, as the image's `USER` (a trusted user
never starts anything for untrusted code): the assistant's own code, and any
bug in the harness, cannot read the vault or a login, even with a shell.
Change schedules from your side, with `sandbox schedule`, which checks no
trusted user. What code inside calls, a worked helper (the s5x-sdk skill's
`references/examples/`), what s5x guarantees and does not, and how each read
is recorded (`s5x logs <ref> --source system --grep login_`): the s5x-sdk
skill's `references/guest.md`, "Trusted users" and "Logins".

```bash
printf '%s' "$GITHUB_PASSWORD" | s5x sandbox vault login set u-1 --website github.com --username ada --hint "work account"
printf '%s' "$GITHUB_TOTP_URI" | s5x sandbox vault login set u-1 --id lg_… --totp-stdin   # add the seed
s5x sandbox vault login ls u-1             # id, websites, username, hint, totp: never a password or seed
```

## Credentials the sandbox never holds, and the hosts it may reach

A **header rule** sets one header on every HTTPS request the sandbox makes to
one exact host, on the way out. The sandbox holds only a placeholder where it
expects the key; the real value never enters it, its memory image, its
snapshots or its backups, and nothing can read it back. An **allowlist** limits
which hosts the sandbox can reach. Both are enforced below the guest.

A rule keeps the key out of the sandbox, not out of use: every process in it,
including code your users run, can call the rule's host and have the key added.
Give the rule a key made for this purpose, with a spend limit, and watch its
usage.

```bash
# entrypoint app: every placeholder, the first rule and the allowlist at create
printf '%s' "$ANTHROPIC_API_KEY" | s5x sandbox create agent-1 --template agent \
  --env ANTHROPIC_API_KEY=placeholder --env OPENAI_API_KEY=placeholder \
  --header api.anthropic.com:x-api-key --allow-hosts pypi.org,files.pythonhosted.org
# each further rule has its own pipe after the create (see the first bullet)
printf 'Bearer %s' "$OPENAI_API_KEY" | s5x --json sandbox network header set agent-1 api.openai.com Authorization
s5x --json sandbox network ls agent-1   # {allowedHosts, headers}: names, never values; null = any host
```

- **Pipe the whole header value in** (`Bearer …` for `Authorization`); you
  cannot type into the hidden prompt, and if the key is not in your
  environment, ask the user to run it. One pipe carries one value: one
  `--header` at create, the rest with `network header set`. Those later rules
  were not there at first boot: if an entrypoint app cannot wait for them,
  start it with `proc run` once every rule is set.
- **A rule covers HTTPS on port 443 to exactly that host** (at most 20
  rules). Plain HTTP (even to the rule's host), another port and a near-miss
  name (`anthropic.com` is not `api.anthropic.com`) go out with the
  placeholder; under an allowlist, another port and an unlisted name are
  refused instead. A JVM, gRPC or own-roots client cannot use a rule at all:
  give it its key as env.
- **On an existing sandbox a rule needs no restart**: processes get it on each
  connection they open from then on. `saved; in force within about 20 s`
  (`"pending": true`) means what it says, so wait that long before testing.
- **The header is set, never searched for**: a placeholder the sandbox
  writes into a message body or a query goes out as written, so it cannot
  make the key appear there. A TRACE to a rule's host is refused (405).
- **A rule holds a static key.** A user's OAuth grant is your app's to keep
  and refresh (or its provider's, such as Composio): a token the sandbox must
  read goes in its vault, and one only its requests carry can go in a header
  rule you set again after each refresh.
- **These limits apply to every sandbox, with or without rules or an
  allowlist.** Port 25 is refused at once (`Connection refused`), so send
  mail through a provider's HTTPS API, or SMTP submission on 587 (or 465)
  with the account's credentials. Only public addresses are reachable:
  other sandboxes and private or reserved IPv4 ranges (10/8, 172.16/12,
  192.168/16, 100.64/10, 169.254/16, multicast and the like) are dropped,
  so a connect there times out. And a sandbox opens at most 50 new
  connections a second, in bursts of up to 200. Every TCP connect, UDP flow
  (so each DNS lookup) and ping counts, and open connections do not. Past
  the cap, new connections are dropped and TCP retries them a second later:
  a burst shows up as slow connects, not errors. Reuse connections
  (keep-alive), and pace a crawler. It holds at most 2,048 connections open
  at once; past that a new one is refused at once (`Connection refused`).
  With a header rule or an allowlist, ports 80 and 443 go through the
  sandbox's proxy, which holds at most 256 connections open at once, for both
  ports together; past that a new one is reset at once (`ECONNRESET`).

Read `references/workflows.md` before setting up a rule or an allowlist
(which clients trust the proxy, what an allowlist lets through, when a
change drops open connections, moving a key out of env, the `--json` shapes),
and `references/troubleshooting.md` when one misbehaves (a 401 despite a rule,
a certificate error, an unreachable host), when mail will not send, or when
connects are slow.

## Your own domain for an endpoint

An endpoint answers at its own hostname, and can answer at a name of the
user's too, such as `bot.example.com`, with one record at that name's DNS
provider: a CNAME from the name to the endpoint's hostname, which
`s5x endpoint ls` prints. No TXT record, no certificate to bring.

```bash
s5x endpoint domain add hook bot.example.com    # prints the record to add
s5x endpoint domain check bot.example.com       # exits 0 once it is active
```

- The record is `bot.example.com CNAME <the endpoint's hostname>`. If the
  name's DNS is on Cloudflare, set it to **DNS only** (grey cloud): a proxied
  record hides the CNAME, and the domain fails saying so.
- `check` looks for the record now and prints where the domain stands. It
  exits `0` once it is `active`, served at `https://<domain>`; `1` while it is
  `pending` (no record seen yet) or `issuing` (its certificate is being made,
  usually within minutes, and it is already served); `2` when it `failed`:
  read the reason, fix what it names, and run `check` again, which restarts
  it. s5x also looks by itself, every minute in the first hour and hourly
  after; a domain whose record it does not see in 7 days fails.
- No apex (`example.com` itself): most DNS providers cannot put a CNAME
  there. Use `www.example.com`, and redirect the apex to it at the DNS
  provider.
- If the name or a parent has CAA records, they must allow `pki.goog`,
  `letsencrypt.org` and `ssl.com`.
- The app sees the domain as the request's `Host`. The endpoint's own URL
  keeps working, and a token endpoint still asks for its token.
- Up to 20 domains an account, each on one endpoint: `endpoint point` keeps
  them, `endpoint rm` removes them too. `endpoint domain ls` lists them with
  their states; `endpoint domain rm <domain>` stops one within about 5 s.

## Templates: build, promote, roll back

```bash
# From a local image (needs Docker). Sandboxes are linux/amd64 — on Apple
# silicon, build with --platform linux/amd64 or push refuses the image.
docker build --platform linux/amd64 -t myapp:dev .
s5x template push myapp:dev --name web

# Or from an image in a public registry.
s5x template build ghcr.io/acme/web:1.4 --name web

s5x template show web        # each build: digest, status, latest, sandboxes on it
```

A template has no size. The size is the sandbox's, given at its create:
`sandbox create --vcpus N --mem MB`, 1 vCPU / 2048 MB if left out, at most 4
vCPUs and 8192 MB. Every build saves its ready image at that default, so a
default sandbox starts in milliseconds and one of another size boots cold, in
seconds. Its root filesystem is sized from the image: the image unpacked plus 2
GiB free, at most 20 GiB. `push` ships at most 5 GiB compressed; a larger
image goes to a registry first, then `template build <registry-ref>`.

The image's `CMD` is the sandbox's `app` and must keep running (see "Things
that behave differently" above): a runtime image such as `oven/bun:1-alpine`,
whose default command exits at once, restarts every 2 s. Build such an image
from a Dockerfile whose `CMD` starts your app, or one that stays up
(`CMD ["tail", "-f", "/dev/null"]`) if you start the app with `proc run`.

Use an image with a shell and the usual tools (alpine, debian-slim, ubuntu). A
distroless or scratch image builds and boots too; `exec`, `proc run` and the
shell then run in s5x's own minimal shell.

**Trusted users.** `--trusted-users helper,@ops` on `template build` or `push`
names the users of the image (or `@group`s, at most 16) that may read the
vault and logins or change schedules inside its sandboxes; root always may and
is never named. The image must then declare a `USER` it does not trust, and
its entrypoint runs as root, to start each program as its own user; the build
fails naming an entry the image does not have, root, `nobody`, or a `USER`
that is missing, root or trusted. A build without the flag keeps the name's
last build's list; `--trusted-users ""` clears it. Once ready, the build
prints a `warning: …` line on stderr for each thing in the image that could
give another user a trusted user's reach (a `sudo` rule, a setuid binary, a
container runtime); it does not refuse them. Under `--json` they are the
build's `warnings`.

`push` and `build` wait until the build is ready, printing each status it
passes through (`pending` → `building` → `ready`), then `web@<digest> ready`
(the ready build under `--json`). A build that fails exits 1 with why; what to
do: `references/troubleshooting.md`, "A template build failed". A wait that
cannot check on the build (a 500, a dropped connection) also exits 1, but says
`could not check on …; your build carries on`: that build did not fail. Ctrl-C
stops the wait, not the build: `template show` lists it with its status later,
and a failed one with why on a line under the table (`.error` under `--json`).

**A push is what new sandboxes get; it moves none that exist.** Once a build
is ready, `--template web` gives a new sandbox that build, the way a pushed
Docker tag does (the later push wins, whichever finishes first, and a
promote made after a push, such as a rollback, wins over it). A sandbox
that already exists keeps running the build it has until it is **promoted**,
the one act that restarts what runs:

```bash
s5x template promote web 3f9a1c2b7d4e   # the digest `template show` prints
```

That makes **every existing sandbox of `web` switch to that build at its next
wake** (and new ones get it too). An awake sandbox is never interrupted, so a
large fleet moves gradually as its users come back. **Rolling back is
promoting the older build's digest**, and a build pushed before the rollback
does not undo it by finishing later.

There are no tags or version numbers (`web:v2` is refused); every build has its
own digest, even a rebuild of the same image. `--template` takes three
spellings:

| Spelling | Means |
|---|---|
| `web` | `latest` — the most recently pushed build that is ready, or the one promoted since |
| `web@<digest>` | exactly that build — the 12 hex digits `template show` prints are enough |
| `tpl_…` | one build by id |

Whichever it is, the sandbox runs that build until it is promoted to another.

**Old builds are deleted for you.** s5x keeps every build in use, the 20 newest
builds of each template, and anything built in the last 30 days; other builds
are deleted 30 days after they were built. In use means a sandbox runs it or
is promoted to it, it is the name's `latest`, a snapshot or backup of yours can
restore it, or an operation in progress needs it. `template show` prints when
each other build is deleted under EXPIRES (`.expiresAt` under `--json`, `null`
while it is kept); a build that failed is deleted a day after it started. To
keep a build to roll back to past that, keep a sandbox or a snapshot on it.

## Moving existing sandboxes to a new build

A switch **restarts the sandbox's processes on the new build** (a memory image
cannot cross builds) and keeps what is the sandbox's: its **volumes**, env,
vault, logins, schedules, previews, endpoints, header rules and allowlist, snapshots
and backups. Anything written
outside its volumes is lost, because the root filesystem is the new build's.
That includes process output: after the switch, `s5x logs <ref> --proc <name>`
(`app` and `console` too) and `sandbox proc logs` show only the new build's
output. A snapshot or backup restore likewise drops the output written since
the checkpoint (and clears `console`). Records (access, audit, system) stay. To keep it, save it
before the promote or restore:
`s5x logs <ref> --proc <name> --stream all > <name>.log` (the newest page, up
to 1 MiB, of each stream).
**Tell the user this before promoting**; for a whole name it applies to every
sandbox of it.

The image's own entrypoint starts again by itself, with the sandbox's current
env. **A process started with `sandbox proc run` does not come back**: start
it again after the switch, or, for a fleet that switches unattended, make the
app the image's entrypoint.

```bash
s5x sandbox snapshot create web-1 before-v4    # optional: a way back, processes and all
s5x template promote web 3f9a1c2b7d4e          # the whole fleet, at each one's next wake
s5x template show web                          # SANDBOXES / SWITCHING show the progress
s5x sandbox ls                                 # "web@9c2e7a14b0d3 → 3f9a1c2b7d4e" = not yet switched
s5x sandbox promote web-1 3f9a1c2b7d4e --now   # one sandbox, immediately
s5x sandbox promote web-1 9c2e7a14b0d3         # just this one back, at its next wake
```

- A sandbox keeps its own size through a promote; one not at the default
  (1 vCPU, 2048 MB) switches cold (its entrypoint starts in seconds).
- `--now` restarts it at once, and is the only way a sandbox with `--idle 0`
  switches. Check `s5x sandbox proc ls <ref>` and ask the user first. A
  sandbox held awake (a `--keep-alive` process, or a hold from code inside)
  gets a 409, but that is no guard: it gives way under memory pressure. A refused `--now` ends `; <ref> stays promoted to <build>
  and switches at its next wake`.
- **Restoring a snapshot or backup puts back the build it was taken on** and
  cancels a pending switch. Taking one never switches the sandbox.
- Whether a new version can read what an old one wrote to a volume — or an old
  one what a new one wrote, on rollback — is up to the app.

See `references/workflows.md` for the full release recipe.

## Scripting and automation

- **`--json`** makes stdout carry only the payload, as one JSON document. Parse
  it with `jq`; do not scrape the human tables, which change. A failed request
  prints `error  <message>` on stderr (a 5xx adds `(request id …)`), or under
  `--json` `{"error", "status", "requestId", "retryAfter", "code", "exit",
  "sandbox", "path", "sandboxes", "drive", "holders"}` on stdout, with only
  the fields that apply, and exits 1. `retryAfter` is how many seconds the
  server asked you to wait before trying again. `code` is a refusal's stable
  name, when it has one (`waking_no_capacity`: the sandbox's host has no room
  to wake it right now, nothing ran, retry after `retryAfter`; `no_capacity`:
  no host has room to create it right now, nothing was created, retry after
  `retryAfter`; `file_not_found` and `process_not_found`: the path or process
  is not in the sandbox, where a 404 about the sandbox itself has no code;
  `machine_lost`, a 409: the sandbox's machine has not answered for a while
  (10 minutes by default), and `error` names the ways back once s5x has made
  sure the machine is off):
  branch on it and on `status`, never on the text of `error`. `sandbox` is
  the id of the sandbox a refusal is about; on `volume_attached` it is the
  one holding the volume and `path` its attachment's, so `s5x volume detach
  <sandbox> <path>` frees it. `sandboxes` names those holding a snapshot
  (`snapshot_attached`),
  `drive` the drive that would not mount (`volume_mount_failed`), and
  `holders` the processes holding a volume (`volume_busy`).
- A **listing** under `--json` is the API's own objects, never the table's
  rows: exact byte counts, ids and full timestamps. Before scripting
  against one, read its exact keys in `references/workflows.md`, "Script it
  with --json", rather than guessing.
  A **single object** — `sandbox create`, `endpoint create`,
  `sandbox stats <ref>`, `schedule set`, and `sandbox network ls <ref>` despite
  its name — comes back whole.
- Exit codes: `0` ok; `2` a refused invocation — an unknown command or
  option, a missing or extra argument — which under `--json` is
  `{"error", "detail"}`; `1` everything else. That includes a failed request,
  and also a flag value the CLI refused before sending anything
  (`--timeout expects whole seconds…`, `--env expects KEY=VALUE…`,
  `<NAME> needs a value`, `--enable and --disable together`), in which case
  nothing ran. `sandbox exec` exits with the command's own code, or `124` when
  it was killed at its `--timeout`. Under `--json`, branch on `timedOut`
  (`references/workflows.md`, "Script it with --json"), not on `124`, which a
  command can also exit by itself.
- An unknown option is named only when it is a near miss
  (`unknown option: --crn (did you mean --cron?)`); otherwise it is
  `unknown option (not shown, in case it is a value)`, followed by the options
  the command accepts. That usually means an unquoted command
  (`exec <ref> ls -la`: quote it) or a value starting with `-` (put it after
  `--`).
- A 422 (output too big to return) exits `1`, but the command **ran**. After a
  500, a 524 (`no answer within about 100 s …`), a gateway error or a dropped
  connection it **may have run**, and interrupting `s5x sandbox exec` does not
  stop it: it runs until it exits or `--timeout` kills it. So may one that got
  a 410 or 409 saying the sandbox was deleted, died, or was suspended or
  replaced `while the request was running`. Check before running it again
  (the 422, 500 and 502 rows of `references/troubleshooting.md`).
- `--follow` cannot be combined with `--json` — a stream has no end to close the
  document on. Poll without `--follow` instead.
- `sandbox shell` is for a person at a terminal; a script uses `exec`. It
  exits with the shell's own exit status, or with 255 and a line saying why
  when the connection was lost or the session was ended from outside (the
  sandbox deleted, restored or restarted). Ctrl-c goes to the shell and
  interrupts what runs there; `exit` or ctrl-d leaves. Resizing the window
  resizes the remote terminal. Piped input runs, then the shell exits:
  `printf 'cd /app && ls\n' | s5x sandbox shell <ref>`. An open shell keeps
  the sandbox awake.
- Hints under a result (`saved; in force within about 20 s`,
  `N already run it`, the `env set` hint) go to stderr only when stdout is a
  terminal. In a captured shell (an agent's, `| jq`, `> file`) use `--json`
  and read `pending` and `already`.
- `vault get` piped into another program prints the bare value, nothing else.

## Confirm before destroying

Ask the user before running any of these — none can be undone:

- `sandbox rm` — the rootfs, running processes, its snapshots, vault, logins,
  header rules, env and schedules, and restoring its backups (its volumes survive,
  detached, each a disk for another sandbox)
- `sandbox erase` — all of `sandbox rm`, and the volumes it holds with their
  snapshots, and every backup of it and of those volumes, permanently
- `volume rm` — the volume's data and its snapshots, permanently
- `volume detach --force kill` (kills the processes holding it) and
  `--force restart` (restarts the sandbox, ending every process in it)
- `volume restore --replace` — the volume goes back to the backup, and what
  was written to it since is lost; an attached one's sandbox boots cold at its
  next wake
- `sandbox set --mem` (or `--vcpus`) — its processes restart at its next wake, or at
  once with `--now`
- `template rm` — that build: nothing can roll back to it. Refused while a
  sandbox runs it or is promoted to it, or a snapshot or backup of yours can
  restore it
- `template promote`, `sandbox promote` — restart processes on another build
  and discard their output (every sandbox of the name, or this one; at its
  next wake, or at once with `--now`)
- `snapshot restore`, `backup restore` — discard everything written since the
  checkpoint, on its volumes too, and process output. Each waits until the
  restore is done; Ctrl-C stops the wait, not the restore
- `snapshot rm`, `backup rm` — that checkpoint, for good
- `key rm` — whatever holds the key, a production server included, is refused
  from its next request, and only a new key set there brings it back
- `endpoint domain rm` — the domain stops reaching the endpoint within about
  5 s, and adding it back waits for its record and its certificate again

## When something fails

s5x errors are written to name the fix, usually as a literal command — read the
whole message and do what it says before improvising. `references/troubleshooting.md`
maps the common ones, and `s5x logs <ref>` shows the sandbox's side of the
story without waking it.

## Reference files

- `references/commands.md` — every command and flag, generated from the CLI.
  Read the section for a verb before using a flag you have not seen here.
- `references/workflows.md` — end-to-end recipes: deploy an app behind a stable
  URL, run a long job, move data in and out, give a sandbox an API key it never
  holds, limit which hosts it can reach, sign in to a website for an assistant
  and keep the password from it, release and roll back, find out why a
  sandbox failed (including which `s5x logs` filters apply to process output),
  recover a dead sandbox, schedule work.
- `references/troubleshooting.md` — error messages and states, what they mean,
  what to run.
