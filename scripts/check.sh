#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

echo "==> Linting..."
npm run lint

echo "==> Running tests..."
npm test

echo "==> Running Robot Framework tests..."
./robot/run_tests.sh
