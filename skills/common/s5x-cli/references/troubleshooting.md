# s5x troubleshooting

s5x error messages are written to name the fix — often as a literal command.
Read the whole message before improvising. This file covers what the messages
cannot: which state a sandbox is in, and the failures that do not produce an
error at all.

## Contents

- [Sandbox states](#sandbox-states)
- [Errors by status](#errors-by-status)
- [Failures with no error](#failures-with-no-error)
- [Where to look](#where-to-look)

## Sandbox states

`s5x sandbox ls` shows one of these:

| State | Meaning | What to do |
|---|---|---|
| `creating` | booting for the first time | wait and retry (409 `still being created`). A create finishes even when its caller gave up (a 524), so it turns `running` or `unhealthy` on its own. After a 500 on create it is usually already removed; see the 500 row |
| `running` | awake | — |
| `sleeping` | idle, memory saved to disk — and also while it is being woken, for the seconds a snapshot or backup takes its copy, and while a restore replaces it | nothing — a call that needs the VM (`exec`, `proc`, `cp`, `shell`, a request to its URL, a schedule) wakes it; `sandbox ls`/`stats`, `logs`, `env`, `vault` and `network` do not |
| `unhealthy` | its last create or wake came up not ready: the guest never answered its readiness check, did not take its env, or (only on a wake) its volume would not mount. It is never marked `running` without them. s5x does not watch a running sandbox's health; only a boot or wake sets this | If you have the error that left it here, follow its row. If not, call it once (`s5x sandbox exec <ref> true`): the wake checks it again and delivers the env again, and if it is still not ready, its error says which. Do not loop on the volume one. Left idle, it sleeps like any other |
| `dead` | its VM died while it was awake, so there is no memory image it can trust; it reads `dead` usually within 40 s of the VM stopping, or at once when a call finds the VM gone (its machine restarted, say), and that call brings it back. A sandbox with `--idle 0` is always awake, so any death of its VM ends here. s5x boots it again on its own disk by itself -- at every wake, and on its own with `--idle 0` until five tries fail (`s5x logs <ref> --source system`: `died`, `recovered`, `recovery_failed`). **It is kept, with everything it has, until you recover or delete it** | `s5x sandbox recover <ref>`: same disk, fresh boot; only the entrypoint (`app`) comes back. Restarting what `proc run` started, whose command line and flags the audit record does not keep, and the snapshot/backup restore alternative (ask the user first): `workflows.md`, "Bring back a dead sandbox" |
| `deleting` | being removed. It can take a few minutes, for example while a backup is taking its copy or a restore is replacing it. Its name is free from the moment `s5x sandbox rm` answered, so a sandbox of the same name can be created at once; `rm` returns then, and says so when the deletion is still under way. Its volume is freed only when the deletion finishes: until then a create with that `--volume`, or a `volume rm` of it, gets 409 | nothing; it finishes by itself. For that 409, wait a few minutes and retry. Do not `s5x sandbox rm` the ref again: the name may already be a new sandbox |

No sandbox reports `waking`. One being woken reads `sleeping` (or
`unhealthy`, if that is where it was) until it is `running`. A snapshot or
backup of a running sandbox pauses it for the copy, so it reads `sleeping` for
those seconds and `running` again once the copy is taken; a backup then
uploads while the sandbox runs. A restore downloads a backup while the
sandbox runs as it is, then replaces it in seconds and leaves it `sleeping`;
the next call wakes it. A call made while a wake, a copy or a replacement is
in progress waits for it, and after about 30 s gets a 503 `the sandbox is
taking too long to wake` (or `your sandbox is being restored; try again in a
few seconds`).

## Errors by status

| Status | Typical message | Meaning and fix |
|---|---|---|
| 400 | `a sandbox name must be 1-63 characters of lowercase letters, digits, …` | names are lowercase, digits, `.` `-` `_`, starting with a letter or digit |
| 400 | `memMb must be at least 256 MB: a guest does not come up in less`, `vcpus must be at most N: the largest sandbox is N vCPUs and M MB`, `memMb must be at most M MB: the largest sandbox is N vCPUs and M MB` (from `sandbox create`, `sandbox set`) | the size is outside the limits, at most 4 vCPUs and 8192 MB; pick one inside them |
| 400 | `your sandbox's machine holds at most N MB; pick a size of N MB or less` (from `sandbox set --mem`) | its machine could never hold that size, even empty; nothing changed. Pick a smaller one |
| 409 | `your sandbox never sleeps, so a size change applies only with now: …` (from `sandbox set --mem`) | it has `--idle 0`, so it has no next wake to change size at; add `--now`, which restarts its processes (ask first), or give it an idle timeout |
| 409 | `your sandbox is being restored (rs_…), and the restore puts back a size of its own; …` (from `sandbox set --mem`) | wait for the restore (`s5x operation wait <id>`), then set the size |
| 409 | `your sandbox is being restored (rs_…); recover it once the restore is done` (from `sandbox recover`), or `…; call it again once the restore is done` (from any call to a dead sandbox) | it cannot boot on its own disk while a restore of it is unfinished; wait for the restore (`s5x operation wait <id>`), then run it again |
| 503 | `your sandbox's machine has no room on its disk for a N MB memory image right now; …` (under `--json`, `"code": "no_capacity"`, from `sandbox set --mem`) | a sandbox keeps its memory image on its machine's disk while it sleeps, and that disk is spoken for; nothing changed. Retry after `retryAfter` (60 s), as sandboxes and volumes on its machine are deleted. s5x never moves a sandbox to another machine to make room |
| 409 | `the machine your sandbox runs on has not answered for … minutes. …` (under `--json`, `"code": "machine_lost"`; from any call that wakes it, `recover` of one with a volume, `set --mem`) | its machine is lost (`sandbox ls` says `machine lost`). If it answers again, the sandbox comes back as it was, with its disk. It moves to another machine only once s5x has made sure the lost one is off, so two copies never run: until then the message says so, and a restore or recover is refused the same way. Then the message names the ways back: `s5x sandbox backup restore <ref> <id>` (its newest machine backup, which the message names; what it wrote since is lost), or, with no volume, `s5x sandbox recover <ref>` (fresh from its build). Either moves it to another machine under the same name; the copy left on the lost one is destroyed when it answers. A volume's backup (`s5x volume backups <name>`), an automatic one too, never moves the sandbox: it brings the volume back alone, as a new volume, with `s5x volume restore <backup-id> <new-name>`. Ask the user first |
| 403 | `this account is suspended by s5x since <date>: <why>. Every call is refused …` or `this sandbox is suspended by s5x since <date>: <why>. …` (under `--json`, `"code": "suspended"`) | s5x suspended your account, and refuses every call of it, or this sandbox, and refuses every call naming it but `sandbox ls` and `sandbox stats`, which show it suspended. Nothing in it runs or wakes, and nothing of it is deleted. Retrying changes nothing: tell the user what the message says; only s5x lifts it |
| 400 | `a command's time limit is at most 60s (60000 ms) …` | `exec --timeout` is seconds, at most 60; use `sandbox proc run` for longer |
| 429 | `your sandbox already has 4 uploads in progress (at most 4 at once); …` (from `sandbox cp` of a file over 32 MiB) | a sandbox takes at most 4 files sent in parts at once. Nothing was sent; retry when one finishes (`retryAfter` 5) |
| 429 | `your uploads in progress already hold 1 TiB; …` (from `sandbox cp`) | your unfinished uploads across all sandboxes hold 1 TiB of parts. `cp` removed this one; retry when others finish |
| — | `uploading part N of your file failed (HTTP s); nothing was written to <path>` (from `sandbox cp`) | storage would not take a part after three tries. Nothing reached the sandbox; run the copy again |
| 409 | `part N of your file is missing; …` / `part N of your file is … bytes, not …; …` (from `sandbox cp`) | a part was missing or the wrong size when the file was put together. Nothing was written; run the copy again |
| 422 | `your file could not be read back from storage; send it again` / `your file in storage is … bytes, not …; nothing was written` (from `sandbox cp`) | the file put together from its parts could not be read, or was the wrong size, when it was placed. Nothing was written; run the copy again |
| 409 | `your file was interrupted before it was assembled; nothing was written; send the file again` | run the copy again |
| 500 | `placing your file failed because of a fault on s5x's side; send it again` | nothing was written; run the copy again |
| 504 | `placing your file did not finish within …` | the sandbox took the file too slowly; nothing was written. Check its disk (`df`) and run the copy again |
| 400 | `request body is larger than 1048576 bytes` (from `exec`), `request body is too large` (from `proc run`) | the request is over 1 MiB, measured as the JSON-encoded command plus, for `proc run`, its `--env` values; it was refused before anything ran. Do not inline a big script or heredoc — your own shell usually refuses one first, as `Argument list too long`. Copy it in with `sandbox cp ./job.sh <ref>:/tmp/job.sh`, then run it by path: `sandbox exec <ref> "sh /tmp/job.sh"` |
| — | `trustedUsers names <entry>, which is not a user in the image's /etc/passwd` (or `… not a group in the image's /etc/group`, `… root is always trusted, and is never named`, `… that is nobody, …`) (a failed build's error) | each `--trusted-users` entry is a user of the image, or `@` and one of its groups, and never root or `nobody`. Fix the list or the image, and build again |
| — | `the image declares no USER, and exec, the shell and scheduled commands run as USER, so with trustedUsers it must be a user that is not trusted` (or `the image's USER … is root, …`, `… which trustedUsers trusts as …`) (a failed build's error) | a template with trusted users needs a `USER` in its Dockerfile that is neither root nor trusted: the user the assistant's tools run as |
| 400 | `trustedUsers entry "…" is not a user name or @ and a group name (…)`, `trustedUsers names at most 16 users and groups`, `trustedUsers names "…" twice` | fix `--trusted-users`; nothing was built |
| — | `your image is N MiB unpacked; with its 2 GiB of free space that is more than the M MiB a template's root filesystem may be. Keep large data on a volume` (a failed build's error) | the image and its 2 GiB of free space do not fit in the largest root filesystem. Slim the image and keep bulky data on a volume |
| — | `…: no space left on device: the image takes more than the N MiB a build may stage, twice the largest root filesystem a template may have; squash layers that add and then delete large files` (a failed build's error) | your image's layers, copied and unpacked, took more than one build may hold at once: usually a layer that adds large files a later one deletes. Squash those layers (a multi-stage build that copies only the result) and build again |
| — | `your pushed image is more than N MiB uncompressed, the largest root filesystem a template may have; squash layers that add and then delete large files` (a failed `template push`'s error) | the archive `docker save` wrote of your image, every layer in it, is larger than the largest root filesystem: usually a layer that adds large files a later one deletes. Squash those layers and push again |
| 400 | `your sandbox of M MB is more memory than any machine it can run on holds (at most N MB); give it a memMb of N or less` (from `sandbox create`) | no machine could ever hold it, so a retry never helps. Nothing was created; create it again with `--mem` N or less |
| 400 | `volumes[N].path … is under /proc …`, `… is inside volumes[M].path …`, `… attaches a snapshot, which needs a path` (under `--json`, `"code": "bad_path"`) | a path is absolute, at most 255 bytes, not `/`, not under `/s5x`, `/proc`, `/sys` or `/dev`, given once, and not inside another of the same command; a snapshot (`vsn_…:<path>`) needs its path. Nothing was created |
| 400 | `volume name vol_… starts with vol_, which is reserved …` (`"code": "bad_name"`), `a sandbox holds at most 4 volumes and 4 snapshots …` (`"code": "too_many_volumes"`) | a volume's name follows a sandbox's rules and may not start `vol_` or `vsn_`; at most 4 `--volume <name>` and 4 `--volume vsn_…` at create |
| 400 | `unknown region "…"; this fleet serves …` | pick a region from the list, or omit `--region` |
| 400 | `port … is reserved for the guest agent` | that port is s5x's own; expose your app on another |
| 400 | `"…" is not an exact hostname: give a bare name like api.github.com -- …` | from `network header set`, `network allow`, `--header` or `--allow-hosts`. A bare name only: no scheme, path, port, wildcard or IP address, and an international name in its `xn--` form. Name every host in full: `github.com` does not cover `api.github.com` |
| 400 | `an allowlist holds at most 100 hosts` / `a sandbox has at most 20 header rules` (from `create --header`) | those are the caps. A header rule's host is reachable without being listed |
| 400 | `… cannot be set by a rule` | `Host`, `Content-Length`, `Connection` and the other framing and routing headers belong to the proxy |
| 400 | `the value for … must be one line of at most 8192 bytes` | a header value is one line, with no control characters |
| 400 | `not a template reference: "x:v2" -- s5x has no template tags. If it is a Docker image, build a template from it first …` | a Docker image becomes a template with `s5x template build x:v2 --name <name>`. For your own template, use `x` (its latest promoted build) or `x@<digest>`; `s5x template show x` lists the builds |
| 400 | `not a template reference: "4" is not a build of x -- use the digest …` | there are no build numbers; use the digest `s5x template show x` prints, or a `tpl_` id |
| 400 | `a process name is 1-64 characters of letters, digits, dot, dash or underscore, and is not . or ..` | from `proc run --name` and the other `proc` verbs. `app` and `console` are also taken: they are the entrypoint and the VM's serial console |
| 400 | `a schedule command is at most 4096 bytes (this one is N); …` | put the script in a file in the sandbox (`sandbox cp`) and schedule `sh /path/to/job.sh` |
| 400 | `ttl must be greater than zero` (from `preview create`) | give `--ttl` a positive duration (`1h`, `24h`, `7d`), at most 90 days |
| 400 | `a vault value is at most 65520 bytes; that one is N: …` (from `vault set`) | a vault is for credentials, not storage; keep bigger data on a volume |
| — | `<name> needs a value` (from `env set`, `vault set`, and `network header set`, where it names the header), `--header <host>:<header> needs a value` (from `sandbox create`) | the CLI refused before sending: nothing was piped, and it cannot prompt you. Pipe the value in, as in `workflows.md` "Give a sandbox an API key it never holds" |
| — | `only one --header value can be piped` (from `sandbox create`) | nothing was created. `sandbox create` reads one piped value. Re-run it with that one `--header`, then set each other rule with `network header set`, each with its own pipe. Rules set after the create were not there at first boot |
| 401 | `not signed in` / invalid key | `s5x whoami`; sign in with `s5x login` as SKILL.md's "Before the first command" says, or the user exports `S5X_API_KEY` |
| — | `the sign-in expired before the browser approved it; …` (from `s5x login`) | nobody approved the page within 15 minutes, or the command was stopped first: a foreground command is, long before that. Run it again in the background, or `s5x login --no-browser --json` |
| — | `the sign-in ended in the browser: access_denied (declined in the browser)` | the user pressed Deny. Ask them before you start another |
| 400 | `"code": "bad_code"` (from `s5x login --code`) | the code is not this sign-in's: mistyped, or from another sign-in's page. Ask the user to read it again; a sign-in closes after five wrong codes. Nothing that is not 8 letters is sent, so it costs no try |
| 404 | `"code": "login_not_found"` (from `s5x login`), `this sign-in is closed: …` (from `s5x login --code`) | the sign-in is closed: used, expired (a code the page shows lasts 10 minutes), or out of tries. Start again |
| — | the page asks for an invite the user has used | that browser has no sign-in: the link was clicked in a web page (a chat, webmail), which does not carry it, so have them paste it into the address bar; or it is another browser, or its sign-in ended after 30 days unused or 90 in all. Only that browser, or a new invite from s5x, approves |
| — | `no sign-in is waiting on this machine …` (from `s5x login --code`) | `--code` finishes the sign-in `s5x login --no-browser` started on this machine. Start one |
| — | `nothing was removed: … failed: …` (from `s5x logout`) | the API was not reached, so the key was not revoked; run `s5x logout` again. Deleting `~/.s5x/credentials.json` forgets the key without revoking it |
| — | `… prints a key once, so it runs only in a terminal you type in: …` (from `s5x key create`) | it refuses without a terminal and under `--json`, and an agent never runs it: give the user the command to run in their own terminal, `k=$(s5x key create <name>) && <set it where the server reads it>` |
| 403 | `"code": "login_key_only"` (from `s5x key ls`, `s5x key rm`) | only a key `s5x login` made lists or revokes keys. The stored key was not made by `s5x login`, or a program sent a server's key: run `s5x login` on this machine, then `key ls` or `key rm` again |
| 404 | `"code": "key_not_found"` (from `s5x key rm`) | already revoked, mistyped, or not a key `s5x key create` made. `s5x key ls` lists the ones it revokes |
| 409 | `"code": "key_limit"` (from `s5x key create`) | the account has 100 keys made with `s5x key create`. Ask the user which one to revoke with `s5x key rm <id>` (`s5x key ls` lists them); nothing was made |
| — | `… is this machine's own key: …` (from `s5x key rm`) | `key rm` revokes keys `s5x key create` made, never the one this machine signs in with: `s5x logout` does |
| 403 | from `localhost:8081` inside the sandbox: `a POST to s5x inside your sandbox must send Content-Type: application/json (…)` | the POST had no JSON body type, which is all a web page can send there, so it is refused from any caller. Send `content-type: application/json` with a JSON body (`-H 'content-type: application/json' -d '{}'`); the s5x-sdk skill's `references/guest.md` has every endpoint |
| 403 | `Host "…" is not a name s5x answers to here` | call it as `localhost`, by an IP address, or by a name under `.internal`, on any port. A container uses `host.docker.internal` or the bridge address; in compose, `extra_hosts: ["host.docker.internal:host-gateway"]` |
| 403 | from `localhost:8081/v1/…` inside the sandbox: `… is served only to the s5x host …` | exec, files, processes, env and the shell are driven from outside, with the CLI or the SDK; the s5x-sdk skill's `references/guest.md` lists what code inside may call |
| 429 | from `localhost:8081` inside the sandbox: `this sandbox is calling its vault, schedules and whoami more than 50 times a second …` | logins count too. Keep the value it read instead of asking again per request; it answers again within a second |
| 403 | from `localhost:8081` inside the sandbox: `only this template's trusted users may call …; this request came from uid N, which is not one of them` (or `… came from a user s5x could not tell …`, a container on a bridge network of its own) | the template was built with `--trusted-users`, and that code runs as another user. Run it as a trusted user, outside such a container, or leave the secret to code that does: the s5x-sdk skill's `references/guest.md`, "Trusted users" |
| 403 | from `localhost:8081` inside the sandbox: `POST /v1/vault/logins/… is served only to a template's trusted users, and this sandbox's template names none: build it with trustedUsers …` | logins are read only on a template with trusted users: `template build` (or `push`) with `--trusted-users`, then promote the sandbox to that build |
| 403 | from `localhost:8081` inside the sandbox: `… refuses … when it carries Origin or Sec-Fetch-Site, as a web page's request does …` | on a template with trusted users, the vault, logins and schedule changes refuse anything a browser sent. If your server forwards its visitors' headers to s5x, drop those two |
| 403 | from `localhost:8081` inside the sandbox: `this sandbox's / and /s5x are not both root's alone (…), so s5x refuses …` | root in the sandbox loosened `/` or `/s5x`, so the vault, logins and schedule changes are refused to everyone, on any template; exec and files still work. Treat it as a root compromise of that sandbox: while they were loose, any user could replace s5x's own files, which run as root at the next boot, and a resize or `recover` boots that same root filesystem. Stop what loosened them, then `s5x sandbox promote <ref> <build> --now` to a fresh build of its template (a rebuild of the same image counts; the build it runs does not), which replaces everything outside its volumes |
| 403 | from `localhost:8081` inside the sandbox: `… cannot keep users other than root off its door right now, …` | root in the sandbox removed s5x's routing rules (`ip rule`); s5x puts them back within 10 s: retry in a moment |
| 400 | `"app" is this sandbox's entrypoint and cannot be stopped or killed by name. …` (from `proc kill`) | restart it instead: `s5x sandbox proc restart <ref> app` |
| 400 | `only the entrypoint (…) restarts; a process you start with … is stopped and started again` (from `proc restart`) | a `proc run` process is stopped with `proc kill` and started again with `proc run` |
| 409 | `<website> already has a login with that username, lg_…` (from `vault login set`) | that login holds this account for that website (`example.com` and `www.example.com` count as one): change it with `--id lg_…`, or give another `--username` |
| 409 | `this sandbox already holds 100 logins, the limit; delete one first` (from `vault login set`) | `s5x sandbox vault login ls <ref>`, and `vault login rm` one it no longer needs |
| 400 | `this TOTP seed is not valid` (from `vault login set --totp-stdin`) | pipe the `otpauth://totp/` URI the website's two-factor setup shows, or its base32 seed; nothing was changed |
| 400 | `website N is not a lowercase hostname: no scheme, port, path or wildcard` (from `vault login set`) | `--website github.com`, not `https://github.com/login`: the host alone, lowercase |
| 404 | `sandbox "x" does not exist` (also from every `schedule` command) | check `s5x sandbox ls`; `S5X_API_KEY` may hold a different key than you expect (`s5x whoami`) |
| 404 | `template "x" does not exist` | no template by that name; `s5x template ls` |
| 404 | `<ref> has no schedule named <name>` (from `schedule rm`, `run`, `runs`, `set`) | `s5x sandbox schedule ls <ref>` lists its schedules. A name is unique on its sandbox, so the one you mean may be on another of yours |
| 409 | `this sandbox already has a schedule named "x"; pick another name` (from `schedule add`) | change that one with `schedule set`, or pick another name |
| 409 | `x was a one-shot and has had its occurrence …` (from `schedule set`, `run`) | it is kept as a record; add a new schedule to run it again |
| 400 | `… is in the past: a one-shot may be at most 5 minutes past …` (from `schedule add --at`) | give a future instant, with its offset |
| 404 | `snapshot "x" does not exist` (from `snapshot restore`, `snapshot rm`) | `s5x sandbox snapshot ls <ref>` lists them |
| 409 | `a sandbox named "x" already exists` | use the existing one, or pick another ref. If your own `create` of `x` just failed, this is that sandbox. Do not create it again under a new name: this one still holds its disk and its volumes (409 `volume … is attached to …`). After a not-ready 503 (`never became ready` / `did not take its environment`) it is `unhealthy`: follow that 503's row below. After a 500 `the request could not be completed` it is still `creating` until it is removed (see `creating` above and the 500 row) |
| 409 | `template "x" has no ready build yet -- …` | `s5x template show x`; wait for `ready`, or fix the failed build (the line under the table says why it failed) and push again |
| 409 | `template "tpl_…" is pending, not ready` / `… is building, not ready` / `… is failed, not ready` (only a `tpl_` id gets this; a name gets `has no ready build yet`) | pending or building: wait, polling `s5x template show <name>` until `ready` (`template build` and `push` wait for their own build, so this is a build still running elsewhere or one whose wait was stopped with Ctrl-C). Failed: that build will never be ready — the line under `template show`'s table says why; fix it and build again, or create with the name to get its latest promoted build |
| 404 | `volume "x" does not exist; to make it, add "create": true (--create)` (`"code": "volume_not_found"`) | from `sandbox create --volume` or `volume attach`: no volume of that name, and nothing was made, so a typo never becomes a new, empty disk. Check the name with `s5x volume ls`; add `--create` only if a new, empty volume is what the user wants |
| 409 | `volume "x" is attached to y; detach it there first (…)` (`"code": "volume_attached"`; `"sandbox"` and `"path"` under `--json` say where) | a volume is held by one sandbox at a time. `s5x volume detach y <path>` frees it (ask the user first: y loses it), then attach it again; or use another volume. From `volume rm`, detach it first |
| 409 | `volume "x" is still held by sandbox sb_…, which is being deleted …` (`"code": "volume_attached"`, with `retryAfter`) | the sandbox that had it is on its way out and lets the volume go once its deletion finishes, within a few minutes. Wait and try again, or use another volume name. Do not `rm` anything: the old sandbox's name is already free and may now be a different sandbox |
| 409 | `… is on another machine than y, and a volume is attached only on its own …` (`"code": "volume_on_another_host"`) | from `volume attach`: a volume or snapshot is attached only on its own machine. For a volume: create a sandbox with it (`sandbox create <ref> --volume x`, placed on its machine), or `s5x volume backup x` and `s5x volume restore <backup-id> <new-name> --next-to y`, then attach that. For a snapshot: create a sandbox with it, or `volume fork` it and use the fork on its machine. From `sandbox create`, `… are on different machines …` (`"code": "volumes_on_different_hosts"`): a create's volumes and snapshots must share one machine; attach the others later where they are, or restore a copy |
| 409 | `/data is busy: N processes hold it …` (`"code": "volume_busy"`), each holder printed under it (`"holders"` under `--json`: `pid`, `command`, `uses`) | from `volume detach`: processes in the sandbox hold the volume, by their working directory or root (`cwd`, `root`), an open or mapped file (`file`, `map`), its device, or a mount namespace of their own (`mount`: a container, Chromium's sandbox, `unshare -m`). Nothing was detached. Stop them (`proc kill`) and detach again, or ask the user before `--force kill` (kills them) or `--force restart` (restarts the sandbox without the volume, every process in it) |
| 409 | `u-1 is dead, so /data cannot be unmounted in it; …` (`"code": "sandbox_dead"`) | from `volume detach`: nothing in a dead sandbox can unmount the volume. `volume detach <ref> <path> --force restart` detaches it and recovers the sandbox without it; `sandbox rm` keeps its volumes, detached; `sandbox recover` brings it back holding them |
| 409 | `<build> has no image for the machine … so none was switched` / `… so it was not promoted` / `it was taken on <build>, which has no image for the machine your sandbox is on` (`"code": "incompatible_machine"`) | from `template promote`, `sandbox promote`, or a snapshot or backup restore: the sandbox's machine has a CPU that build has no image for. Build it again (`template build`), which makes one, or use another build |
| 409 | `you already have N sandboxes, your account's limit; …` / `you have N sandboxes, more than your account's limit of M; delete K, …` (when s5x lowered your limit below what you have) (`"code": "sandbox_limit"`, from `sandbox create`) | nothing was created. Each sandbox you have counts, dead ones included, until you delete it; one being deleted does not. Ask the user before deleting any (as many as the message says; `s5x sandbox rm <ref>`), or ask s5x support to raise the limit. A plain retry gets the same answer |
| 409 | `your volumes and snapshots hold your account's cap; …` (`"code": "volume_cap"`) | no new volume is made, and none of yours grows past what it holds (its writes get ENOSPC). Delete volumes or snapshots you no longer need (`volume rm`, `volume snapshot rm`), or ask s5x support to raise the cap |
| 409 | `… is attached to u-1 and u-2; detach it there first` (`"code": "snapshot_attached"`, `"sandboxes"` under `--json`) | from `volume snapshot rm`, `volume rm`, or `sandbox erase` (a snapshot of one of its volumes held elsewhere): `volume detach` it from each sandbox named, then again |
| 409 | `the backup holds … which u-1 does not hold now …` (`"code": "volumes_changed"`) | from `backup restore` or `snapshot restore`: a sandbox's checkpoint restores only while the sandbox holds what it held then, by drive, path and volume or snapshot. Attach them as they were, or restore one volume alone: `volume restore <backup-id> <name> --drive rwN` (a new volume) or `--replace` (over its own) |
| 409 | `this sandbox is dead: …` | `s5x sandbox recover <ref>` boots it again on the same disk; until then it is kept. From `snapshot create` or `backup create` (or as a backup's failure), no copy was taken: take it after the recover |
| 409 | `this sandbox's VM no longer exists; delete the sandbox and create it again` | the sandbox cannot be brought back. Ask the user before `s5x sandbox rm <ref>`: its snapshots go with it, and its backups cannot be restored onto the new one. Its volumes survive, detached: attach them to the new sandbox |
| 409 | `only a dead sandbox can be recovered; this one is <state>` (`… and answering` when it is running or unhealthy) | sleeping, creating or deleting: there is nothing to recover, and any call that needs the VM (`s5x sandbox exec <ref> true`) wakes a sleeping sandbox. `… and answering`: its VM is up and answering, so there is nothing to recover either; see the states above. `… its VM is up but not answering …`: the VM runs and missed a health check, which a busy sandbox can do, so it is not restarted; wait and call it again. If it never answers, `s5x sandbox recover <ref> --force` restarts it from its disk and ends every process in it, so ask the user first. `recover` does take a `running` or `unhealthy` sandbox whose VM has stopped |
| 503 | `your sandbox is waking or going to sleep; try again in a moment`, `your sandbox is receiving a file; try again in a moment` (from `recover`) | it clears by itself: retry after `retryAfter` (2 s) |
| 503 | `could not check whether the sandbox is still answering; retry shortly` (from `recover`) | nothing changed; retry after a few seconds |
| 409 | `there is no room right now to bring back <ref> as a sandbox that never sleeps. …` (from `recover`) | the sandbox has `--idle 0`, and there is no room for another sandbox that never sleeps. Its disk is intact: `s5x sandbox set <ref> --idle 300`, then `s5x sandbox recover <ref>` again |
| 409 | `there is no room right now for another sandbox that never sleeps. …` (from `sandbox create --idle 0` or `sandbox set --idle 0`) | give it an idle timeout (`--idle 300`); a request to a sleeping sandbox wakes it anyway. Or try again later |
| 409 | `x@<digest> is what "x" resolves to; promote another build first` | `s5x template promote x <other digest>`, then delete it |
| 409 | `x@<digest> is run by, or promoted to, N sandbox(es)` | promote those sandboxes to another build, or remove them, then delete |
| 409 | `your snapshot <name> of <ref> restores x@<digest>; delete every snapshot and backup taken on it first`, or `your backup bk_… restores …` (from `template rm`) | restoring that snapshot or backup boots the build, so it stays while either can. Delete them (`s5x sandbox snapshot rm`, `s5x sandbox backup rm`) if they are no longer needed, then delete the build; otherwise keep it |
| 409 | `the sandbox is busy; try again when its work finishes` (from `sandbox promote --now` or `sandbox set --now`), and a snapshot or backup that failed with `your sandbox was busy: a process in it holds a keep-alive, so it could not be paused for the copy. …` | the sandbox is held awake: a process started with `--keep-alive` is still running (`s5x sandbox proc ls <ref>`), or code inside holds it with `POST localhost:8081/v1/keepalive` (`curl localhost:8081/v1/keepalive` inside lists what holds it). These need the VM paused and normally will not pause it while it is held, so retrying before that work ends gets the same answer. From `promote --now` it ends `; <ref> stays promoted to <build> and switches at its next wake`; from `set --now` it ends `; <ref> keeps its new size and changes to it at its next wake`. Take a copy once the job has exited |
| 409 | `the sandbox is waking or being suspended; try again in a moment` (from a snapshot or `promote --now`), `could not check whether the sandbox's VM is up; try again in a moment` (from `promote --now`) | another wake, sleep, copy or restore of this sandbox is under way, or its host did not say in time whether its VM is up, so it was not switched. It clears by itself in seconds: retry after `retryAfter` (2 s), with a backoff |
| 409 | a refusal naming a backup, restore or snapshot in progress (`bk_…`, `rs_…`, `snp_…`) (from `backup create`, `backup restore`, `snapshot create`, `snapshot restore`) | one operation holds a sandbox at a time, and the message names the one running; a backup that is only uploading lets a restore start beside it. One that says `s5x's daily backup of its volume` is the automatic backup, which you did not start. Follow it — `s5x operation wait <id>` — and run yours once it is over. No `retryAfter`: it can take minutes |
| 409 | `your backup bk_… is still being taken; delete it once it is done`, `your sandbox is being restored from backup bk_… (rs_…); delete it once the restore is done`, and a refusal naming the operation that uses a snapshot or a build (from `backup rm`, `snapshot rm`, `template rm`) | what an operation reads cannot be changed under it: run it again once `s5x operation show <id>` says it is over |
| 404 | `your backup bk_… is still being taken; …`, `your backup bk_… failed: …` (from `backup show`, `backup restore`) | only a finished backup can be shown or restored: `s5x operation wait bk_…` waits for this one, or pick another from `backup ls` |
| — | a backup failed with `your backup's upload stalled; take another backup` | the upload stopped moving for two minutes; nothing of the sandbox changed. Take the backup again. (A restore whose download stalls is retried on its own until its time limit.) |
| 409 | `this sandbox is still being created` | another call's create is still booting it; retry every few seconds (`retryAfter` is 2) for up to two minutes, which a boot can take when the build first has to be fetched |
| 409 | `the sandbox is unhealthy and could not be woken`, `the sandbox kept going back to sleep and could not be woken` | this call waited on another call's wake, and that wake did not leave the sandbox running. It clears by itself: retry after `retryAfter` (2 s), which starts a fresh wake. If that fails too, it answers with one of the not-ready errors below, which says why |
| 409 | `sandbox <ref> cannot resume: … Its filesystem is intact; try again in a moment` | its VM crashed, and the crash could not be recorded yet. Retry after `retryAfter` (2 s): the next call records it and answers with the crash's own 409, which says how to bring the sandbox back |
| 410 | `this sandbox was deleted while the request was running; whatever it was doing may not have finished` (from `exec`, `cp`, `proc`) | the sandbox is gone; so may be what the call did. Do not retry against it |
| 409 | `this sandbox was suspended or replaced while the request was running (a snapshot, backup, restore or promote --now does that); …` (from `exec`, `cp`, `proc`) | the call may or may not have finished its work. Check what it did (a file's contents, `proc ls`) before running it again, and avoid a snapshot, backup, restore or `promote --now` while it runs |
| 409 | `this sandbox died while the request was running; …` (from `exec`, `cp`, `proc`) | its VM stopped mid-call, so the call may or may not have finished its work. `s5x sandbox recover <ref>` brings it back on the same disk; check what the call did before running it again |
| 409 | `it was taken on …, which has since been deleted, so it cannot be restored` | the snapshot or backup belongs to a build that no longer exists; it cannot be restored |
| 409 | `that backup was taken from a different sandbox` | a backup restores only onto the sandbox that took it. A replacement with the same name is a different sandbox, so the old backups cannot be restored onto it — there is no workaround |
| 409 | `you already have N endpoints, the limit; delete one first` | delete one with `s5x endpoint rm` |
| 409 | `that limit is reached; delete something first` (from `sandbox network header set`) | a sandbox holds at most 20 header rules. List them with `s5x sandbox network ls <ref>` and remove one. Changing the value of an existing rule is never refused |
| 422 | `this sandbox already keeps 10 snapshots, the most it may; delete one first, or retake one under its name` | `s5x sandbox snapshot ls <ref>`, then `s5x sandbox snapshot rm <ref> <name>` (ask the user which), or `snapshot create` under a name it already has, which replaces that one |
| 422 | `the command exited N, but what it printed is more than the 16 MiB an exec reply can carry …` | from `exec`: the command RAN, and its output is gone. Only if it is safe to run twice, run it again with the output redirected to a file (`"cmd > /data/out.log 2>&1"`) and copy that out with `sandbox cp <ref>:/data/out.log ./out.log`; otherwise check what it did. Next time, send large output to a file from the start. The 16 MiB counts the reply as JSON, where a quote, a backslash, or `\b` `\f` `\n` `\r` `\t` takes two bytes, and any other control character (including the ESC in ANSI color and progress-bar codes), U+2028/U+2029, or a byte that is not valid UTF-8 takes six. Binary or escape-heavy output therefore hits it at a few MiB, and binary output would have come back corrupted even if it fit, because each byte that is not valid UTF-8 becomes U+FFFD (copy files with `sandbox cp`) |
| 500 | `the request could not be completed (request id …)` | from `exec` or `proc run`: the command was sent and no answer came back, so **the command may have run**. Check whether it did before running it again, and quote the request id when you report it. From `create`: the sandbox could not be booted. It is removed at once and its name is free (a volume it made is kept, empty); only when s5x lost touch with the machine mid-boot does it stay `creating`, name taken, for 15 to about 20 minutes before it is removed. Do not retry the create in a loop; report it with the request id. If every call to an existing sandbox fails this way, run `s5x sandbox recover <ref>`, which keeps the filesystem |
| 503 | `the sandbox came up but did not take its environment, … call it again` | the VM is up but its env did not land, so it is left `unhealthy` rather than serving a missing or old value. Call it again (`s5x sandbox exec <ref> true`): its next wake delivers the env again. From `create`, the sandbox has been created, so do not run `create` again. If it comes back on every call, read `s5x logs <ref> --proc console` (`no space left on device` there has its own row). Otherwise, from `create`, a sandbox you put nothing on can be removed (`s5x sandbox rm <ref>`, ask the user first) and created again. If the image's own entrypoint runs the app, see the note below the table |
| 503 | `the sandbox came up but its clock could not be set, … call it again` | the VM is up but its clock is still the one it last slept with, so it is left `unhealthy` rather than serving with a wrong time (TLS and signed requests would fail). Call it again (`s5x sandbox exec <ref> true`): its next wake sets the clock again. From `create`, the sandbox has been created, so do not run `create` again. If it comes back on every call, read `s5x logs <ref> --proc console` |
| — | `could not write /s5x/env.sh … no space left on device` (in `s5x logs <ref> --proc console`, behind the env 503) | a full root filesystem, which only an image that runs as root (no `USER`, or `USER root`) can fill, and a new sandbox from the same build fails the same way. Keep data on the volume, and build the template again from an image that leaves the 2 GiB of free space for what the app writes (the root filesystem is the image plus 2 GiB, at most 20 GiB). Once that build is ready it is what the name gives a new sandbox, so if the sandbox came from your own `create`, run `s5x sandbox rm <ref>` (ask the user first) and create it again the same way |
| 409 | `the sandbox came up but its volume would not mount, … calling again is likely to fail the same way` | (from a wake of a sandbox left `unhealthy`, never from `create`) **not transient** (no `retryAfter`): usually a damaged filesystem on the volume, not the template. Do not retry in a loop. `s5x logs <ref> --proc console` shows the mount error. A backup taken before it broke puts the volume back as it was then (`volume restore <backup-id> <name> --replace`), but that discards everything written since, so ask the user first. Otherwise tell the user, with the request id the error ends with, to contact s5x support |
| 422 | `mounting rw0 at /data: … can't read superblock` (`"code": "volume_mount_failed"`, `"drive"` under `--json`) | the sandbox's guest would not mount that volume, in the kernel's words: **not transient**, usually a damaged filesystem. From `volume attach`: nothing was attached. From `sandbox create`: nothing was created, but a volume it made stays, empty. From `sandbox recover` or `volume detach --force restart`: the sandbox stays `dead`; `volume detach <ref> <path> --force restart` of the drive named recovers it without that volume. Restore a backup of the volume (`volume restore <backup-id> <name> --replace`, ask first) or tell the user |
| 503 | `the sandbox was created and booted, but never became ready; call it again, which checks once more` (from `create`), `the sandbox came up but never became ready` (a wake) | s5x's own agent in the guest never answered its readiness check. It is left `unhealthy` with its VM up. Call it once more (`s5x sandbox exec <ref> true`), which checks it again. From `create` the sandbox **was created**: do not run `create` again (the name is taken). If it still fails, read `s5x logs <ref> --proc console`. A sandbox you just created and put nothing on can go with `s5x sandbox rm <ref>`; do not remove one that already held data — tell the user. If the image's own entrypoint runs the app, see the note below the table |
| 503 | `the sandbox's host has no room to wake it right now; retry shortly` (under `--json`, `"code": "waking_no_capacity"`) | from any call that wakes it, or `recover`: what is awake on its host fills its memory, and putting the host's idle sandboxes to sleep first did not free enough -- the rest are in use. Nothing ran: retry after `retryAfter` (5 s) |
| 503 | `this sandbox stopped unexpectedly, and its try to come back on its own disk did not come up; call it again to try once more`, or `… booted on its own disk, but never became ready; call it again to try once more …` | its VM died awake and s5x is bringing it back; that try failed, and the next call tries again. If it keeps failing, read `s5x logs <ref> --proc console` |
| 503 | `your sandbox's VM had stopped; it is back on its own disk and nothing was written: send the file again` (from `cp`) | its VM had stopped while it was awake (its machine restarted, say), and this copy brought it back on the same disk; the file was not written. Run the copy again. Only the entrypoint came back: start `proc run` processes again |
| 503 | `your sandbox's VM is not running on its host; nothing was sent to it. Call it again` | nothing ran: call it again, which brings it back on its own disk |
| 503 | `sandbox <ref> booted on its own filesystem but never became ready …` (or `… but did not take its environment, so its host stopped it`) | from `recover`. The sandbox stays `dead` and its disk is untouched: run `s5x sandbox recover <ref>` again, not `rm`. If it keeps failing, read `s5x logs <ref> --proc console` |
| 503 | `no host currently has capacity for a sandbox of this size; nothing was created. Retry shortly` or `no host currently has room to start a sandbox of this size; nothing was created. Retry shortly` (under `--json`, `"code": "no_capacity"`), from `create`; `no host has room for this backup's volume right now; try again later` (the same code), from `volume restore`; `<ref>'s machine has no room for a new volume right now …`, from `volume attach --create`; `the snapshot's machine has no room for a new volume right now …`, from `volume fork` | no host the sandbox may run on can take it now: its disk is spoken for by what its sandboxes and volumes may write, or what is awake there fills its memory even once its idle sandboxes are put to sleep. Nothing was created: retry after `retryAfter` (5 s; 60 for a volume). A `create --create` that would have made a volume keeps nothing when it fails, so its retry can go anywhere; one that named a volume that already existed runs only where that volume is, and its retry clears only when there is room there |
| 404 | `open /data/x: no such file or directory` (under `--json`, `"code": "file_not_found"`), from `cp`; `no such process` (`"code": "process_not_found"`), from `proc` | the path or the process is not in the sandbox; a 404 about the sandbox itself has no code (`s5x sandbox ls`). A process ends with its sandbox's switch to another build, a `recover`, or a restore of a snapshot or backup taken before it started: start it again |
| 400 / 409 / 507 | `is a directory`, `/data/x: not a directory`, `/data/x: no space left on device`, from `cp` | the sandbox's own answer about its filesystem: a path of the wrong kind (copy to or from a file, not a directory), or a full disk (507: free space in the sandbox, or keep data on a volume, which grows as it fills) |
| 502 / 503 / 504 | `the sandbox is taking too long to wake`, `your sandbox is being restored; try again in a few seconds` (a restore is replacing it), `too many builds are already running` | transient: retry with a short backoff. Under `--json` the error carries `retryAfter`, the seconds to wait; otherwise wait a few seconds, or about 30 after `too many builds`, which also lists that build as failed, so run the build again. The `the sandbox came up but …` errors have their own rows |
| 500 | `secrets are unavailable because of a fault on s5x's side, so nothing was read or stored. Contact s5x support` (from `env set`, `vault`, `network header set`, or a create that sets them) | nothing changed, and a retry fails the same way: contact s5x support |
| 500 | `this value cannot be read because of a fault on s5x's side. Contact s5x support` (from `vault get`) | the value is stored but cannot be read, and a retry does not change that: contact s5x support |
| 500 | `template "<name>" cannot be started because of a fault on s5x's side. Contact s5x support` (from `create`, or a wake) | nothing was started, and a retry fails the same way: contact s5x support |
| 524 | `no answer within about 100 s, so the connection was closed (524). The operation may still be running: check its result before you retry.` | a long call (a slow create) outlasted the connection, not the work. Check its result first — `snapshot ls`, `sandbox ls` — then retry only if it did not happen |
| 503 | from a **preview or endpoint URL**, not the CLI: `x-s5x-refused: port_closed`, `nothing accepted a connection on port <p> within 10 s …` | the request waited 10 s for the app to accept on that port and was never delivered; for the next 5 s requests to that port get the same 503 at once, and past 64 waiting at once the rest do too. Check the app is running (`s5x logs <ref> --proc app` shows why it stopped), that it listens on the port the URL names (`s5x endpoint ls`, `s5x sandbox preview ls <ref>`), and that it binds `0.0.0.0`, not `127.0.0.1` or `::1`. An app that takes longer than 10 s to start: call the URL again once it is up |
| 503 | from a preview or endpoint URL: `x-s5x-refused: port_closed`, `the app on port <p> stopped accepting connections before this request reached it …` | the app crashed or restarted as the request was sent, often on the previous request. It was not delivered, so sending it again is safe: retry after the `Retry-After` second. If it keeps happening: `s5x logs <ref> --proc app` |
| 503 | from a preview or endpoint URL: `x-s5x-refused: not_resent`, `… the app stopped accepting connections before this request reached it … send it again` | an upload (a body over 64 KB, or with no declared length) that the app refused in the moment between its wait for the port and its sending -- a crash, and pid 1 restarts the app 2 s later. It was not delivered, so sending it again is safe: retry after the `Retry-After` second. If it keeps happening, the app is crashing: `s5x logs <ref> --proc app` |
| 503 | from a preview or endpoint URL: `x-s5x-refused: creating`, `deleting`, `dead` or `not_running` | the sandbox is still being created, is being deleted, is dead, or is not running for another reason (it failed to start, or was deleted a moment ago). `s5x sandbox ls` shows its state; a `dead` one comes back with `s5x sandbox recover <ref>` |
| 503 | from a preview or endpoint URL: `x-s5x-refused: wake_failed`, `this sandbox is asleep and could not be woken just now …` | transient: retry after the `Retry-After` seconds |
| 503 | from a preview or endpoint URL: `x-s5x-refused: waking_no_capacity`, `this sandbox is asleep and its host has no room to wake it just now …` | nothing was delivered; retry after the `Retry-After` seconds |
| 503 | from an endpoint URL: `x-s5x-refused: moved`, `this endpoint now points at another sandbox …` | it was pointed at another sandbox a moment ago; nothing was delivered, so send it again |
| 502 | from a preview or endpoint URL: `x-s5x-refused: no_response`, `the app accepted this request and closed the connection without answering …` | the app took the request and crashed or hung up, or did not answer within an hour. It was **not** sent again, because the app may have acted on it: check before sending it again. `s5x logs <ref> --proc app` |
| 502 | from a preview or endpoint URL: `x-s5x-refused: unavailable`, `… could not route this request just now …` | s5x's side, transient: retry after the `Retry-After` seconds |
| 403 | from a preview or endpoint URL: `x-s5x-refused: suspended`, `this sandbox or its account is suspended by s5x …` | nothing was delivered, and nothing will be until s5x lifts the suspension; the account's own calls say why |
| 409 | from an endpoint URL: `x-s5x-refused: detached`, `this address has no sandbox behind it right now. …` | the sandbox it pointed at was deleted. Aim it at another: `s5x endpoint point <name> <ref>` (in force within about 5 s) |
| 404 | from a URL: `x-s5x-refused: not_found`, `no preview or endpoint has this address. …` | the preview was revoked, or its sandbox was deleted, or the endpoint was removed. `s5x sandbox preview ls <ref>` and `s5x endpoint ls` list what exists |
| 410 | from a preview URL: `x-s5x-refused: expired`, `this preview has expired` | mint a new one with `s5x sandbox preview create <ref> <port>` |
| 401 | from a URL: `x-s5x-refused: token_invalid`, `this address needs its token: …` | open the full link `preview create` or `endpoint create` printed (`?_s5x_token=…`), or send the token as `x-s5x-token` or `Authorization: Bearer`. A Bearer that is not an s5x token (`pv_…`, `ep_…`) is the app's own and does not count |
| 502 / 503 | from a preview or endpoint URL, **without** an `x-s5x-refused` header, with your app's own body | passed through from your app unchanged (not the edge's HTML gateway page in the next row): read the app's logs, `s5x logs <ref> --proc app` |
| 502 / none | a gateway page (`502 <html>…`), `Unable to connect. Is the computer able to access the url?` (refused), `The socket connection was closed unexpectedly…` (dropped) | not s5x's own answer; exit 1. On a call that changes something (`exec`, `create`, a copy), check whether it went through before calling again; otherwise retry with a backoff |

**If the image's own entrypoint runs the app**, the app starts only once the
sandbox has its env and its volumes. After a `did not take its environment`,
`clock could not be set` or `never became ready` 503 it has not started yet,
and the retry that delivers them starts it.

Most **409s are not transient** in s5x: the request conflicts with the current
state, and repeating it unchanged gets the same answer, so change something
first. A few are different — each describes a sandbox partway through a change,
and the same call succeeds once it has finished:
`this sandbox is still being created`,
`the sandbox is waking or being suspended; try again in a moment` and
`… could not be woken` (all three carry `retryAfter` under `--json`).
Retry those after a few seconds, a few times; keep retrying
`still being created` for up to two minutes, since a boot that must first
fetch its build takes that long. If `could not be woken` keeps coming back, the
sandbox fails every wake: `s5x logs <ref> --proc console`.
`the sandbox is busy` clears too, but only when the keep-alive work ends.

Every API call has a request id. When one fails with a server error (5xx),
the message ends with it, `(request id …)`, and under `--json` every failed
request carries it as `requestId`. For an older failure, the call's log record
holds it as `reqId`, which only `--json` shows:

```bash
s5x --json logs <ref> --source access --level warn --since 1h | jq '.lines[] | {at, route, status, reqId}'
```

`--source access` keeps only API calls. Without it, lifecycle records match
the level too, and they have no `route`, `status` or `reqId`. `--level warn`
keeps refused (4xx) and failed (5xx) calls, deaths, and the cold boots,
recoveries and promotions that restarted the process tree; `--level error`
keeps only failed (5xx) calls and deaths. A call that never resolved to a
sandbox — a template call, or a name that does not exist — is logged only in
`s5x logs` with no sandbox named, and a rejected key leaves no record. Quote
the id when you report a problem to s5x support.

## Failures with no error

These produce no error message, which is why they are worth knowing.

**A background job stopped making progress.** It was frozen when the sandbox
went to sleep: it went quiet longer than `--idle` (a timer, a `sleep`, a wait
for an answer over 5 minutes), which s5x cannot tell from done. Nothing will
wake it on its own. Touch the sandbox (`s5x sandbox exec <ref> true`) to resume
it where it stopped, and start such jobs with `--keep-alive` next time. A
`--keep-alive` job can be frozen this way too, under memory pressure, until
s5x wakes the sandbox again once its host has room.
`s5x logs <ref> --source system` shows each `slept` with what the sandbox last
did (`last`).

**Processes restarted at a wake, with no death.** The wake found the sandbox's
machine holding other volumes than s5x records for it, so it was booted fresh
on its own disks with the volumes s5x records, and nothing written was lost
(`s5x logs <ref> --source system`: `drives_reconciled`). Only the entrypoint
came back: start `proc run` processes again.

**A server dies after exactly ten minutes.** `proc run` defaults to
`--timeout 600`. Restart it with `--timeout 0`.

**`sandbox exec` exits 124.** The command was still running at its
`--timeout` (default 30 s) and was killed. Its output up to then is printed,
then one line on stderr, so stdout stays the command's:
`the command did not finish within its <N>s time limit and was killed (exit 124)…`.
Under `--json` that line is not printed; `timedOut` is `true` instead. It is
not transient: the same command hits the same limit again. Raise `--timeout`
(seconds, at most 60), or run it with `sandbox proc run` and follow its logs.
A command that exits 124 by itself gets no such line, and under `--json` its
`timedOut` is `false`. Under `proc run`, s5x's limit is status `timeout`
(exit 124); a process that exits 124 by itself is `failed`.

**A new env var is not visible to the app.** `env set` saves the value, and
the sandbox takes it at its next boot or wake, not before. On an awake
sandbox, a process you restart (or an `exec`) still gets the old set.

- **Started with `proc run`:** restart it with the value passed on the
  restart. After the sandbox has slept and woken, a plain restart also picks
  it up. Wait for the old process to end first, since its name is refused
  while it runs; `proc kill` sends SIGTERM, so escalate to `-9` (`--force`)
  if it has not ended after about 10 s:

  ```bash
  s5x sandbox proc kill <ref> <name>               # SIGTERM
  running() { s5x --json sandbox proc ls <ref> | jq -e 'any(.[]; .name=="<name>" and .status=="running")' >/dev/null; }
  for i in $(seq 10); do running || break; sleep 1; done
  if running; then s5x sandbox proc kill <ref> <name> -9; while running; do sleep 1; done; fi
  s5x sandbox proc run <ref> "<cmd>" --name <name> --timeout 0 --env NAME="$NAME"
  ```

  Repeat the flags it was started with: `--timeout 0` for a server (the
  default 600 s kills it in ten minutes), `--cwd`, and `--keep-alive` if it
  had it.
- **The image's entrypoint (`app`):** `proc kill app` is refused, and
  `s5x sandbox proc restart <ref> app` restarts it: s5x ends it and what it
  started, and starts it again 2 s later, with the env of the sandbox's last
  boot or wake. So it takes the new env only when it starts again after the
  next boot or wake: a `proc restart` then (ask the user first; the app loses
  its in-memory state and any request in flight), an exit of its own, or
  `s5x sandbox promote <ref> <another build> --now`. A `proc restart` before
  that wake starts it with the old env again, and a process the entrypoint
  left running in the background, re-parented to PID 1, outlives a restart. The
  other build must be a
  finished build of the same template, of any size (the sandbox keeps its own); a rebuild of the same image counts, named by its digest or `tpl_` id.
  Promoting to the build it already runs restarts nothing. A promote `--now`
  restarts every process: `proc run` processes do not come back, and anything
  written outside its volumes is lost. Ask the user first. If the value will
  change again, run the app with `proc run` instead.

For an API key the app already reads and sends as an HTTPS header, a header
rule (`s5x sandbox network header set`) replaces the value on each connection
the app opens from then on, with no restart. It is in force at once, or within
about 20 s when the reply says `saved; in force within about 20 s`
(`"pending": true` under `--json`). A connection the app opened to that host
before the sandbox's first rule (on a sandbox with no allowlist) keeps sending
the old value until it closes;
see "Moving a key out of env on a sandbox that already exists" in
workflows.md.

**Writes to a volume fail with `No space left on device`.** A volume grows on
its own as it fills, so this is one of its limits: it reached the most it
grows to (`s5x volume info <name>`: its filesystem at that limit), your
account's volumes and snapshots reached its cap (a new volume is then refused
with `volume_cap`), or its machine has no room to grow it just now:
`s5x logs <ref> --source system` says which, as `volume_growth_refused` with
the volume and `reason` `limit`, `tenant_cap` or `host_full`, at most once a
volume an hour. It stays writable: delete what it no longer needs, or snapshots and volumes you do not
(`volume snapshot ls`, `volume ls`), and writing works again; at the cap, ask
s5x support to raise it. Growing it yourself is no way out: `resize2fs` on a
mounted volume fails with `Resource busy` and changes nothing. A writer faster
than it grows, or one reserving more than half of it at once (`fallocate`),
can meet this for a moment before the next step lands: retry the write.

**Writes to a volume fail with I/O errors.** `dmesg` shows `Buffer I/O error`,
and ext4 may turn the volume read-only; what failed to write was not saved.
Stop writing to it and tell the user. Either its machine's disk filled: s5x's
fault, not the user's, and s5x is alerted, so contact s5x support. Or the
volume was unmounted and resized from inside the sandbox (`resize2fs`, which
fails with `Resource busy` only while it is mounted), past what s5x gave it:
its own doing. A backup taken before the resize puts it back as it was then
(`volume restore <backup-id> <name> --replace`), but discards everything
written since, so ask first. A full volume nobody resized gives `No space
left on device`, never this.

**Data vanished after replacing a sandbox or switching its build.** It was
written outside its volumes, or the sandbox never had one. Only a volume's
path survives `sandbox rm` or a switch to another build. After a switch, a
snapshot or backup taken before it still has the data — restoring it puts the
old build back too. After `sandbox rm`, the snapshots are gone and the
backups can no longer be restored onto anything. For next time, give it a
volume (`--volume <name> --create` at create, or `volume attach`) and keep
data under its path.

**Commands start in `/`, not the image's `WORKDIR`.** A volume mounted over
it (`/data` over a `WORKDIR` of `/data/app`) hides it until the volume holds
that directory: make it there (`s5x sandbox exec dev "mkdir -p /data/app"`).

**`volume detach` says `volume_busy`, a shell or command holding it by `cwd`.**
The image's `WORKDIR` is on that volume, so every `exec`, shell and scheduled
command starts in it and holds the volume until it ends: close or wait them out.

**A template build failed.** `template build` and `push` exit 1 with why, and
`s5x template show <name>` prints it on a line under the table (`.error` under
`--json`), usually as the step that failed and
the message of the tool that ran it (`pulling <image>: …`,
`preparing the root filesystem: …`). Some reasons are about the image: an
archive tagged as another image, a registry that refused the pull, the guest
console of a guest that never answered its readiness check (see the readiness
entry below). Fix those and build again. These reasons are s5x's side, so
build again unchanged:
`refused before it started: too many builds are already running; try again shortly`
(the same 503 `build`/`push` printed; wait about 30 seconds first),
`no build host is available right now; try again shortly`,
`… build slots are busy; retry shortly`,
`the build could not run on its build host -- a fault on s5x's side, not in the image; try again`,
`the build could not be stored -- a fault on s5x's side, not in the image; try again`,
`the build was interrupted on s5x's side; build it again` (s5x stopped running it on its side, and failed it past the 30 minutes a build may take),
and `the build did not finish within 30 minutes`.
A failed build is deleted a day after it started (EXPIRES in `template show`).

**A template build fails its readiness check.** The build boots the image once
and waits for s5x's own agent in it to answer. That does not depend on the
image's shell or on the app: an image with no /bin/sh builds, and a crashing
entrypoint does not fail it. `s5x template show <name>` prints why the build
failed, and for a readiness failure that ends with the last lines of the guest
console.

**`template push` refuses the image as `linux/arm64`.** Rebuild with
`docker build --platform linux/amd64`.

**`template push` refuses an image over 5 GiB** (`<image> is N compressed;
push takes at most 5 GiB`). Push it to a registry s5x can pull from, then
`s5x template build <registry-ref> --name <name>`.

**`app` restarts every 2 s, and its log fills with
`--- s5x: entrypoint exited rc=N, restarting ---`.** The image's `CMD` exits:
a runtime image's default command (a REPL, a shell or a usage message) ends at
once without a terminal. `proc ls` still shows `app` `running`, so read
`s5x logs <ref> --proc app`. Build the image with a `CMD` that starts the app
and keeps running, or, if you start the app with `proc run`, one that just
stays up: `CMD ["tail", "-f", "/dev/null"]`.

**`s5x logs <ref>` shows nothing.** Check the filters first — `--level`,
`--grep` and `--since` together exclude a lot. `s5x logs sandboxes` lists
everything that has logs at all, and records are kept for 30 days
(`s5x --json logs stats | jq .retentionDays`). A bare `s5x logs stats` counts
only the last 24 hours (`counted since …; pass --since for longer`). Without
`--source`, `s5x logs` shows records
(API calls, audit, lifecycle); a process's output needs `--proc app` for the
entrypoint or `--proc <name>` for one started with `proc run`.

**A promote did not change a sandbox.** Promotion switches a sandbox at its
*next wake*, and an awake one stays as it is until it sleeps. `s5x sandbox ls`
shows `name@<old> → <new>` while it is pending. To switch one now:
`s5x sandbox promote <ref> <build> --now`. A wake that cannot fetch the promoted build resumes the old one
and tries again at the next wake. Nothing in `s5x logs` says so. `s5x sandbox ls` still shows
`name@<old> → <new>`, and `s5x logs <ref> --source system` shows a `promoted`
event once it does switch.

**After a switch, the app is not running.** The process was started with
`sandbox proc run`, and only the image's entrypoint restarts on its own after a
switch. Start it again, or make it the image's entrypoint.

**`exec` gets `Permission denied` in an image that declares `USER`.** Commands
run as that user, like the entrypoint and like `docker exec`, not as root.
They start in the image's `WORKDIR`, like `docker exec`; with no `WORKDIR`, or
one that is missing at run time, they start in `/`. That user cannot write `/`,
nor a `WORKDIR` the Dockerfile made before `USER`, so a relative path fails
there too: `cd` first into a directory the user owns, such as a volume's path
(`"cd /data && npm install"`). `proc run` takes `--cwd`; `exec` doesn't, so
use `cd /path && …`. A file the Dockerfile `COPY`'d without `--chown`
belongs to root, and so does a directory made before `USER`, so neither the
app nor `exec` can change it. Fix the image with `COPY --chown=<user>`, or a
`chown` before `USER`. To replace one such file now, `sandbox cp` it in — the
file API writes with root's reach — but the file stays root's and arrives with
mode 0644, so do not replace a script that must stay executable this way. No
flag runs a command as root; an image that needs root declares no `USER`.

**A script copied in with `sandbox cp` fails with `Permission denied`.** Every
upload lands at mode 0644, even one that replaces an executable. Run it
through its interpreter (`s5x sandbox exec <ref> "sh /data/job.sh"`), or
`chmod +x` it with `exec` if the image's user owns it.

**A job started with `exec` or `proc run` died with no error of its own.** The
guest ran out of memory. The kernel kills an `exec` command or a `shell` first,
so a runaway command goes before the app. A `proc run` process ranks level with
the image's entrypoint, and between those the kernel kills the larger one.
s5x's own agent goes last. `s5x logs <ref> --proc console` shows the kill. Run
a smaller job, or fewer at once, or give the sandbox more memory in place:
`s5x sandbox set <ref> --mem <MB>` keeps everything and applies at its next
wake after a sleep, or at once with `--now`; either way its processes restart,
so ask the user first. Nothing restarts a `proc run` process that was killed,
so start it again.

**A call to an API with a header rule gets 401.** The request went out
without the rule's value. It went over plain HTTP (never given it), to a port
other than 443, or to a name other than the rule's exact host
(`anthropic.com` is not `api.anthropic.com`). Or the client puts its key in a
different header than the one the rule sets, so the placeholder went out. Or
the value, sent exactly as set, lacks its scheme (`Authorization` needs
`Bearer …`). Or the change said `saved; in force within about 20 s`
(`"pending": true` under `--json`; the human line prints only when stdout is
a terminal) and is not in force yet. Or, on a
sandbox with no allowlist, the app opened its connection to that host before
the sandbox's first rule, and it skips the rule until it closes — restart the
app (an entrypoint `app` with `s5x sandbox proc restart <ref> app`, which loses
what it holds in memory, so ask the user first; otherwise the connection ends
when it goes idle).
`s5x sandbox network ls <ref>` lists the rules by host and header name. A value
can never be read back, so to fix one, set it again with
`sandbox network header set`.

**A certificate error, but only to the rule's host.** The client does not
trust the certificate the proxy presents for that host. Most clients trust it
through the image's CA bundle, and s5x sets `NODE_EXTRA_CA_CERTS`,
`SSL_CERT_FILE` and `REQUESTS_CA_BUNDLE` for Node, Bun and Python. It still
fails for a Java client (the JVM reads only its own keystore), for a binary
that ships its own roots, and where the image's `ENV` or the sandbox's own env
(`sandbox env set`, `create --env`, `proc run --env`) points one of those
variables at a file without the proxy's CA, because that value wins over
s5x's. Drop that
variable from the image, or remove it with `s5x sandbox env rm <ref> <name>`.
Like any env change, the removal reaches processes started after the
sandbox's next boot or wake. Otherwise, point the client at the system bundle,
or remove the rule and give that client its key as env. An HTTP/2-only client
(gRPC) fails on a rule's host whatever it trusts, because the proxy speaks
only HTTP/1.1 to the sandbox: remove the rule and give that client its key as
env.

An `access denied` TLS alert (`tlsv1 alert access denied`,
`TLSV1_ALERT_ACCESS_DENIED`) from a host with no rule is not a certificate
problem: the sandbox's allowlist refused that host (next entry).

**Under an allowlist, a host cannot be reached.** HTTPS to a name not on the
list, or to a bare IP address, gets a TLS `access_denied` alert during the
handshake: curl and OpenSSL report `tlsv1 alert access denied`, Bun
`TLSV1_ALERT_ACCESS_DENIED`, Node `alert access denied`. Plain HTTP gets 403
`s5x: this sandbox's network policy does not permit this host`. Every port but
80 and 443 is refused (`Connection refused`) whatever the list says, and DNS
reaches only the sandbox's own resolver, so a client that uses its own DNS
server resolves nothing (lookups of any name still go out through that
resolver). A host with a header rule is always reachable.
`s5x sandbox network allow <ref> <hosts>` **replaces** the list, so pass all of
it: the hosts `network ls` shows, the new exact name, and every host a
redirect lands on. A database, SSH, or SMTP submission on 587 or 465 is
reachable only with the allowlist lifted
(`s5x sandbox network allow <ref> --all`). Port 25 is never reachable (next
entry).

**Sending mail fails with `Connection refused` on port 25.** No sandbox can
open port 25, with or without an allowlist: sandboxes leave from shared public
addresses, and mail delivered straight to recipients' servers from one would
get the address blocklisted. Nothing in
the sandbox can change this. Send through a provider: its HTTPS API, or SMTP
submission on 587 (STARTTLS) or 465 (TLS) with the account's credentials.
Both are open unless an allowlist is set; with one, an HTTPS API needs its
host listed, and 587 or 465 needs the allowlist lifted.

**`Connection refused` to a host that is up, after many connections.** A
sandbox holds at most 2,048 connections open at once, and past that a new
one is refused at once, because waiting frees nothing. Close connections you
are done with, and bound a pool or a crawler's concurrency below it.

**`ECONNRESET` on new HTTP(S) connections, under load, with a header rule or
an allowlist.** Then ports 80 and 443 go through the sandbox's proxy, which
holds at most 256 connections open at once, for both ports together. Past
that a new one is reset at once. Reuse connections, and keep a pool's size
below 256.

**New connections take a second or more, under load or at start-up.** A
sandbox opens at most 50 new connections a second, in bursts of up to 200.
Every TCP connect, UDP flow (so each DNS lookup) and ping counts, and a
connection already open does not. Past the cap, a new connection is
dropped, and TCP retries it a second later, so a burst shows up as slow
connects, and a DNS lookup as a pause of a few seconds, rather than
errors. Nothing lifts it. Reuse connections (HTTP keep-alive, a connection
pool), cache DNS lookups, and pace anything that fans out: a crawler, a
load test, a job that opens one connection per item.

**Open connections drop right after a network change.** Once a sandbox has a
header rule or an allowlist, setting or removing a rule or changing the
allowlist restarts its egress proxy, which cuts every connection open through
it (ports 80 and 443). A new allowlist cuts every connection the sandbox has
open to the outside, on any port, even on a sandbox that had no rule before.
A request in flight fails with a reset connection; retry it, and change rules
between requests. The first rule on a sandbox with no allowlist cuts nothing:
a connection already open to its host goes on without the rule until it
closes (see "A call to an API with a header rule gets 401").

**`s5x: the upstream could not be reached: <why>` (502) from inside the
sandbox.** The proxy could not reach the real host by its public DNS name, or,
for a rule host, the host's certificate is not publicly trusted; `<why>` says
which: `dns: no such host`, `dial: connection refused`, `timeout`, `tls: the
certificate is not from a publicly trusted authority`, and so on. A rule
cannot be used with an internal or self-signed host.

## Where to look

| Question | Command | Wakes the sandbox? |
|---|---|---|
| why a template build failed | `s5x template show <name>` — a line under the table per failed build, the step that failed and why (`.error` under `--json`) | no |
| what calls were refused or failed, and when | `s5x logs <ref> --level warn --since 2h` | no |
| sleeps, wakes, deaths, recoveries, unhealthy wakes, deletions (with why) | `s5x logs <ref> --source system`; without `<ref>`, every sandbox's | no |
| what the app printed | `s5x logs <ref> --proc app` | no |
| kernel panics, OOM kills, boot failures | `s5x logs <ref> --proc console` | no |
| live output of one process | `s5x sandbox proc logs <ref> <name> --follow` | **yes** |
| what `proc run` started, and when | `s5x logs <ref> --source audit --grep process_start` — its name, its program and how many arguments followed it, never the command line | no |
| what `exec` ran, and when | `s5x logs <ref> --source audit --grep process_exec` — the program and how many arguments followed it, never the command line | no |
| CPU, memory, request counts | `s5x sandbox stats <ref>` | no |
| a sandbox's header rules (names, never values) and allowlist | `s5x sandbox network ls <ref>` | no |
| the request id of a failed call | `s5x --json logs <ref> --source access --level warn` — the `reqId` field | no |
| a sandbox that no longer exists | `s5x logs sandboxes <name> --deleted`, then `s5x logs <id>` with the value from its `id` column. A name that a newer sandbox has taken reads the newer one | no |
