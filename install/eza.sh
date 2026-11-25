#!/usr/bin/env bash
set -e

if ! command -v eza &>/dev/null; then
    echo "Installing eza..."
    if command -v cargo &>/dev/null; then
        cargo install eza
    else
        echo "cargo not found. Install Rust first."
        exit 1
    fi
else
    echo "eza already available. Skipping."
fi
