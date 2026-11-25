#!/usr/bin/env bash
set -e

# Install browse MCP (binary should be at ~/.local/bin/browse)
if ! command -v browse &>/dev/null; then
    echo "browse binary not found. Install from https://github.com/anywaye/browse"
    exit 1
fi

echo "browse MCP available at $(which browse)"
