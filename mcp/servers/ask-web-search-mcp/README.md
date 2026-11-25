# ask-web-search-mcp

MCP server that exposes web search as a callable tool. Uses SearXNG by default,
tinyfish backend when SEARCH_BACKEND=tinyfish.

## Prerequisites
- Ruby 4.0 (via mise)
- ask-web-search-mcp gem

## Tool
- `ask_web_search` - Search the web and return results
  - `query` (required): Search query
  - `time_range` (optional): day, week, month, year
  - `max_results` (optional): Maximum results

## Configuration
- `SEARCH_BACKEND=tinyfish` - Use tinyfish backend
- `TINYFISH_API_KEY` - API key for tinyfish (from Bitwarden)
- `SEARXNG_URL` - Self-hosted SearXNG instance

## Test
```bash
mf mcp test ask-web-search-mcp
```
