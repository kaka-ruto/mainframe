#!/usr/bin/env bash
set -e

if ! command -v starship &>/dev/null; then
    echo "Installing starship..."
    curl -sS https://starship.rs/install.sh | sh -s -- -y
else
    echo "starship already available. Skipping."
fi
