#!/usr/bin/env bash
# Install Infisical MCP server
set -e
npm install -g @infisical/mcp 2>/dev/null || npx -y @infisical/mcp --version 2>/dev/null || true
echo "Infisical MCP server ready"
