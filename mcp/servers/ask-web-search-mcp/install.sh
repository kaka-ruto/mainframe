#!/usr/bin/env bash
set -e
if ! command -v ask-web-search-mcp &>/dev/null; then
    gem install ask-web-search-mcp
fi
echo "ask-web-search-mcp installed"
