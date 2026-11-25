#!/usr/bin/env bash
set -e

# Ensure Ruby 4.0 is available via mise
if ! command -v ruby &>/dev/null || ! ruby --version | grep -q "4.0"; then
    if command -v mise &>/dev/null; then
        mise use -g ruby@4.0
    else
        echo "mise not found. Please install mise first."
        exit 1
    fi
fi

RUBY_BIN="$(mise which ruby 2>/dev/null || which ruby)"
GEM_BIN="$(dirname "$RUBY_BIN")"

# Install ask-web-fetch-mcp gem
if ! command -v ask-web-fetch-mcp &>/dev/null; then
    "$GEM_BIN/gem" install ask-web-fetch-mcp
fi

echo "ask-web-fetch-mcp installed at $($GEM_BIN/which ask-web-fetch-mcp)"
