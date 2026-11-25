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
