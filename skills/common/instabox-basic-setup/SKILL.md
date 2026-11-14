---
name: instabox-basic-setup
description: Use when the user wants their instabox boxes set up like their laptop — "put my tokens / dotfiles / git config into instabox", "set up my boxes like my laptop", "give every box my GitHub and Claude tokens", "move my setup to instabox", "move everything to instabox". Scans this machine, lets the user pick from a checkbox plan, then puts the picks into their instabox Vault, so every box (and every box created later) gets them: tokens (GH_TOKEN, CLAUDE_CODE_OAUTH_TOKEN, model and service API keys) as environment variables, and git and editor config (~/.gitconfig, global gitignore, ~/.vimrc, nvim, ~/.tmux.conf) as files. Moves no code: for a repo, use instabox-move-repo.
metadata:
  installed-by: instabox
---

# Put a basic setup into the instabox Vault

This skill puts the user's personal setup into their instabox **Vault** (`instabox vault`: per-user secrets and files, written into their boxes), so every box of theirs starts with it: the ones running now (at their next start or resume, or at once with `instabox vault push <box>`) and every box created later. It copies no repository, no agent history, installs nothing and touches no box directly. To move a repository, use the `instabox-move-repo` skill. See the `instabox` skill for the CLI.

What it moves, and nothing else:

| Group | Becomes | From |
| --- | --- | --- |
| Tokens | Vault `env` items: on tmpfs in the box, set in every login shell; gone at a stop, back at the next start; never in a snapshot | `GH_TOKEN` from `gh auth token`; well-known model and service tokens exported in the shell files (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `HF_TOKEN`, `NPM_TOKEN`, `VERCEL_TOKEN`, `CLOUDFLARE_API_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `FLY_API_TOKEN`, `SENTRY_AUTH_TOKEN`, `LINEAR_API_KEY`, ...) or in this shell's environment. Other credential-looking exports are listed unchecked. |
| Git | Vault `file` items in the box's home | `~/.gitconfig` (and `~/.config/git/config`), the global gitignore |
| Editor and terminal | Vault `file` items | `~/.vimrc`, nvim's `init.lua` / `init.vim` and the `.lua` / `.vim` files around it (no plugin checkouts), `~/.tmux.conf` |

Four scripts in `scripts/` next to this file do the parts that must be exact (Node 18+, nothing to install):

| Script | Does |
| --- | --- |
| `scan.mjs` | Read-only inventory, as JSON: tokens by name and place (never values), the files, and what cannot move. |
| `plan.mjs` | `write`: the checkbox plan. `parse`: reads the edited plan back, strictly, as JSON. |
| `push.mjs` | Puts the picks into the Vault, piping each value from its source into `instabox vault set` / `set-file`. `--dry-run` first. |
| `content.mjs` | What a file becomes in the Vault (used by the other two). |

**Never read, print or paste a credential value yourself**: not `gh auth token`, not `echo $OPENAI_API_KEY`, not `cat` of a shell file or of `~/.gitconfig`, never the macOS keychain. `push.mjs` is the only thing that touches values. If something needs a value the scripts cannot get, tell the user the command to run themselves (`instabox vault set NAME` prompts without echo).

Before starting, tell the user plainly: a scan of this machine (nothing changes here), a plan file they edit, then their Vault gets what they checked. By default every box they have and will create gets it; they can scope it with a selector. Nothing is copied from a box back here, and nothing keeps the two in sync: to change something later, change it here and run this again.

## 1. Scan

```bash
instabox whoami                                    # signed in? otherwise: instabox login
S=~/.claude/skills/instabox-basic-setup/scripts    # or ~/.agents/skills/instabox-basic-setup/scripts: wherever this file is
W=~/instabox-basic-setup && mkdir -p -m 700 "$W"
node "$S/scan.mjs" > "$W/scan.json"
instabox vault ls --json > "$W/vault.json"         # what is in the Vault already (names, no values)
instabox usage --json | jq '.limits.vault // {}' > "$W/limits.json"
```

`instabox vault ls` fails with `API keys cannot manage the vault` when `INSTABOX_API_KEY` is set: ask the user to unset it and `instabox login`. A `404` means the server has no Vault: stop and say so.

## 2. Write the plan and let the user choose

```bash
node "$S/plan.mjs" write --scan "$W/scan.json" --vault "$W/vault.json" > "$W/plan.md"
```

Add `--selector key=value` (comma-separated for more) only if the user wants the setup on some boxes, not all; the plan's `Selector:` line can be edited too (`*` is every box). A box gets the items when its metadata has every label (`instabox create --meta key=value`).

`plan.md` has a `- [x]` / `- [ ]` line per item, in three sections (Tokens, Git, Editor and terminal), then a "Can't move" list with no checkboxes. Defaults:

- Well-known tokens and every file are checked. Other credential-looking exports, and tokens the shell reads from the macOS keychain, are unchecked (checking the latter runs that keychain lookup once, at push time).
- Something already in the Vault, set there some other way than this skill, is unchecked and says so: checking it **replaces** it (for every box its selector reached). Items this skill set on an earlier run are replaced without asking (the manifest, step 3).

Show the user a short summary (which tokens, which files, what cannot move) and the path of the file, and ask them to edit the checkboxes and the selector, then tell you to go on. In Claude Code you may ask a coarse question first with AskUserQuestion (multiSelect: "Tokens / Git / Editor and terminal") and apply the answer by changing only `[x]` and `[ ]`; the user still gets the file for details.

When they are done, read it back:

```bash
node "$S/plan.mjs" parse --scan "$W/scan.json" --vault "$W/vault.json" --limits "$W/limits.json" "$W/plan.md" > "$W/selection.json"
```

- Exit 1: the plan has problems (a malformed checkbox, a line deleted or duplicated, an unknown id, a bad selector, a plan from another scan or Vault state, a file that became empty or over 64 KiB). All are listed; show them, fix or let the user fix, parse again. Never fix a plan by editing ids or deleting lines. If the scan or Vault changed, run step 1 and 2 again.
- Exit 3: over the Vault's limits (100 items, 256 KiB in all, items already there included; 64 KiB per item). The message gives the totals and the biggest lines: ask the user what to uncheck (nvim's files are one item each), or which old Vault items to remove (`instabox vault rm NAME`), then parse again.

## 3. Push into the Vault

```bash
node "$S/push.mjs" --selection "$W/selection.json" --dry-run   # names, sizes, totals; writes nothing
node "$S/push.mjs" --selection "$W/selection.json"
```

Show the user the dry run's lines before the real run. Values go from their source (`gh auth token`, a variable after sourcing the user's shell file, this environment) straight into the CLI's stdin. A shell file that only exports when interactive (the usual `case $- in *i*)` guard) is sourced a second time in an interactive shell, which may run its prompt setup; a token it still does not yield comes from this environment, or fails with the reason; the output is names, sizes and outcomes. Every value is read and the totals checked before anything is written: over the limits, nothing is written (exit 3). An item that appeared in the Vault after the plan was written is left alone (`kept`). A `failed` line names the item and why; give the user the command to set it themselves (`instabox vault set NAME`, which prompts without echo). Re-running is safe: the same items are set again.

The run records what it set in `~/.config/instabox-basic-setup/pushed.json` (names, kinds, paths; no values), so the next run knows those are its own.

What a file becomes (counted per file in the plan's sizes):

- This machine's HOME is rewritten to the box's (`/data/home`); lines that look like a credential are replaced by a comment; macOS-only lines (`osxkeychain`, Homebrew paths, `pbcopy`, `reattach-to-user-namespace`, ...) are commented out.
- `~/.gitconfig` also: commit and tag signing is turned off (`gpgsign`: the signing key is not on the box), `url."git@...".insteadOf` rewrites are commented out (the box has no SSH key), and when `GH_TOKEN` is in the Vault, gh's credential helper for github.com is added (what `gh auth setup-git` writes), so `git clone https://github.com/...` and `git push` use the token.

## 4. Verify on a box (optional)

If the user names a running box (`instabox ls`), or wants one to try, write the Vault into it now and look:

```bash
BOX=<box>
instabox vault push "$BOX"            # writes now; lists variables and files written, and any "kept" path
instabox vault show "$BOX"            # what it gets with its metadata
instabox exec "$BOX" -- 'gh auth status; git config --get user.name; test -n "${CLAUDE_CODE_OAUTH_TOKEN-}${ANTHROPIC_API_KEY-}" && echo claude token set'
```

A `kept: ~/path (not written: ... symlink ...)` line means the box has a symlink in that path; tell the user. Check presence of a token, never print one. A box created with `--no-vault` gets nothing, ever; one whose metadata does not match the selector gets nothing either. Do not create a box for this unless the user asks.

## 5. Report

Tell the user, in short sections:

- **In your Vault**: each token by name, each file by path, and which boxes get them (every box, or the selector). Running boxes get them at their next start or resume, or now with `instabox vault push <box>`; new boxes at once.
- **Left alone**: what they unchecked, items kept because they were set some other way, failures with the reason. Items from an earlier run they unchecked this time are still in the Vault (the push prints them): `instabox vault rm NAME` removes one, and boxes lose it at their next write.
- **Do these yourself**: every entry of `.manual` in `selection.json`, with its command, for example: Claude Code's sign-in — run `claude setup-token` here yourself, then `instabox vault set CLAUDE_CODE_OAUTH_TOKEN` and paste it (or `claude`, then `/login`, on each box); Codex — `codex login --device-auth` on the box, or `instabox vault set OPENAI_API_KEY`; `gh auth login` here if gh is not signed in.
- **Good to know**: Vault files are written again at every start and resume, so an edit made to them on a box is replaced; change them here and run this skill again (or `instabox vault rm` the item to keep a box's own copy). Tokens are environment variables of login shells (SSH, `instabox exec`, the terminal), not of systemd services. Shell aliases, SSH keys, cloud credential files and agent config are not part of this setup.

Delete `$W` when the user is done with it (it holds the scan, the plan and the Vault's item names, no values).
