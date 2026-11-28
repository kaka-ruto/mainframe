#!/usr/bin/env bash
# install/web-tools.sh — materialize the MCP servers referenced by mcp/config.json.
# Runs via 'mf apply custom-installs'. Idempotent.
set -euo pipefail

echo "[web-tools] ensuring uv..."
if ! command -v uv >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
        brew install -q uv
    elif command -v apt-get >/dev/null 2>&1; then
        curl -LsSf https://astral.sh/uv/install.sh | sh
        export PATH="$HOME/.local/bin:$PATH"
    else
        echo "  no brew/apt — install uv manually"; exit 0
    fi
fi

echo "[web-tools] installing web-fetch + web-search (anywaye org)"
export PATH="$HOME/.local/bin:$PATH"
command -v web-fetch  >/dev/null 2>&1 || uv tool install "git+https://github.com/anywaye/web-fetch@master"  --force
command -v web-search >/dev/null 2>&1 || uv tool install "git+https://github.com/anywaye/web-search@master" --force

echo "[web-tools] Chromium for web-fetch rendering tier (one-time)"
"$(uv tool run --from anywaye-web-fetch python)" -m patchright install chromium 2>/dev/null \
  || python3 -m patchright install chromium 2>/dev/null \
  || echo "  chromium install skipped (run manually: python3 -m patchright install chromium)"

echo "[web-tools] bitwarden MCP server"
if ! command -v mcp-server-bitwarden >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then brew install -q mcp-server-bitwarden; fi
fi
mkdir -p "$HOME/.local/bin/mcp-wrappers"
cat > "$HOME/.local/bin/mcp-wrappers/bitwarden-mcp" <<'WRAPPER'
#!/usr/bin/env bash
exec "$(command -v mcp-server-bitwarden || echo /opt/homebrew/bin/mcp-server-bitwarden)" "$@"
WRAPPER
chmod +x "$HOME/.local/bin/mcp-wrappers/bitwarden-mcp"

echo "[web-tools] done. Servers: web-fetch, web-search, browse (npx @playwright/mcp), bitwarden"
