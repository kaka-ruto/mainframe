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

echo "web-search MCP available at $(command -v web-search)"
