#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVE="${TMPDIR:-/tmp}/fuji-xe5-recipes-lab.tar.xz"
EXPECTED_SHA256="8806bc74d4887e5fa1dde80e9ace9807bffc0aa5469f9d3234a0784d53f557d2"

cd "$ROOT_DIR"

if [[ ! -d .bootstrap ]]; then
  echo "The project has already been expanded or the .bootstrap directory is missing."
  exit 1
fi

cat .bootstrap/archive.part-* | base64 --decode > "$ARCHIVE"
printf '%s  %s\n' "$EXPECTED_SHA256" "$ARCHIVE" | sha256sum --check --status

tar -xJf "$ARCHIVE" -C "$ROOT_DIR"
rm -rf .bootstrap
rm -f "$ARCHIVE"

echo "Project expanded successfully."
echo "Run: npm ci && npm run verify && npm start"
