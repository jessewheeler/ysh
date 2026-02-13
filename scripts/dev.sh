#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

npm install --silent
npm run dev
