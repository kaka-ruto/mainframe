# ask-web-fetch-mcp

MCP server that exposes web fetch as a callable tool. Fetches a URL and returns clean markdown.

## Prerequisites
- Ruby 4.0 (via mise)
- ask-web-fetch-mcp gem

## Tool
- `ask_web_fetch` - Fetch a URL and return markdown content
  - `url` (required): URL to fetch
  - `max_chars` (optional): Maximum characters to return

## Configuration
Optional environment variables:
- `ASK_WEB_FETCH_CDP_URL` - CDP endpoint for Chrome
- `CRAWL4AI_URL` - Self-hosted Crawl4AI renderer
- `JINA_API_KEY` - Jina Reader API key
- `DEBUG=1` - Debug logging

## Test
```bash
mf mcp test ask-web-fetch-mcp
```
