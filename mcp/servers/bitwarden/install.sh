#!/usr/bin/env bash
set -e

# Install Bitwarden MCP server
if ! command -v mcp-server-bitwarden &>/dev/null; then
    npm install -g @bitwarden/mcp-server
fi

# Create wrapper directory
mkdir -p ~/.local/bin/mcp-wrappers

# Create wrapper script that reads BW_SESSION from file
cat > ~/.local/bin/mcp-wrappers/bitwarden-mcp << 'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail

# Read BW_SESSION from file or environment
if [ -z "${BW_SESSION:-}" ] && [ -f "$HOME/.config/bitwarden/session" ]; then
    BW_SESSION=$(cat "$HOME/.config/bitwarden/session")
    export BW_SESSION
fi

exec mcp-server-bitwarden
WRAPPER
chmod +x ~/.local/bin/mcp-wrappers/bitwarden-mcp

echo "Bitwarden MCP server installed and wrapped"
