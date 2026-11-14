# ask-web-search-mcp

Web search MCP server using tinyfish backend.

## Dependencies
- Ruby 4.0+ (installed by mainframe)
- gem: ask-web-search-mcp

## Secrets
- TINYFISH_API_KEY: stored in Infisical (project: devbox, env: dev)
- Fetched at runtime via Infisical CLI wrapper
- Agent never sees the actual secret value

## Setup
1. Install Infisical CLI: `apt install infisical` or `npm install -g @infisical/cli`
2. Set INFISICAL_PROJECT_ID env var
3. Run: `mf mcp install ask-web-search-mcp`

## Test
```bash
mf mcp test ask-web-search-mcp
```
