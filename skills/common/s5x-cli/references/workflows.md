# s5x workflows

End-to-end recipes. Each is a sequence that works as written; adapt the names.

## Contents

- [Deploy an app behind a URL that never changes](#deploy-an-app-behind-a-url-that-never-changes)
- [Get code and data in and out](#get-code-and-data-in-and-out)
- [Volumes: attach, detach, snapshot and fork](#volumes-attach-detach-snapshot-and-fork)
- [Give a sandbox an API key it never holds](#give-a-sandbox-an-api-key-it-never-holds)
- [Limit which hosts a sandbox can reach](#limit-which-hosts-a-sandbox-can-reach)
- [Sign in to a website for an assistant, and keep the password from it](#sign-in-to-a-website-for-an-assistant-and-keep-the-password-from-it)
- [Run a long job and collect its result](#run-a-long-job-and-collect-its-result)
- [Ship a new build to your sandboxes, and roll it back](#ship-a-new-build-to-your-sandboxes-and-roll-it-back)
- [Checkpoint before something risky](#checkpoint-before-something-risky)
- [Find out why a sandbox failed](#find-out-why-a-sandbox-failed)
- [Bring back a dead sandbox](#bring-back-a-dead-sandbox)
- [Run something every night](#run-something-every-night)
- [Script it with --json](#script-it-with---json)

## Deploy an app behind a URL that never changes

First decide how the app starts, because it decides how env reaches it.

**If the image's `CMD`/`ENTRYPOINT` starts the app** (most images do):

```bash
docker build --platform linux/amd64 -t bot:dev .
s5x template push bot:dev --name bot                    # waits until the build is ready

s5x sandbox create bot-1 --template bot --volume bot-data --create \
  --env TELEGRAM_TOKEN="$TELEGRAM_TOKEN"
s5x endpoint create bot-hook bot-1 3000 --public       # prints the URL; endpoint ls shows it again
```

The entrypoint runs as a supervised process named `app`. It waits for the
create-time env, as long as that takes: s5x sends it only once every volume is
mounted, so `/data` and the token are both there when the app starts. If it
never arrives, the sandbox is reported unhealthy and its next wake sends it
again; the app never starts without them. `--env` at create is stored exactly like
`sandbox env set` — encrypted at rest, names readable, values not.

`app` is restarted 2 s after it exits, so its command must keep running. A
runtime image's default command (`oven/bun`, `python`, `node`, `alpine`)
exits at once, because `app` has no terminal and an empty stdin: the sandbox
then restarts it every 2 s for as long as it lives, `s5x logs bot-1 --proc app`
fills with `--- s5x: entrypoint exited rc=N, restarting ---` lines, and
`proc ls` still reads `app running`.

**If you start the app yourself** (the image just provides a runtime), give
the image a command that stays up, so `app` idles instead of restarting:
end its Dockerfile with `CMD ["tail", "-f", "/dev/null"]`. Then:

```bash
s5x sandbox create bot-1 --template bot --volume bot-data --create \
  --env TELEGRAM_TOKEN="$TELEGRAM_TOKEN"
s5x sandbox proc run bot-1 "bun /app/index.ts" --name bot --timeout 0
s5x endpoint create bot-hook bot-1 3000 --public
```

Do not do both — `proc run` on top of an image that already starts the app runs
two copies fighting over one port.

Why each piece:

- `--volume` at create, so the app finds `/data` from its first start, and
  anything outside it is lost when the sandbox is replaced or switches to a
  new build. `--create` makes `bot-data` the first time; a second run attaches
  the volume it made, and a typo without `--create` is refused instead of
  becoming a new, empty disk. More volumes attach later with `volume attach`
  ("Volumes: attach, detach, snapshot and fork" below).
- `--env` at create, in both forms: the first boot delivers it before the
  entrypoint or any `proc run` starts. `sandbox env set` only stores a value
  for processes started after the sandbox's next boot or wake, so a `proc run`
  straight after it, on a sandbox that is awake (one you just created is),
  starts without the value. The entrypoint's `app` restarts with
  `sandbox proc restart <ref> app`, but with the env of the sandbox's last
  boot or wake, so if a value will need to change without replacing the
  sandbox, use the second form: `env set` the new value so later boots have it, then
  restart the process with the value passed to it (the kill-and-wait loop,
  with its `-9` escalation, is in troubleshooting.md, "A new env var is not
  visible to the app").
- `--timeout 0`: the default is 600 seconds, and a server killed after ten
  minutes looks like a crash.
- An **endpoint**, not a preview: the URL survives the sandbox being replaced,
  which is what you register with Telegram, Stripe or Slack. `--public` only
  because those callers sign their own requests; without it the URL needs the
  token printed at creation — shown once, so capture it. It prints a link to
  `open in a browser` (`<url>/?_s5x_token=<token>`: the first visit swaps the
  token for a session cookie of at most 12 h) and a `curl` line; code sends
  it as `Authorization: Bearer <token>` or `x-s5x-token: <token>`.

The sandbox is free to sleep. The first request to the endpoint wakes it with
the bot still running mid-conversation.

`s5x logs bot-1 --proc app` shows the entrypoint's output;
`s5x logs bot-1 --proc bot` shows a process started with `proc run --name bot`.

## Get code and data in and out

One file each way:

```bash
s5x sandbox cp ./config.json bot-1:/app/config.json
s5x sandbox cp bot-1:/data/report.csv .               # into a directory, a file keeps its name
```

`cp` writes with root's reach, so it can put a file anywhere, and what it
creates belongs to the image's `USER`. Every upload lands at mode 0644, even
over an executable, so run a copied script through its interpreter
(`sh /data/job.sh`).

A directory — `cp` moves single files, so archive it:

```bash
COPYFILE_DISABLE=1 tar czf /tmp/app.tgz --no-xattrs -C ./app .
s5x sandbox cp /tmp/app.tgz bot-1:/data/app/app.tgz     # cp makes /data/app, owned by the image's USER
s5x sandbox exec bot-1 "tar xzf /data/app/app.tgz --no-same-owner -C /data/app && rm /data/app/app.tgz"
```

`COPYFILE_DISABLE=1` and `--no-xattrs` matter on a Mac: without them its tar
packs a binary `._<name>` twin of every file, which lands beside the real
ones. `--no-same-owner` keeps an image that runs as root from giving the
files your local uid.

`exec` runs as the image's `USER`. In an image that declares one, `exec`
cannot create a directory under `/` or unpack into a root-owned directory — a
Dockerfile `WORKDIR /app` written before `USER` leaves `/app` owned by root. So
unpack where that user owns the directory: `/data` (or another volume's
path, while the volume was empty when first mounted), or a directory `cp`
created. An image with no `USER` runs `exec` as
root, and there any path works.

`cp` copies a file of up to 100 GiB in. Over 32 MiB it is an upload, sent in
parts and then placed into the sandbox, and `cp` waits for both, showing
progress on a terminal and saying `writing your file into your sandbox` once
the parts are sent. A sandbox takes at most 4 uploads at once; a fifth `cp`
into it gets a 429 until one finishes. The file appears whole or not at all, and until the
new one replaces it the old one stays, so the sandbox needs room for both.

Data that already has a URL is quicker fetched by the sandbox itself, as a
detached process, because a download can outlast `exec`'s 60 seconds. Give it
a `--timeout` long enough for the download: without one it is killed at 600 s.

```bash
s5x sandbox proc run bot-1 "curl -fsSL -o /data/model.bin https://example.com/model.bin 2>&1" \
  --name fetch --timeout 3600      # its traffic keeps the sandbox awake
s5x sandbox proc logs bot-1 fetch --follow                # returns when curl exits
```

`--follow` follows one stream, stdout unless you pass `--stream stderr`, and
refuses `--stream all`. Merge stderr into stdout in the command (`2>&1`), as
above, or follow `--stream stderr` in a second terminal. Without `--follow`,
`proc logs` prints both streams.

## Volumes: attach, detach, snapshot and fork

A volume is a disk on one machine that one sandbox holds at a time, at a path.
It has no size to choose: it starts at 2 GiB and grows on its own as it
fills, up to the limit `volume info` prints; past that a write fails with
ENOSPC (disk full), never an I/O error. A sandbox holds up to 4 volumes and 4
snapshots, attached and detached while it runs or sleeps, each only on the
volume's own machine.

```bash
s5x sandbox create u-1 --template app --volume u-1:/data --create   # made the first time, at /data
s5x volume attach u-1 u-1-cache:/cache --create                     # another, on the running or sleeping sandbox
s5x volume ls                                                       # USED, ATTACHED TO, BACKUPS KEPT
s5x volume info u-1                                                 # its filesystem now, and the most it grows to
s5x volume detach u-1 /cache                                        # refused while processes hold it, naming them
s5x volume rm u-1-cache                                             # a detached volume, its data and snapshots
```

**A detach waits for the processes holding the volume.** While any process in
the sandbox has its working directory, a file, a memory map or its own mount
namespace (a container, Chromium's sandbox) on it, the detach is refused with
up to 32 of them by pid and command. Stop them and detach again, or
`--force kill` to kill them, or `--force restart` to restart the sandbox
without the volume (every process in it restarts). A `dead` sandbox takes
only `--force restart`.

**A volume moves between sandboxes on its machine** by a detach and an
attach; the attach is refused while another sandbox holds it, naming that
sandbox and path. To use its data on another machine, restore a backup of it
next to a sandbox there:

```bash
s5x volume detach worker-1 /jobs
s5x volume attach worker-2 jobs:/jobs                 # no --create: a typo is refused, not a new empty disk
s5x volume backup jobs                                # or, for a sandbox on another machine:
s5x volume restore bk_… jobs-copy --next-to worker-9
s5x volume attach worker-9 jobs-copy:/jobs
```

**A snapshot is a clean, read-only copy, taken at once**: the sandbox's writes
are held for the instant of a copy that shares every block with the volume.
Attach one read-only to any number of sandboxes on its machine, or fork it
into a new volume to try something on a copy:

```bash
s5x volume snapshot take dataset                      # prints vsn_…
s5x volume attach reader-1 vsn_…:/dataset             # read-only; a snapshot names its path
s5x volume fork vsn_… u-1-trial                       # a new volume, at once
s5x volume attach u-1 u-1-trial:/trial
s5x volume snapshot ls dataset                        # ATTACHED TO: who reads it
s5x volume snapshot rm dataset vsn_…                  # refused while a sandbox holds it
```

A snapshot of a detached volume needs it to have been unmounted cleanly; one
that was not is refused: attach it and take the snapshot there. Mounted over a directory that
has files, a volume or a snapshot hides them until it is detached.

Downloads out of a sandbox are streamed and have no size cap.

## Give a sandbox an API key it never holds

What a rule is, and what it covers, is in SKILL.md ("Credentials the sandbox
never holds"). Put the placeholder and the rule in place **before the process
that calls the API starts**: a call made before the rule exists goes out with
the bare placeholder, and the API refuses it (usually a 401). Give both at
create, so the first boot already has them:

```bash
printf '%s' "$ANTHROPIC_API_KEY" | s5x sandbox create agent-1 --template agent \
  --env ANTHROPIC_API_KEY=placeholder --header api.anthropic.com:x-api-key
s5x sandbox network ls agent-1                   # api.anthropic.com  X-Api-Key (names, never values)
# only if the image's entrypoint does not start the app, start it now:
s5x sandbox proc run agent-1 "bun /app/agent.ts" --name agent --timeout 0
```

- **The value is the whole header**, sent exactly as given:
  `printf 'Bearer %s' "$OPENAI_API_KEY" | s5x sandbox network header set agent-1 api.openai.com Authorization`.
- **`saved; in force within about 20 s` prints only when stdout is a
  terminal**; captured output (an agent's shell, `| jq`, `> file`) loses it,
  so use `--json` there and read `pending`. A sleeping sandbox gets the rule at
  its next wake. On a sandbox with no allowlist, a connection the app already
  had open to that host before the sandbox's first rule skips the rule until
  it closes: restart the app if it keeps getting 401. (With an allowlist, the
  first rule restarts the proxy and drops that connection, so the reconnect
  gets the rule.)
- **The client must trust the proxy's certificate.** The image's CA bundle
  does, and so do Node, Bun and Python requests/httpx through the variables
  every build exports. A Java client, a binary with compiled-in roots (Rust's
  `webpki-roots`), an image `ENV` or a sandbox env var (`sandbox env set`,
  `--env`) that points `SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS` or
  `REQUESTS_CA_BUNDLE` at a bundle without the proxy's CA (it overrides the build's value),
  and an HTTP/2-only (gRPC) client all fail on the rule's host. For the env
  case, remove that variable instead; otherwise give such a client its key as
  env, and set no rule for that host.
- **Check it** (if the image has curl):
  `s5x sandbox exec agent-1 "curl -s -o /dev/null -w '%{http_code}' -H 'x-api-key: placeholder' -H 'anthropic-version: 2023-06-01' https://api.anthropic.com/v1/models"`
  prints 200 only when the rule is in force.
- **Change a rule only when the key changes.** Setting it again replaces the
  value, and on a sandbox that already has a rule or an allowlist, every change
  restarts its egress proxy, which drops every HTTP and HTTPS connection open
  through it, whatever its host. Setting the value a rule already has, or the
  allowlist a sandbox already has, is not a change and drops nothing, so a
  provisioning script can set them on every run. A connection opened before the sandbox's
  first rule (on a sandbox with no allowlist) never went through the proxy, so
  setting a rule again does not cut it.
- **Rules belong to the sandbox.** Promote and restore keep them; a replacement
  sandbox needs them given again.
- **A WebSocket (`wss://`) to a rule host works**: its opening request gets
  the rule's header like any other, and the connection is then relayed both
  ways for as long as it stays open.
- **A protocol where the server speaks first** (SSH to `ssh.github.com:443`)
  still works on a sandbox with rules and no allowlist: the proxy passes it
  through untouched once the client has sent nothing for about 2 s, so it
  takes 2 s longer to connect. Under an allowlist it is refused.

**Moving a key out of env on a sandbox that already exists.** Set the rule,
and `env set` the placeholder over the old value. Then:

- **If you started the app with `proc run`**, restart it with the placeholder
  passed to it: `proc kill` it, wait for it to end (the loop in
  troubleshooting.md, "A new env var is not visible to the app"), then
  `sandbox proc run <ref> "<cmd>" --name <n> --timeout 0 --env ANTHROPIC_API_KEY=placeholder`
  — an `env set` on an awake sandbox reaches nothing until its next wake.
- **If the image's entrypoint runs the app**, `app` refuses `proc kill`.
  After the next wake, `s5x sandbox proc restart <ref> app` ends it and what
  it started, and starts it again 2 s later with that wake's env, the
  placeholder (it loses what it holds in memory and any request in flight:
  ask the user first). A restart before that wake starts it with the old
  key again.
  The placeholder also reaches it at a `sandbox promote <ref> <digest> --now`
  to another build (to the build it already runs, that restarts nothing), or
  when the app exits by itself after the next wake. Never `proc run` a second copy beside it. Meanwhile the rule
  replaces the header on every connection the app opens from now on; one it
  already had open to that host (on a sandbox with no allowlist) keeps sending
  the old key until it closes: when it goes idle, when the app ends, or at a
  `promote --now` (ask first). Setting the rule again does not close it.

Either way, **rotate the key**: set the rule again with a new key, then revoke
the old one once the provider shows it unused (a connection opened before the
rule can still be carrying it). The old one is in the sandbox's memory image
and in every snapshot and backup taken so far, and revoking it is what makes
those copies useless.

Keep the `header set` output visible: do not send it to `/dev/null` or
`jq -e … &&`. Under `--json` a failure is `{"error": …}` on stdout, and hiding
it starts the app with no rule. In an unattended script:
`r=$(printf '%s' "$ANTHROPIC_API_KEY" | s5x --json sandbox network header set agent-dev api.anthropic.com x-api-key) || { echo "$r" >&2; exit 1; }; [ "$(printf '%s' "$r" | jq -r .pending)" = true ] && sleep 25`.

## Limit which hosts a sandbox can reach

```bash
s5x sandbox network allow agent-1 api.github.com,pypi.org,files.pythonhosted.org
s5x sandbox network ls agent-1                   # reaches: only …
s5x sandbox network allow agent-1 --all          # lift it
```

`--allow-hosts` on `sandbox create` sets the same list from the first boot.
`network allow` **replaces** the list, so pass all of it every time: the hosts
`network ls` shows plus the new one.

- **Only TCP ports 443 and 80 get out**, to a listed name or a header rule's
  host (a rule's host needs no listing). HTTPS is judged by its TLS server name,
  plain HTTP by each request's `Host`. Every other port is refused at once
  whatever the list says — a database on 5432, SSH, SMTP, HTTPS on another
  port, QUIC, ping. Listing `db.example.com` does not open Postgres; lift the
  allowlist for that (`--all`).
- **Names are exact**: no wildcards, IP addresses or ports (400), at most 100.
  `github.com` does not admit `api.github.com`, so list every host the program
  touches, including the ones a download redirects to.
- **What a refused call looks like**: HTTPS to an unlisted name, or to a bare
  IP address (it sends no name), gets a TLS `access_denied` alert during the
  handshake: curl and OpenSSL report `tlsv1 alert access denied`, Bun
  `TLSV1_ALERT_ACCESS_DENIED`, Node `alert access denied`. Plain HTTP gets a
  403 `s5x: this sandbox's network policy does not permit this host`. Another
  port is refused outright (`Connection refused`). Refusals are not written
  to `s5x logs`.
- **DNS goes only to the sandbox's own resolver**, so a client that uses its
  own DNS server resolves nothing. That resolver is public (1.1.1.1), so code
  inside can still look up any name, a slow channel out. Tell a security
  reviewer that the allowlist governs connections, not DNS lookups. Its vault and schedules keep working, and
  endpoints and previews, which come in rather than go out, are unaffected.
- It needs no rebuild. Changing it on a running sandbox restarts its egress
  proxy, as a rule change does, and a new allowlist also cuts connections the
  sandbox had open on any other port.

## Sign in to a website for an assistant, and keep the password from it

For a platform whose assistant signs in to websites for its user: a small
helper of the platform's, the template's one trusted user, reads the login
inside and signs in, and answers a session, never the password. Everything
else, the platform's harness and the assistant's tools, runs as the image's
`USER` and cannot read a login.

```bash
# The image declares USER agent (the harness and the assistant's tools) and has
# a user helper; its CMD is a start script that runs as root and starts each
# as its own user.
docker build --platform linux/amd64 -t assistant:dev .
s5x template push assistant:dev --name assistant --trusted-users helper   # a warning: line for each finding
s5x sandbox create u-1 --template assistant --volume u-1 --create

printf '%s' "$PASSWORD" | s5x sandbox vault login set u-1 --website github.com --username ada
s5x sandbox vault login ls u-1                                   # its id, lg_…
printf '%s' "$TOTP_URI" | s5x sandbox vault login set u-1 --id lg_… --totp-stdin
s5x logs u-1 --source system --grep login_ --since 1d            # the reads and refusals, a minute at a time
```

- **The password is never an argument.** Piped in, it is the exact bytes less
  one trailing newline; on a terminal, a hidden prompt asks for it. On a
  create, `--totp-stdin` takes the seed from stdin and then needs a terminal
  for the password, so from a script create the login with its password
  piped, then add the seed with `--id <id> --totp-stdin`, as above.
- **A change with `--id` sends only the flags given.** It reads a new
  password only from piped stdin: on a terminal it never asks, so a hint
  changes without the password, and an empty pipe (`</dev/null`, cron) leaves
  the password as it is. A pipe that never closes blocks the command.
  `--remove-totp` deletes the seed.
- **Limits**: 1 to 10 websites a login, each a lowercase hostname, and
  `example.com` also matches `www.example.com`; a username up to 256 bytes, a
  password 1 to 1024, a hint 500; at most 100 logins a sandbox. Two logins
  with one username cannot list the same website, or a website and its `www.`
  form: the second is refused, naming the first.
- **What the helper calls inside** (`POST http://localhost:8081/v1/vault/logins/get`
  and `/totp` for a website), the TOTP rules, and what s5x guarantees and does
  not: the s5x-sdk skill's `references/guest.md`, "Logins". A worked image, a
  helper of under 100 lines and a sealed browser sign-in, is in that skill's
  `references/examples/`, whose `README.md` says how its pieces fit.
- **Change the sandbox's schedules from your side** (`sandbox schedule add`),
  which checks no trusted user: inside, only the helper could, and the
  assistant cannot leave a command behind to run later.
- **`vault login rm` deletes a login at once.** A process that already read
  the password keeps what it read, and so does a backup or a memory image
  taken while one held it.

## Run a long job and collect its result

```bash
s5x sandbox proc run etl "python3 -u /app/etl.py --since 2026-09-01" \
  --name etl --timeout 7200
s5x sandbox proc logs etl etl --follow           # returns when the process exits
s5x sandbox proc ls etl                          # status and exit code
s5x sandbox cp etl:/data/out.parquet ./out.parquet
```

`status` is `running` (`starting` for a moment) while it runs. When it ends:
`completed` (exit 0); `failed` (it exited non-zero by itself, including 124);
`killed` (a signal ended it, `exit` -1: always after `proc kill -9`, and after
plain `proc kill`, which sends SIGTERM, only if the program does not catch it.
A program that catches SIGTERM and exits by itself ends `completed` or
`failed`, and one that ignores it stays `running`); `timeout` (s5x killed its
process group at `--timeout`, with `exit` 124).
`proc logs --follow` exits 0 whatever happened, so read the result with
`s5x --json sandbox proc ls etl | jq -r '.[] | select(.name=="etl") | "\(.status) \(.exitCode)"'`.

Names are 1-64 of `[A-Za-z0-9._-]`, not `.` or `..`, and `app` and `console`
are reserved. A name is refused while its process runs, and reusing a
finished name replaces its row and its log.

**A job that works keeps the sandbox awake by itself.** A sandbox sleeps
once nothing has happened in it for its `--idle`: no CPU work, no data in or
out, no request of its own waiting on an answer, and no call from you in
flight. So a job that computes, downloads or waits on an API needs nothing
more. Add `--keep-alive` for one that goes quiet longer than `--idle` -- a
timer or `sleep` between steps, a wait for an answer over 5 minutes --
or it is frozen in the quiet: nothing is lost, but nothing wakes it until
something else touches the sandbox. The hold ends when the process exits.

A server that receives requests does not need it: each request wakes it.

`--keep-alive` holds the sandbox for the process's whole lifetime, except under
memory pressure. The hold then gives way: the sandbox can sleep with
the job frozen until s5x wakes it again once its host has room, a snapshot
or backup goes ahead with the job frozen while it is taken, and
`promote --now` restarts it.

Code inside the sandbox can hold it around a unit of work of its own, with
`POST http://localhost:8081/v1/keepalive`: the sandbox stays awake for as long
as that request stays open, and a process that ends, however it ends, closes
it. The s5x-sdk skill's `references/guest.md`
documents it, with the vault, login and schedule endpoints code inside calls at the
same base URL, the JSON content type every POST there must send, and examples
in curl, `fetch` and Python.

## Ship a new build to your sandboxes, and roll it back

A push, once ready, is what NEW sandboxes from the bare name get. It moves no
sandbox that exists: that takes a promote. So the release is two steps, and the
second is the one that restarts anything:

```bash
docker build --platform linux/amd64 -t api:dev .
s5x template push api:dev --name api                           # waits, then prints "api@<digest> ready": note the digest
```

Try it on one existing sandbox before the rest (new sandboxes already get it):

```bash
s5x sandbox create api-canary --template api@3f9a1c2b7d4e   # the new build's digest
# or move an existing one: s5x sandbox promote api-7 3f9a1c2b7d4e --now
# … verify …
```

Then promote it, **after telling the user** what a switch restarts and drops
(SKILL.md, "Moving existing sandboxes to a new build"):

```bash
s5x template promote api 3f9a1c2b7d4e   # "api@3f9a1c2b7d4e is now latest; 998 sandbox(es) switch at their next wake"
s5x template show api                   # SANDBOXES on the new build rises and SWITCHING falls as users come back
s5x sandbox ls                          # "api@9c2e7a14b0d3 → 3f9a1c2b7d4e" = promoted, not yet switched
```

A process started with `sandbox proc run` is gone after a switch, so a fleet
runs its app as the image's entrypoint (the first form in "Deploy an app").

**Roll back by promoting the build that ran before**: sandboxes that already
switched go back at their next wake, and ones that had not switched yet stay:

```bash
s5x template promote api 9c2e7a14b0d3   # the build that ran before
```

A single sandbox can be moved on its own, now or at its next wake:

```bash
s5x sandbox promote api-7 3f9a1c2b7d4e --now   # restart it on the new build immediately
s5x sandbox promote api-7 9c2e7a14b0d3         # back to the old one at its next wake
```

**A snapshot is a rollback with the processes too**: restoring it puts back
the build it was taken on, memory, processes and filesystem:

```bash
s5x sandbox snapshot create api-7 before-release
s5x sandbox promote api-7 3f9a1c2b7d4e --now
# if it went wrong:
s5x logs api-7 --proc <server> --stream all > new-build.log   # first: the restore, or a promote back, drops the new build's output
s5x sandbox snapshot restore api-7 before-release    # back on the old build, exactly as it was
```

What `template promote` reports:

| `--json` key | Printed to a terminal as | Means |
|---|---|---|
| `marked` | `N sandbox(es) switch at their next wake` | will switch at its next wake |
| `already` | `N already run it` | runs this build already |

In a captured shell (an agent's, `| jq`, `> file`), the `already` line does
not print, so `0 sandbox(es) switch` may mean they all run it already.
`s5x --json template promote <name> <build>` carries both.

Whether a new version can read what an old one wrote to a volume — and the
reverse, on rollback — is a property of the app, not the platform. If a release
migrates data on a volume, take a snapshot of the volume first (`volume
snapshot take <name>`: clean, at once, and `volume fork` makes a volume of it
to go back to), or back up (above); a backup is the copy that survives losing
the machine. Copying the data out as an archive works only while the
compressed volume fits in the root filesystem's free space: /tmp is on the
rootfs, which has 2 GiB free past the image (it is sized from the image, at
most 20 GiB), and a volume can be far larger. Check first:

```bash
s5x sandbox exec api-7 "df -h / /data"        # free space on / against what /data uses
s5x sandbox proc run api-7 "tar czf /tmp/before-release.tgz -C /data . 2>&1" \
  --name pre-release-copy --timeout 3600
s5x sandbox proc logs api-7 pre-release-copy --follow   # tar's errors too (2>&1); exits 0 however tar ended
s5x --json sandbox proc ls api-7 | jq -r '.[] | select(.name=="pre-release-copy") | "\(.status) \(.exitCode)"'   # copy only on "completed 0"
s5x sandbox cp api-7:/tmp/before-release.tgz ./api-7-before-release.tgz
s5x sandbox exec api-7 "rm /tmp/before-release.tgz"
```

If the status is `failed` or `timeout`, the archive is partial: delete it
(`rm /tmp/before-release.tgz`), because an image that runs as root can fill
the rootfs, and a full rootfs fails the next wake (troubleshooting.md,
`could not write /s5x/env.sh … no space left on device`). Use
`s5x sandbox backup create api-7` instead.

Retiring old builds: s5x keeps every build in use, the 20 newest builds of each
template, and anything built in the last 30 days; other builds are deleted 30
days after they were built (`s5x template show api` prints when, under
EXPIRES). To delete one sooner, `s5x template rm api <digest>` deletes that
build once no sandbox runs it or is promoted to it and no snapshot or backup of
yours can restore it. The `latest` build cannot be deleted while the name has
another — promote the one you want first. Deleting a name's last build retires
the name.

## Checkpoint before something risky

```bash
s5x sandbox snapshot create dev before-migration
s5x sandbox exec dev "cd /app && bun run migrate" --timeout 60   # 60 s is exec's limit
# if it went wrong (a nonzero exit, or 124 = killed at the limit, possibly half-applied):
s5x sandbox snapshot restore dev before-migration
```

A migration that may take more than a minute:
`s5x sandbox proc run dev "cd /app && bun run migrate" --name migrate --timeout 3600`,
then `s5x sandbox proc logs dev migrate --follow` (it returns when the
migration exits, with exit 0 either way), then read its exit code from the
`exit` column of `s5x sandbox proc ls dev` before deciding to restore.

Restore puts back the processes, memory and filesystem exactly as they were at
the checkpoint, with the same ref and URLs. Everything since is discarded.

Both copies, a snapshot and a backup, pause a running sandbox for the few
seconds it takes to copy it aside, and a sandbox that was running is running
again once the copy is taken (it reads `sleeping` meanwhile). A snapshot is
then done; a backup uploads its copy while the sandbox runs. Both normally
fail while the sandbox is held awake: a `--keep-alive` job, or a hold code
inside took from `localhost:8081/v1/keepalive` (above) — with `your sandbox
was busy: …`. Under memory pressure the hold gives way and the copy goes
ahead, with the job frozen while it is taken. The difference is where the copy
lives: a snapshot on the machine the sandbox runs on, a backup in object
storage off it, so use a backup for a copy that survives losing the machine. A
request that arrives during the copy waits for it, and nothing resumes the
sandbox under a half-written copy.

Taking a snapshot or a backup, and restoring either, is an **operation**: it
has an id (`snp_…`, `bk_…`, `rs_…`) and carries on after the command that
started it. `snapshot create`, `backup create` and both `restore`s wait until
it is done, saying each phase once as it reaches it on stderr — `copying (your
sandbox is paused for a few seconds)`, then for a backup `uploading (your
sandbox is available)`. A restore from a backup says `downloading the backup
(your sandbox runs on as it is)`, one from a snapshot `copying the snapshot
(your sandbox runs on as it is)`, and both then `restoring (your sandbox is
unavailable for a few seconds)`. A failed one exits 1 with `your <kind> <id>
failed: <why>`. **Ctrl-C stops the wait, not the work**: it says the
operation carries on and names `s5x operation show <id>`, which says where it
is, or why it failed; `s5x operation wait <id>` waits again.
`backup create --no-wait` prints the backup's id at once. One operation holds
a sandbox at a time; another is refused naming the one running:

```bash
s5x sandbox backup create dev                    # waits, then prints the backup id
s5x sandbox backup create dev --no-wait          # prints the id at once
s5x operation show bk_…                          # where it is, and why if it failed
s5x operation wait bk_…                          # waits again
s5x sandbox backup ls dev                        # its finished backups
s5x sandbox backup show bk_…                     # one finished backup
s5x sandbox backup restore dev bk_…              # waits until the restore is done
s5x sandbox snapshot rm dev before-migration     # a checkpoint you no longer need
s5x sandbox backup rm bk_…
```

**Every volume is backed up every day without you**, attached or not. s5x
backs up each volume alone once a day, at a time of day of its own, as an
operation like yours (`operation ls --kind backup` shows it with
`"automatic": true`). It never sleeps or wakes a sandbox: a running one has
its writes flushed and is paused for the milliseconds the copy takes, so the
backup holds the volume as a power cut at that moment would leave it -- every
file written before the flush, and a database that recovers as it does from a
power cut. A day the volume did not change -- detached, or its sandbox asleep
or dead, since its last backup -- is skipped; a volume detached, or left by a
deleted sandbox, is backed up once more if it changed. It is no activity of
the sandbox's: its idle clock,
`--ttl-idle` and last activity are untouched. It gives way to you: a backup,
restore, snapshot or `sandbox erase` you start before it has begun takes its
place, and an erase is never refused for one under way, which is waited for
and erased with the rest. Once begun, it is the operation a refusal of your
backup (until it has uploaded) or restore or snapshot (for the seconds of its
copy) names, saying it is s5x's daily backup: `operation wait` it, then run
yours. Each automatic backup is kept for its volume's backup days, 7 unless
`volume set <name> --backup-days` (0 to 30) says otherwise; `--backup-days 0`
stops them. Its newest is kept until a newer one replaces it or the volume is
deleted, so a volume untouched for a month still has the backup of its last
change. `volume backups <name>` marks each `automatic` or `manual`. Memory and
processes are only in a sandbox's backup, which you take, and yours are kept
until you delete them. Every backup is encrypted before it leaves the
machine.

```bash
s5x volume set u-1-data --backup-days 30         # how long each is kept
s5x volume backups u-1-data                      # KIND: automatic or manual; HOLDS: volume or sandbox
s5x volume backup u-1-data                       # one now, alone, never sleeping its sandbox
```

To back up many sandboxes, start each with `backup create <ref> --no-wait`
(one where a backup, restore or snapshot is already under way refuses, naming
it: report it and go on), then read
`s5x operation ls --kind backup --unfinished --json` until it is an empty list
— one read for all of them — and
`s5x operation ls --kind backup --failed --limit 1000 --json` for the ones
that failed, with each one's `error`: a listing holds the newest 100 unless
told more. An operation is kept a day after it
finishes; a backup you took for as long as you keep it.

If the sandbox cannot be put back to running after a good copy, the copy
still succeeds and the sandbox is left asleep; your next call wakes it.

A backup restores **only onto the sandbox that took it**, and puts back what
it holds: a machine backup the machine and every volume it held, at its build
and its size, only while the sandbox holds what it held then, by drive, path,
and volume or snapshot (otherwise it is refused naming the difference); a
volume-only one the volume alone, the sandbox then booting its own root
filesystem cold. One volume of a machine backup comes back alone with
`volume restore <backup-id> <name> --drive rwN --replace` over its own volume,
or into a new volume without `--replace`; a volume's backup the same way. On a sandbox whose machine is lost (`machine lost` in
`sandbox ls`), once s5x has made sure that machine is off (until then the
restore is refused, 409 `machine_lost`), a machine backup's restore moves it
to another machine under the same name, with the volumes the backup holds; a volume-only one is
refused there, and comes back only as a new volume. Once that sandbox is removed, its backups
cannot be restored onto anything (`volume restore` still makes a new volume
of each volume one holds), and
`s5x sandbox backup ls <ref>` no longer shows them: it answers 404
`sandbox "<ref>" does not exist`, or, if a new sandbox took the name, lists
only the new one's. They stay in object storage until you delete them.
`s5x sandbox backup ls` with no ref lists every backup you have, with the
SANDBOX column naming the one it came from, and `s5x sandbox backup rm <id>`
deletes one. Snapshots go with the sandbox entirely. Moving a sandbox to a new
build with `promote` keeps both — and restoring either puts back the build it
was taken on.

## Find out why a sandbox failed

Start with records; they never wake the sandbox and survive its deletion. If
a new sandbox has since taken the name, `s5x logs <name>` reads the new one.
Get the old one's id from `s5x logs sandboxes <name> --deleted` and pass that
instead.

```bash
s5x logs dev --since 2h --level warn             # refused and failed calls, deaths, cold boots
s5x logs dev --source system                     # sleeps, wakes, deaths, recoveries, unhealthy wakes, deletions
s5x logs dev --proc app --lines 100              # the entrypoint's own stdout/stderr
s5x logs dev --proc console                      # the VM's serial console: kernel panics, OOM kills
s5x logs sandboxes dev --deleted                 # the ids a name has had, deleted ones included
```

`s5x logs sandboxes` with no name lists at most the 500 most recent, and says
`showing the N most recent; pass a name to narrow` when it cut the list.
Under `--json` it is one object, `{sandboxes, truncated, retentionDays}`.

`--since`, `--until`, `--level` and `--grep` filter records only. With
`--proc` or `--stream`, each is refused with a 400: process lines carry no
timestamp, severity is the stream (`--stream stderr` for errors), and there is
no server-side search, so pipe the output to `grep`. `--lines` bounds both.
With `--follow`, `s5x logs dev --follow --lines 50` shows the newest 50
records (or, with `--proc`, the last 50 lines), then only what is new, each
line once however busy the sandbox is. It keeps following the sandbox it
started on, even if a new sandbox takes the name.
Process output is kept with the sandbox's disk, so it goes when the sandbox
is deleted or switches to another build (a promote), and a snapshot or backup
restore rolls it back to the checkpoint (the `console` stream is cleared
entirely); records stay.

`--proc console` is the one to read when the guest itself died — it is the
VM's serial console (kernel and boot messages, a panic, an OOM kill), written
from outside the guest, so it survives the guest dying (but not a switch or a
restore, above).

`s5x sandbox proc logs <ref> <name>` is a different tool: the live, byte-exact
output of one process, which wakes the sandbox to read it.

## Bring back a dead sandbox

A sandbox whose VM died while it was awake has no memory image it can trust,
so it is marked `dead` rather than silently rebuilt, usually within 40 s of
the VM stopping. One that never sleeps (`--idle 0`) is always
awake, so any death of its VM ends here. s5x brings it back by itself: every
call that wakes it tries, and one with `--idle 0` is tried on its own until
five tries fail. **A dead sandbox is kept until you recover or delete it.**

```bash
s5x sandbox ls                                   # state: dead
s5x logs dev --source system --since 1d          # why
s5x logs dev --source audit --grep process_start --since 30d   # every proc run: its name and program, not its command line
s5x sandbox recover dev                          # fresh boot on the same disk
s5x sandbox proc run dev "bun /app/server.ts" --name server --timeout 0
```

`recover` waits for the boot and prints `dev recovered -> running`. It keeps
the sandbox's idle setting, env (delivered at that boot), schedules, endpoints
and volumes. Every volume it holds must mount: one that will not is refused
naming its drive, and the sandbox stays `dead` (`volume detach <ref> <path>
--force restart` recovers it without that volume). If the boot is not ready it
answers 503
`… booted on its own filesystem but never became ready` (or
`did not take its environment`), and the sandbox stays `dead`. Run
`sandbox recover` again, never `rm`.

`recover` also takes a sandbox that still reads `running` or `unhealthy` but
whose VM has stopped: it records the death, then boots it on the same disk.
One whose VM still answers is refused (`only a dead sandbox can be recovered;
this one is running and answering`), and so is one whose VM is up but not
answering (`… its VM is up but not answering …`): it may only be busy, so
wait and call it again. If it never answers, `s5x sandbox recover <ref>
--force` restarts it from its disk and ends every process in it, so ask the
user first.

The filesystem is intact — `recover` boots a kernel on the sandbox's own disk
and ext4 replays its journal. The process tree is not. The image's entrypoint
(`app`) starts again by itself; nothing started with `proc run` does, and
`sandbox proc ls` after the recover shows only `app`, so it cannot tell you
what was lost. The audit records above can say which ran: every `proc run` for
30 days, with its name (empty when it was started without `--name`), its
program and how many arguments followed it (`detail.program`, `detail.args`),
never its command line, whose words are often what the sandbox's own users
wrote. The command comes from whatever started it -- the user's script or
code, or your own earlier commands -- so start each again from there, and ask
the user for any you do not have rather than guessing from the program. None
of its flags are kept either, so choose them again for each process. Use
`--timeout 0` for a server, or for a worker meant to run until stopped. Give a
batch job a `--timeout` well past its expected run (ask the user if you don't
know it; left out, it is killed at the 600 s default). Add `--keep-alive` for
a worker or job that goes quiet longer than `--idle` and that no request
wakes (a timer, a wait over 5 minutes), or it freezes when the sandbox sleeps.
It holds the sandbox until the process exits, and meanwhile the sandbox does
not sleep and snapshots, backups and `promote --now` are normally refused
(409), so a hung `--timeout 0` job holds all of that indefinitely. A server
needs no `--keep-alive`: each request wakes it, and a hold would keep the
sandbox from ever sleeping. A start the sandbox refused is listed too. For a
script:

```bash
s5x --json logs dev --source audit --grep process_start --since 30d | jq -r '.lines[] | .detail | "\(.name)\t\(.program)\t\(.args)"'
```

The other way out, if the sandbox has a snapshot or backup and the lost
processes matter: `s5x sandbox snapshot restore <ref> <name>` or
`s5x sandbox backup restore <ref> <id>`. This brings back the process tree as
it was at the checkpoint, on the build it was taken on, but discards
everything written since, on its volumes too. Ask the user first.

## Run something every night

```bash
s5x sandbox schedule add reports nightly \
  --cron "CRON_TZ=Europe/Berlin 0 3 * * *" --exec "bun /app/report.ts"
s5x sandbox schedule run reports nightly         # try it now; runs at the next poll
s5x sandbox schedule runs reports nightly --output

# once, at an instant: it runs, then stays as a record of its run (the 100
# newest a sandbox has run are kept)
s5x sandbox schedule add reports q4 \
  --at 2026-12-31T23:00:00+01:00 --max-lateness 2h --exec "bun /app/report.ts --quarter"
```

A schedule wakes the sandbox, runs the command, and records its exit code and
output. The command runs as the image's `USER`, from the image's `WORKDIR` like
`exec` (from `/` with none, or one missing at run time). A command still
running after five minutes is killed and recorded as exit 124, with a line
saying so; longer work belongs in a
`proc run` job that your own cron or CI schedule starts, e.g.
`s5x sandbox proc run reports "bun /app/report.ts" --name nightly --timeout 3600`
(it wakes the sandbox; the name is refused while last night's run is still
going; add `--keep-alive` only if it goes quiet longer than `--idle`: a
timer, a wait over 5 minutes). Without `CRON_TZ=` the expression is UTC.
A fixed hour in a `CRON_TZ=` zone runs once on every local day: a time the
clocks skip runs when they land, a repeated one at its first occurrence.
`@daily` and `@every 15m` work too, and one minute is the shortest interval.
A 5-field or `@daily`-style cron runs at a second of its minute that is fixed
for its sandbox (0 to 59, the same for all its crons; `nextRunAt` shows it), so
a `0 3 * * *` on a thousand sandboxes wakes them across that minute rather than
in its first second; `@every` runs every interval from when you made it, and
`--at` at its instant. A run starts within seconds of its time
when its host has room, and `schedule run` at the next poll. A command is at most 4096 bytes: put a longer
script in a file in the sandbox and schedule `sh /path/to/job.sh`. A name is
unique on its sandbox, so every sandbox can have its own `nightly`. Pause one
with `schedule set reports nightly --disable`.

`schedule runs` lists every occurrence with its outcome: `exit N` when it ran;
`not_run` when the sandbox is dead or being deleted; `too_late` when it
could not start before the occurrence's lateness ran out -- its sandbox could
not be woken (its host short of memory, say), or its wake took that long -- by
default the next occurrence, an hour for a `--at` one-shot, or
`--max-lateness`, which folds the occurrences it covers into one try when it is
longer than the interval; `unknown` when
it started and its answer was lost, so it may have run. Delivery is at least
once: a command that must not act twice, such as one that messages a person,
records what it did keyed on `$S5X_SCHEDULE_ID` and `$S5X_SCHEDULED_AT` and
skips a pair it has seen.

`--max-lateness none` on `schedule set` puts the default back. Code inside a
sandbox sees every schedule on it, yours included, and any process there can
add, change or delete them, unless the template was built with
`--trusted-users`: then only those users and root can. Change them
with the CLI instead, which checks no trusted user; yours still run. A
scheduled command runs as the image's `USER`, so on such a template it cannot
read the vault: have it ping your trusted helper instead (the s5x-sdk skill's
`references/guest.md`, "Schedules").

## Script it with --json

```bash
# every sleeping sandbox
s5x --json sandbox ls | jq -r '.[] | select(.state=="sleeping") | .ref'

# run, and branch on the exit code the command itself returned
out=$(s5x --json sandbox exec dev "test -f /data/ready") && echo ready

# make a sandbox only if it is missing
s5x --json sandbox ls | jq -e '.[] | select(.ref=="dev")' >/dev/null \
  || s5x sandbox create dev --template app
```

Under `--json`, stdout holds one JSON document and nothing else. A failed
request is `{"error", "status", "requestId", "retryAfter", "code", "exit",
"sandbox", "path", "sandboxes", "drive", "holders"}`, with only the fields that
apply, and exit status 1; a refused invocation (an unknown option, a missing
argument) is `{"error", "detail"}` with exit status 2.
Human output goes to a terminal and changes between releases; do not parse it.

**What each listing returns.** Every listing is the API's own objects, never
the table's rows: exact byte counts, ids and full timestamps. These
keys are all there is.

| Command | Keys of each element |
|---|---|
| `sandbox ls` | the object `sandbox stats` returns, one per sandbox: `id`, `ref`, `state`, `region`, `regionPin` when you placed it, `template` (the name), `templateId`, `templateDigest` (`sha256:…`), `pendingTemplateId` and `pendingDigest` while a switch is pending, `vcpus`, `memMb`, `diffBytes`, `volumes` (every volume and snapshot it holds, in drive order, `[]` for none: `drive`, `path`, `mode` (`rw` or `ro`), `volume` (the volume's name; a snapshot's is the volume it was taken of), `snapshot` (its `vsn_` id, on `ro`), `state` (`attaching`, `attached` or `detaching`)), `wakes`, `idleTimeoutS`, `expiresAt` and `ttlIdleS` when set, `allowedHosts` only when it is restricted, `cpuUsec`, `memBytes`, `memPeakBytes`, `pids` and `metricsAt` once measured, `req2xx`, `req4xx`, `req5xx`, `lastWakeAt`, `lastSleepAt`, `lastActivityAt`, `lastActivityKind` (what moved it last: `cpu`, `traffic`, `awaiting`, `request` or `hold`) and `lastActivityRemote` (whom an awake one is talking to, on `traffic` or `awaiting`) once set, `pendingVcpus` and `pendingMemMb` while a resize waits for its next wake, `machineLost` when its machine has stopped answering, `suspended` (`at`, `reason`) when s5x has suspended it, `createdAt` |
| `sandbox proc ls <ref>` | `name`, `pid`, `command`, `workingDir`, `status` (`starting`, `running`, then `completed`, `failed`, `killed` or `timeout`; `app` always reads `running`), `startedAt`, `completedAt` and `exitCode` (`null` while it runs), `keepAlive`, `timeoutSeconds` |
| `sandbox env ls <ref>` | not objects: the names, as strings |
| `sandbox preview ls <ref>` | `id`, `sandboxId`, `hostname`, `label` (the hostname's first part), `port`, `createdAt`, `expiresAt` |
| `sandbox snapshot ls <ref>` | `name`, `bytes`, `createdAt` (Unix seconds), `templateId` (the build it was taken on) |
| `sandbox backup ls [ref]` | finished backups only: `id`, `bytes`, `volumeOnly`, `automatic`, `expiresAt` on an automatic one, `createdAt`; a sandbox's (`volumeOnly` false) also `sandboxId`, `ref` (the name of the sandbox it came from), `templateId`, `templateName` and `templateDigest` (the build it was taken on), `vcpus`, `memMb` and `drives` (`drive`, `path`, and `volumeId` and `fsBytes`, or `snapshot`); a volume's `volumeId` and `fsBytes`, and `sandboxId` and `ref` only when its volume was attached then |
| `volume backups <name>` | the same objects: the volume's own backups and the sandbox backups holding it |
| `operation ls` | `id`, `kind` (`backup`, `restore`, `snapshot`, `upload` or `erase`), `status` (`uploading`, `queued`, `running`, then `done` or `failed`), `phase` while it runs, `sandboxId` and `ref` (on a volume's backup or restore, only when it goes through the sandbox holding it), `volumeId` and `volumeOnly` on a volume's, `error` on a failed one, `backupId` or `snapshot` (what a restore restores from), `templateId`, `automatic` (`true` on a backup s5x took on its own), `removed` (what an erase removed, as far as it got), `path`, `bytes`, `expiresAt` and, on a failed one, `errorStatus` (an upload's), `createdAt`, `startedAt`, `finishedAt`; a field that does not apply is absent |
| `template ls` | one element per build of every name, grouped by name, newest first: `id` (`tpl_…`), `name`, `image`, `imageDigest`, `status` (`pending`, `building`, `ready`, `failed`), `digest` (`sha256:…`, only once `ready`), `latest` (`true`, or absent), `sandboxes` and `switching` (numbers), `expiresAt` (when s5x deletes it, `null` while it is kept), `readyTimeoutMs`, `trustedUsers` (as the build named them, `[]` for none), `warnings` (what the build found in the image that could give another user a trusted user's reach, `[]` for none), `createdAt`, `promotedAt`, and `error` on a failed build — why it failed |
| `template show <name>` | the same, for one name — newest build first |
| `endpoint ls` | `id`, `name`, `hostname`, `url`, `port`, `auth` (`token` or `public`), `sandboxId` and `sandboxRef` (the sandbox's name; both `null` when its sandbox was deleted), `detachedAt`, `createdAt` |
| `sandbox schedule ls <ref>` | `id`, `sandboxId`, `name`, `cron` or `at` (a one-shot), `maxLatenessS` when set, `command`, `enabled`, `nextRunAt`, `completedAt` (a one-shot that has run), `runs`, `createdAt`, `lastExit` (`null` before the first run), and once it has run `lastRunAt`, `lastOutput` and `lastCommand` |
| `sandbox schedule runs <ref> <name>` | `scheduledAt`, `outcome` (`ran`, `not_run`, `too_late`, `unknown`), `reason` (for all but `ran`), `exit` (`null` unless `ran`), `command`, `cron` (absent for a one-shot); `startedAt`, `lagS` and `durationMs` when it started; and `output` (left out when the run printed nothing; `--output` only adds it to the human output) |
| `sandbox vault ls <ref>` | `key`, `version`, `updatedAt`, `keyId` (the id of the encryption key that holds the value) |
| `sandbox vault login ls <ref>` | `id` (`lg_…`), `websites`, `username` (`""` for none), `hint`, `hasTotp`, `createdAt`, `updatedAt`; never a password or seed |
| `volume ls` | `id` (`vol_…`), `name`, `region`, `usedBytes` (what it holds, as last measured: what it is billed), `fsBytes` (its filesystem's size now), `limitBytes` (the most it grows to), `attachedTo` (`{sandbox, path, drive}`, or `null` while detached), `backupDays`, `forkOf` (the snapshot it was forked from, or `null`), `createdAt`, and `provisionedAt` once its file is made |
| `volume snapshot ls <name>` | newest first: `id` (`vsn_…`), `volume` (its name), `usedBytes` (what only it holds, 0 until measured), `fsBytes`, `attachedTo` (`[{sandbox, path, drive}]`, `[]` for none), `createdAt` |
| `logs sandboxes` | one object, not an array: `{sandboxes: [{sandbox, ref, last, events, deleted}], truncated, retentionDays}`; `sandbox` is the id |

Single-object commands return the whole API object instead:
`sandbox stats` (`id`, `ref`, `state`, `template` (the name), `templateId`,
`templateDigest` (`sha256:…`, the build it runs), `pendingTemplateId` and
`pendingDigest` while a switch is pending, `volumes`,
`allowedHosts` only when it is restricted, exact byte counts, …), `sandbox
create`, `volume attach` and `volume detach` (the same object), `volume info`,
`set`, `fork` and `restore` (one element of `volume ls`), `volume snapshot
take` (one element of `volume snapshot ls`),
`template build` and `push` (the ready build, one element of `template ls`),
`endpoint create` (`url`, and `token` and `browserUrl` once), `preview create`
(the same), `schedule set`, and `sandbox exec` (`exit`, `stdout`, `stderr`,
`timedOut`, true only when the command was killed at its time limit — `exit`
is then 124, and a command that exits 124 by itself has `timedOut` false —
and `binary`, true when the output held bytes that are not UTF-8, which came
back as U+FFFD: copy such a file with `sandbox cp`).

The `sandbox network` commands each return one object — **including
`network ls`**, which is not a listing array:

| Command | Returns |
|---|---|
| `sandbox network ls <ref>` | `{allowedHosts, headers: [{host, name}]}`. `allowedHosts` is `null` for any host and `[]` for header-rule hosts only; header names come back canonical (`X-Api-Key`, not `x-api-key`); values never |
| `sandbox network header set` | `{host, name, pending}`, the host lowercased and the name canonical |
| `sandbox network header rm` | `{removed: {host, name}, pending}`, echoing the host and name as you typed them |
| `sandbox network allow` | `{allowedHosts, pending}`, the list lowercased, deduplicated and sorted, or `null` |

`pending: true` means saved but not in force yet; it is in
force within about 20 s. A sleeping sandbox answers `pending: false` and gets
the change at its next wake.

```bash
# is the build whose wait I stopped with Ctrl-C ready yet? (its tpl_ id is what build and push printed)
s5x --json template show web | jq -r --arg id "$id" '.[] | select(.id==$id) | "\(.status) \(.digest)"'   # poll until "ready sha256:…"; "failed" means stop and read .error

# why did a build fail?
s5x --json template show web | jq -r '.[] | select(.status=="failed") | "\(.id): \(.error)"'

# does agent-1 have its Anthropic rule? (names come back canonical: compare without case)
s5x --json sandbox network ls agent-1 | jq -e '.headers[]? | select(.host=="api.anthropic.com" and (.name|ascii_downcase)=="x-api-key")' >/dev/null && echo set

# which template and build does a sandbox run?
s5x --json sandbox stats agent-1 | jq -r '.template + "@" + ((.templateDigest // "") | ltrimstr("sha256:"))[0:12]'

# did a command run out of time, or exit 124 by itself?
s5x --json sandbox exec dev "cd /app && npm test" | jq -r 'if .timedOut then "killed at its limit" else "exit \(.exit)" end'

# does an endpoint exist, what is its URL, and which sandbox does it point at?
s5x --json endpoint ls | jq -r '.[] | select(.name=="bot-hook") | "\(.url) \(.sandboxRef)"'
```

Do not poll with `map(select(.status=="ready"))[0]`: that is the newest READY
build, and while a new build is still pending or building, it is the OLD one.
Promoting a sandbox to it with `--now` moves it to the old build, or does
nothing if it already runs that one. `template build` and `push` print the new
build's `tpl_` id on stderr while they wait; under `--json` it is the `.id` of
the object printed when the build is ready or when the wait is stopped with
Ctrl-C. It is that
build's `id` in `template show --json`, as above. `sandbox promote` and `template promote`
take it too, and it names exactly that build even if someone else starts
another build of the name. A promote by id before the build is ready gets a
409 (`… is building; only a build that finished can be promoted`).
