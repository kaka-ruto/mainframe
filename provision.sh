#!/usr/bin/env bash
# provision.sh - syncs configs, clones repos, pulls secrets
# Runs after mainframe OS provisioning
set -euo pipefail

CONFIG_REPO="https://github.com/kaka/devbox-config.git"
BASE_DIR="${BASE_DIR:-/code}"

echo "=== Syncing dev configs ==="

# Clone config repo
rm -rf /tmp/devbox-config
git clone "$CONFIG_REPO" /tmp/devbox-config

# Sync skills
mkdir -p ~/.agents/skills
cp -r /tmp/devbox-config/common/skills/* ~/.agents/skills/ 2>/dev/null || true

# Sync MCP config
mkdir -p ~/.zcode/cli
cp /tmp/devbox-config/common/mcp/config.json ~/.zcode/cli/config.json 2>/dev/null || true

# Sync dotfiles
for f in /tmp/devbox-config/common/dotfiles/.*; do
    [ -f "$f" ] && ln -sf "$f" ~/"$f"
done

# Clone project repos
echo "=== Cloning project repos ==="
mkdir -p "$BASE_DIR"
for repo in anywaye boax ship; do
    if [ ! -d "$BASE_DIR/$repo" ]; then
        git clone "https://github.com/anywaye/$repo.git" "$BASE_DIR/$repo"
    else
        cd "$BASE_DIR/$repo" && git pull
    fi
done

# Pull secrets (if bw is available)
if command -v bw &>/dev/null; then
    echo "=== Pulling secrets ==="
    bw sync 2>/dev/null || true
fi

echo "=== Provisioning complete ==="
