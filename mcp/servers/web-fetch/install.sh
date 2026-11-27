#!/usr/bin/env bash
set -e

# Install web-fetch (MCP server + CLI) from GitHub
if ! command -v web-fetch &>/dev/null; then
    if command -v uv &>/dev/null; then
        uv tool install "git+https://github.com/anywaye/web-fetch@master" --force
    elif command -v pipx &>/dev/null; then
        pipx install "git+https://github.com/anywaye/web-fetch@master" --force
    else
        python3 -m pip install --user "git+https://github.com/anywaye/web-fetch@master"
    fi
fi

# Install Chromium for patchright (one-time)
python3 -m patchright install chromium 2>/dev/null || true


# Ensure the binary is available on PATH at ~/.local/bin
mkdir -p "$HOME/.local/bin"
if command -v web-fetch >/dev/null 2>&1 && [ ! -f "$HOME/.local/bin/web-fetch" ]; then
    ln -sf "$(command -v web-fetch)" "$HOME/.local/bin/web-fetch"
fi

echo "web-fetch MCP available at $(command -v web-fetch)"
