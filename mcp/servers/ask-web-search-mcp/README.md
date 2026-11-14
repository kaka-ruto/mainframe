# ask-web-search-mcp

Web search MCP server using tinyfish backend.

## Dependencies
- Ruby 4.0+ (installed by mainframe)
- gem: ask-web-search-mcp

## Secrets
- TINYFISH_API_KEY: stored in Infisical (project: devbox, env: dev)
- Fetched at runtime via wrapper (Universal Auth or Infisical CLI session)
- Agent never sees the actual secret value

## Setup
1. Set INFISICAL_CLIENT_ID and INFISICAL_CLIENT_SECRET (Universal Auth)
   OR log in via `infisical login` (session auth)
2. Set INFISICAL_PROJECT_ID
3. Run: `mf mcp install ask-web-search-mcp`

## Test
```bash
mf mcp test ask-web-search-mcp
```
