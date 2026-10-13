#!/usr/bin/env bash
# Build dist/digital-window-<version>.tar.gz: app files + production node_modules.
# Everything is plain JavaScript, so a bundle built on any machine runs on a Pi.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p 'require("./package.json").version')
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
OUT="$PWD/dist/digital-window-$VERSION.tar.gz"

mkdir -p "$STAGE/digital-window" dist
# Tracked files only, so .env, data/ and dev junk never ship.
git ls-files -z | xargs -0 cp --parents -t "$STAGE/digital-window"
(cd "$STAGE/digital-window" && npm ci --omit=dev --no-audit --no-fund --silent && touch node_modules/.bundled)
tar -C "$STAGE" -czf "$OUT" digital-window
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
echo "Copy to the Pi:  scp $OUT pi@<pi-ip>:~ && ssh pi@<pi-ip> 'tar xzf $(basename "$OUT") && ./digital-window/install.sh'"
