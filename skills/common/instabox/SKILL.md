---
name: instabox
description: Use when the user wants a cloud Linux box (instabox sandbox) from the terminal with the `instabox` CLI — create one, SSH in, run a command in it, read its files, set its timeout, or delete it. For saving or restoring a box's disks, see instabox-snapshots.
metadata:
  installed-by: instabox
---

# instabox CLI

An instabox sandbox is a Linux VM (Debian, user `dev`, sudo). It has a root disk and a persistent `/data` disk; HOME is `/data/home`. Boxes are private to the signed-in account.

## Sign in

```sh
instabox whoami              # who is signed in (fails if nobody)
instabox login               # confirm the browser's account, or choose GitHub / Google
```

A GitHub sign-in and a Google sign-in are separate accounts with separate boxes. Both `instabox login` and `npx instabox@latest` open account confirmation in the browser: use its current Instabox account or choose another. To go directly to a provider, use `instabox login --provider github|google`, or `npx instabox@latest --github|--google`. The CLI shares the sign-in `npx` made. Device-code sign-in (`--device`) uses GitHub.

For CI or an agent without a browser, use an API key instead: `export INSTABOX_API_KEY=ibk_...` (the user creates it on the dashboard's API Keys page). Never print, commit or log a key.

## Templates

`universal` is the default, so `create` needs no `--template` for ordinary work. It is Debian with git, gh, Node.js 22, Python (uv), Go, Rust, a C toolchain, Docker, Claude Code and Codex; a desktop (VNC, Chromium) installs itself the first time it is used. Pick another template only for its one purpose:

- `agent-browser`: universal with the desktop already installed, for browsing or driving a GUI from the start.
- `herdr`: for the herdr client.
- `orca`: for Orca desktop and mobile.

`instabox templates` lists the ones this server offers.

## Everyday commands

```sh
instabox templates                              # base systems to start from
instabox create --name work                     # new box; waits until it is running
instabox ls                                     # your boxes and their states
instabox ssh work                               # interactive shell (leave with: exit)
instabox exec work -- uname -a                  # one command, no SSH client needed
instabox exec work --cwd /data/home -- ls -la   # exec runs `bash -lc` as dev
instabox files work /data/home                  # list a directory (or print a text file)
instabox auto-suspend work 10m                  # pause after 10 idle minutes (default 30m; 0: never)
instabox timeout work 2h --on-timeout pause     # pause (keeps memory) or kill at the deadline
instabox stop work && instabox start work       # stop ends processes, keeps disks
instabox suspend work && instabox resume work   # pause/resume keeps running processes
instabox rm work                                # delete the box
```

- Names or IDs (`m_...`) both work wherever `<id-or-name>` is accepted.
- `create` options: `--template T` or `--snapshot S`, `--auto-suspend D|0`, `--timeout D [--on-timeout pause|kill]`, `--meta K=V`, `--no-vault`, `--no-wait`. Every box is the same size (`instabox usage` shows it); there are no size flags.
- A new box pauses itself after 30 idle minutes (no agent working, no terminal use, little CPU) and wakes on the next `exec`, `ssh` or `files`; a paused box keeps its memory and processes. `--auto-suspend 0` keeps a box always on (a server that must keep answering); `--auto-suspend 2h` changes the idle time.
- Use `exec` to run a command and read its output, and `ssh` for an interactive shell.
- `exec` returns the command's exit code and takes `--stdin` to pipe input. It stops the command after `--timeout` seconds: 60 by default, 600 at most. Run anything longer (installs, builds, test suites) over SSH, which has no time limit and also returns the exit code: `instabox ssh work -- 'cd /data/workspace/app && npm ci'`.
- The box's HOME has `MACHINE.md` (which box it is, its size, what survives a stop, the installed tools) and `AGENTS.md`. Both are worth reading before working in the box; they appear a moment after it starts.
- A public URL for a web server in the box: `instabox port publish work 3000` prints it (`instabox port ls`, `instabox port unpublish work 3000`). The URL works while the box runs.

## Vault: the user's secrets in every box

The user's Vault holds their secrets (API keys for model providers, a `.env`, a service-account file) on the server and writes them into every box of theirs when it boots or resumes: `env` items as environment variables of every login shell (so of `instabox exec` too), `file` items as files under HOME.

```sh
instabox vault show work                 # what the box gets (names, never values) and the last write
instabox vault push work                 # write the current items into a running box now
instabox vault set ANTHROPIC_API_KEY     # value from stdin, or prompted without echo (sign-in only)
instabox vault set-file .config/svc.json --from ./svc.json
instabox vault ls; instabox vault rm NAME
instabox create --name tenant --no-vault # a box for someone else: never gets the user's items
```

- Before asking the user for a credential, check names with `instabox vault show <box>`. Inside the box, use silent presence checks: `test "${NAME+x}" = x` for an environment variable (replace `NAME` with its name), or `test -f "$HOME/.config/svc.json"` for a credential file. Exit status 0 means present, 1 means absent. Never print credential values or read credential-file contents into agent output, chat or logs.
- A changed item reaches the box at its next boot or resume, or at once with `vault push` (a changed `env` item reaches new shells only).
- A box made for another person or tenant must be created with `--no-vault` (`vault: false` in the API): anything running in it can read what the Vault writes. This is for good; `instabox start|resume <box> --no-vault` does the same to an existing box.
- An item's selector (`--selector K=V`) limits it to boxes whose metadata has those labels: create the box with the `--meta` the user's items expect.
- Managing items needs a sign-in; an API key cannot read, create or change them. Never ask for a secret's value to put it somewhere else.

## Moving work onto a box

To move the repo the user is working in (with its worktrees, uncommitted work and agent conversations) onto a new box and install its dependencies there, follow the `instabox-move-repo` skill.

## Habits

- Forgotten boxes pause themselves. Give a box a `--timeout` when it must stop at a deadline, or `--timeout D --on-timeout kill` when it should be deleted then.
- When the user asks for a new box, create one, with a name `instabox ls` does not already show. Offer an existing box only when they want to continue earlier work in it.
- `instabox usage` shows storage use and limits. A quota error means delete or stop something; do not retry the same create in a loop.
