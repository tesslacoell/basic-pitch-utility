#!/usr/bin/env bash

# Basic Pitch Audio-to-MIDI & Stem Extractor
# Automated Build & Launch Script for macOS and Linux

set -e

# Change to the project root directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "============================================================"
echo " Basic Pitch Audio-to-MIDI Toolkit - Automated Setup"
echo "============================================================"

# Check if Node.js is installed
if ! command -v node >/dev/null 2>&1; then
    if [ "$1" = "clean" ] || [ "$1" = "--clean" ]; then
        echo "Removing build artifacts (dist/, release/)..."
        rm -rf dist release node_modules/.vite
        echo "✔ Clean complete."
        exit 0
    fi

    echo "✖ Error: Node.js is not installed."
    echo "Please install Node.js 18+ from https://nodejs.org or via package manager:"
    echo "  macOS: brew install node"
    echo "  Ubuntu/Debian: sudo apt install nodejs npm"
    echo "  Arch Linux: sudo pacman -S nodejs npm"
    exit 1
fi

# Forward all arguments to the cross-platform Node script
node scripts/build.mjs "$@"
