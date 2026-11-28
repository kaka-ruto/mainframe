# Mainframe Project

Personal dev environment config. Provisioned with mf.

See https://github.com/anywaye/mainframe for docs.

## Structure

```
mainframe/
├── mainframe.yml          # Machine config (mode, secrets, references)
├── packages.conf          # System packages (brew/apt/dnf)
├── runtimes.conf          # Language versions (mise format)
├── mcp/                   # MCP servers (registry + configs)
├── skills/                # AI agent skills
├── shell/                 # Shell config (zsh, bash)
├── git/                   # Git config (gitconfig, gitignore)
├── editor/                # Editor config (nvim/astronvim)
├── terminal/              # Terminal config (tmux, kitty, alacritty)
├── ssh/                   # SSH config (no keys)
├── bin/                   # Custom scripts
├── os/                    # OS-specific settings
├── .env.template          # Environment variables
├── sandbox.yml            # Sandbox spec
├── Dockerfile             # Container image
└── sync.sh                # Sync script
```

## Setup

```bash
# Install mf
curl -fsSL https://get.mainframe.sh | bash

# Clone this config
mf init https://github.com/kaka-ruto/mainframe.git

# Apply to machine
mf apply
```

## Publishing box specs to boax

This repo is the single source of truth for what an agent box contains.
`sandbox.yml` + `sync.sh` are consumed two ways:

- **mf apply (host)** — configures your own interactive agent environment.
- **boax (boxes)** — `boax/config.json` is the published projection of
  `sandbox.yml` as boax `templates` + `profiles` + `pools`. Merge it into the
  boax-server config; `boax sync --repo <this repo>` (or
  `BOAX_CONFIG_REPO=<this repo>`) pulls `sync.sh` into a box.

Boxes are long-lived: runs reuse pool boxes and refresh them via snapshots —
they are not destroyed per run. Rule of thumb: **the box spec lives here, never
in boax or any.** See the "Role boundaries" section in the mf/boax/any READMEs.
