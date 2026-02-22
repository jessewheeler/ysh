#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

# Load nvm if available (ensures correct Node version in non-interactive shells)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 2>/dev/null || true

npm install --silent
npm run dev
