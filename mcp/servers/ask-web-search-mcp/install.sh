#!/usr/bin/env bash
set -e

# Install ask-web-search-mcp
if ! command -v ask-web-search-mcp &>/dev/null; then
    gem install ask-web-search-mcp
fi

# Create wrapper directory
mkdir -p ~/.local/bin/mcp-wrappers

# Create wrapper script (fetches secrets from Infisical at runtime)
cat > ~/.local/bin/mcp-wrappers/ask-web-search-mcp << 'WRAPPER'
#!/usr/bin/env bash
INFISICAL_PROJECT_ID="${INFISICAL_PROJECT_ID:-YOUR_PROJECT_ID}"
INFISICAL_ENV="${INFISICAL_ENV:-dev}"
exec infisical secrets-manager run --projectId "$INFISICAL_PROJECT_ID" --env "$INFISICAL_ENV" -- /home/ubuntu/.local/share/mise/installs/ruby/4.0.1/bin/ask-web-search-mcp
WRAPPER
chmod +x ~/.local/bin/mcp-wrappers/ask-web-search-mcp

echo "ask-web-search-mcp installed and wrapped"
