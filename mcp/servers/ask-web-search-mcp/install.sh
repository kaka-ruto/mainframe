#!/usr/bin/env bash
set -e

# Install ask-web-search-mcp
if ! command -v ask-web-search-mcp &>/dev/null; then
    gem install ask-web-search-mcp
fi

# Create wrapper directory
mkdir -p ~/.local/bin/mcp-wrappers

# Create wrapper script (fetches secrets from Infisical at runtime)
# Universal Auth (production): set INFISICAL_CLIENT_ID + INFISICAL_CLIENT_SECRET
# Session auth (dev): uses saved Infisical CLI session
cat > ~/.local/bin/mcp-wrappers/ask-web-search-mcp << 'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
INFISICAL_URL="${INFISICAL_URL:-https://vault.anywaye.com}"
INFISICAL_PROJECT_ID="${INFISICAL_PROJECT_ID:-YOUR_PROJECT_ID}"
INFISICAL_ENV="${INFISICAL_ENV:-dev}"

if [ -n "${INFISICAL_CLIENT_ID:-}" ] && [ -n "${INFISICAL_CLIENT_SECRET:-}" ]; then
    # Universal Auth (machine identity) - production path, no password needed
    TOKEN=$(curl -s -X POST "$INFISICAL_URL/api/v1/auth/universal-auth/login" \
      -H 'Content-Type: application/json' \
      -d "{\"clientId\":\"$INFISICAL_CLIENT_ID\",\"clientSecret\":\"$INFISICAL_CLIENT_SECRET\"}" | \
      python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])")
    TINYFISH_API_KEY=$(curl -s -H "Authorization: Bearer $TOKEN" \
      "$INFISICAL_URL/api/v3/secrets/raw/TINYFISH_API_KEY?workspaceId=$INFISICAL_PROJECT_ID&environment=$INFISICAL_ENV" | \
      python3 -c "import json,sys; print(json.load(sys.stdin)['secret']['secretValue'])")
    export TINYFISH_API_KEY
else
    # Session auth (dev) - uses Infisical CLI saved session
    exec infisical secrets-manager run --projectId "$INFISICAL_PROJECT_ID" --env "$INFISICAL_ENV" -- /home/ubuntu/.local/share/mise/installs/ruby/4.0.1/bin/ask-web-search-mcp
fi

export SEARCH_BACKEND=tinyfish
exec /home/ubuntu/.local/share/mise/installs/ruby/4.0.1/bin/ask-web-search-mcp
WRAPPER
chmod +x ~/.local/bin/mcp-wrappers/ask-web-search-mcp

echo "ask-web-search-mcp installed and wrapped"
