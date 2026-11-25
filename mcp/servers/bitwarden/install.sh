#!/usr/bin/env bash
set -e

# Install Bitwarden MCP server
if ! command -v mcp-server-bitwarden &>/dev/null; then
    npm install -g @bitwarden/mcp-server
fi

echo "Bitwarden MCP server installed"
