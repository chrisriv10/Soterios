#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/tests/fixtures/screenshots"
ELECTRON="$ROOT/node_modules/.bin/electron"
mkdir -p "$OUT"

capture_page() {
  local name="$1"
  local page="$2"
  shift 2

  echo "Capturing $name ..."
  if [[ $# -gt 0 ]]; then
    "$ELECTRON" "$ROOT" --dev --screenshot-capture \
      --screenshot-page="$page" \
      --screenshot-out="$OUT/${name}.png" \
      "$@"
  else
    "$ELECTRON" "$ROOT" --dev --screenshot-capture \
      --screenshot-page="$page" \
      --screenshot-out="$OUT/${name}.png"
  fi
  echo "Saved $OUT/${name}.png"
}

capture_page "01-dashboard" "dashboard"
capture_page "02-tools-page" "tools"
capture_page "04-settings-language" "settings"
capture_page "03-uninstaller-mac-unsupported" "tools" --screenshot-run-uninstaller

echo "Screenshots saved under $OUT"
