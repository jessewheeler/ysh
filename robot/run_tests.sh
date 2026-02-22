#!/usr/bin/env bash
set -euo pipefail

# Load nvm if available (ensures correct Node version in non-interactive shells)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 2>/dev/null || true

# Navigate to project root (parent of robot/)
cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"

echo "==> Installing Python dependencies..."
pip install -q -r robot/requirements.txt

echo "==> Initializing Browser Library (Playwright)..."
rfbrowser init chromium

echo "==> Running Robot Framework tests..."
robot \
    --outputdir robot/results \
    --loglevel INFO \
    --variable PROJECT_ROOT:"$PROJECT_ROOT" \
    "$@" \
    robot/tests/
