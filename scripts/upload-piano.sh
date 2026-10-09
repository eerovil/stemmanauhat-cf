#!/usr/bin/env bash
# Upload the piano soundfont to the live site's R2 bucket as sound/piano-1.sf3.
#
#   ./scripts/upload-piano.sh piano.sf3
#
# Make the file with scripts/make-piano-soundfont.mjs. The name carries a
# version because browsers cache it for good: a new piano gets a new name, and
# SOUNDFONT_URL in src/client/player/midi.ts moves with it.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
file="${1:?usage: upload-piano.sh <piano.sf3>}"
case "$file" in /*) ;; *) file="$PWD/$file" ;; esac
[ -f "$file" ] || { echo "no such file: $file" >&2; exit 2; }
# The container sees the repo at /app, so the file has to be inside it.
case "$file" in "$PWD"/*) rel="${file#"$PWD"/}" ;; *) echo "put the file inside the repo (it is git-ignored under .wrangler/)" >&2; exit 2 ;; esac
./scripts/run.sh --cloudflare corepack pnpm exec wrangler r2 object put stemmanauhat/sound/piano-1.sf3 \
  --remote --file "$rel" --content-type application/octet-stream
