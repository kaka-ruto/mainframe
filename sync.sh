#!/usr/bin/env bash
# sync.sh - sync personal dev configs (skills, MCP, dotfiles)
# Runs after mainframe OS provisioning
# Secrets are injected by boax, not fetched here
set -euo pipefail

# Optional secrets: repo cloning is best-effort; without a token the clone
# step below warns and skips instead of failing provisioning.
GH_TOKEN="${GH_TOKEN:-}"

CONFIG_REPO="${CONFIG_REPO:-https://github.com/kaka-ruto/mainframe.git}"
BASE_DIR="${BASE_DIR:-/code}"

echo "=== Syncing dev configs ==="

# Clone config repo
rm -rf /tmp/devbox-config
git clone "$CONFIG_REPO" /tmp/devbox-config 2>/dev/null || {
    echo "Warning: could not clone config repo. Skipping config sync."
    exit 0
}

# Sync skills
if [ -d /tmp/devbox-config/skills ]; then
    mkdir -p ~/.agents/skills
    cp -r /tmp/devbox-config/skills/* ~/.agents/skills/
    echo "Skills synced."
fi

# Sync MCP config
if [ -f /tmp/devbox-config/mcp/config.json ]; then
    mkdir -p ~/.zcode/cli
    cp /tmp/devbox-config/mcp/config.json ~/.zcode/cli/config.json
    echo "MCP config synced."
fi

# Sync dotfiles
if [ -d /tmp/devbox-config/dotfiles ]; then
    for f in /tmp/devbox-config/dotfiles/.* /tmp/devbox-config/dotfiles/*; do
        [ -f "$f" ] && ln -sf "$f" ~/$(basename "$f")
    done
    echo "Dotfiles synced."
fi

# Clone project repos (customize this list)
echo "=== Cloning project repos ==="
mkdir -p "$BASE_DIR"
for repo in anywaye boax ship; do
    if [ ! -d "$BASE_DIR/$repo" ]; then
        git clone "https://$GH_TOKEN@github.com/anywaye/$repo.git" "$BASE_DIR/$repo" 2>/dev/null || echo "Warning: could not clone $repo"
    else
        cd "$BASE_DIR/$repo" && git pull 2>/dev/null || true
    fi
done

echo "=== Sync complete ==="
