#!/usr/bin/env bash
set -e

if ! command -v web-search &>/dev/null; then
    if command -v uv &>/dev/null; then
        uv tool install "git+https://github.com/anywaye/web-search@master" --force
    elif command -v pipx &>/dev/null; then
        pipx install "git+https://github.com/anywaye/web-search@master" --force
    else
        python3 -m pip install --user "git+https://github.com/anywaye/web-search@master"
    fi
fi


# Ensure the binary is available on PATH at ~/.local/bin
mkdir -p "$HOME/.local/bin"
if command -v web-search >/dev/null 2>&1 && [ ! -f "$HOME/.local/bin/web-search" ]; then
    ln -sf "$(command -v web-search)" "$HOME/.local/bin/web-search"
fi

echo "web-search MCP available at $(command -v web-search)"
