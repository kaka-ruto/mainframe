# Bitwarden MCP Server

Provides AI assistants with secure access to Bitwarden password manager.

## Prerequisites
- Bitwarden CLI (`bw`) installed
- Bitwarden account
- Node.js 22+

## Secrets
- `bw-session`: Session token from `bw unlock --raw`

## Setup
1. `bw login <email>`
2. `bw unlock --raw` → copy the session token
3. Set `BW_SESSION` env var or store in password manager
4. `mf mcp install bitwarden`
5. `mf mcp enable bitwarden`
6. `mf mcp apply`
