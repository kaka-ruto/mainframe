#!/usr/bin/env bash
set -e

# Ensure Ruby 4.0 is available via mise
if ! command -v ruby &>/dev/null || ! ruby --version 2>/dev/null | grep -q "4.0"; then
    if command -v mise &>/dev/null; then
        mise use -g ruby@4.0
    else
        echo "mise not found. Please install mise first."
        exit 1
    fi
fi

RUBY_BIN="$(mise which ruby 2>/dev/null)"
GEM_BIN="$(dirname "$RUBY_BIN")"
GEM_PATH="$GEM_BIN/ask-web-search-mcp"

# Install ask-web-search-mcp gem
if [ ! -f "$GEM_PATH" ]; then
    "$GEM_BIN/gem" install ask-web-search-mcp
fi

# Create wrapper directory
mkdir -p ~/.local/bin/mcp-wrappers

# Create wrapper script that fetches API key from Bitwarden at runtime
cat > ~/.local/bin/mcp-wrappers/ask-web-search-mcp << WRAPPER
#!/usr/bin/env bash
set -euo pipefail

# Read BW_SESSION from file or environment
if [ -z "\${BW_SESSION:-}" ] && [ -f "\$HOME/.config/bitwarden/session" ]; then
    BW_SESSION=\$(cat "\$HOME/.config/bitwarden/session")
    export BW_SESSION
fi

# Fetch TINYFISH_API_KEY from Bitwarden if not set
if [ -z "\${TINYFISH_API_KEY:-}" ] && [ -n "\${BW_SESSION:-}" ]; then
    TINYFISH_API_KEY=\$(bw get item "ask-web-search-api-key" 2>/dev/null | python3 -c "import json,sys,re; d=json.load(sys.stdin); m=re.search(r'sk-tinyfish-[A-Za-z0-9_-]+', d.get('notes','')); print(m.group(0) if m else '')" 2>/dev/null || echo "")
    if [ -n "\$TINYFISH_API_KEY" ]; then
        export TINYFISH_API_KEY
    fi
fi

export SEARCH_BACKEND="\${SEARCH_BACKEND:-tinyfish}"
exec "$GEM_PATH"
WRAPPER
chmod +x ~/.local/bin/mcp-wrappers/ask-web-search-mcp

echo "ask-web-search-mcp installed and wrapped at ~/.local/bin/mcp-wrappers/ask-web-search-mcp"
