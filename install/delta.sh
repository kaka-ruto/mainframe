#!/usr/bin/env bash
set -e

if ! command -v delta &>/dev/null; then
    echo "Installing delta..."
    if command -v cargo &>/dev/null; then
        cargo install git-delta
    else
        echo "cargo not found. Install Rust first."
        exit 1
    fi
else
    echo "delta already available. Skipping."
fi
