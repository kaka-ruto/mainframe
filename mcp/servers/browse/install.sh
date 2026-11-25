#!/usr/bin/env bash
set -e

# Check for browse binary
if ! command -v browse &>/dev/null && [ ! -f "$HOME/.local/bin/browse" ]; then
    echo "browse binary not found."
    echo "Install from: https://github.com/anywaye/browse"
    echo "Or download to ~/.local/bin/browse"
    exit 1
fi

# Ensure it's in PATH
if [ -f "$HOME/.local/bin/browse" ] && ! command -v browse &>/dev/null; then
    export PATH="$HOME/.local/bin:$PATH"
fi

echo "browse MCP available at $(command -v browse)"
