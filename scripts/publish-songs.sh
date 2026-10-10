#!/usr/bin/env bash
# Publish song-app bundles to the live site (or the local one with --local).
#
#   ./scripts/publish-songs.sh [--local] <choir> <bundle-dir> ...
#
# A bundle dir holds manifest.json, score.musicxml, score.mid, timing.json and
# parts/. The container sees only this checkout, so the bundles are copied
# under .wrangler/publish/ (git-ignored) first. See scripts/publish-songs.mjs.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
where=--remote
[ "${1:-}" = "--local" ] && { where=--local; shift; }
choir="${1:?usage: publish-songs.sh [--local] <choir> <bundle-dir> ...}"; shift
[ "$#" -gt 0 ] || { echo "no bundles given" >&2; exit 2; }

rm -rf .wrangler/publish
mkdir -p .wrangler/publish
dirs=()
for src in "$@"; do
  [ -f "$src/manifest.json" ] || { echo "not a bundle: $src" >&2; exit 2; }
  dest=".wrangler/publish/$(basename "$src" | tr -c 'A-Za-z0-9._\n-' '_')"
  cp -r "$src" "$dest"
  dirs+=("$dest")
done

run=(./scripts/run.sh)
[ "$where" = "--remote" ] && run+=(--cloudflare)
"${run[@]}" node scripts/publish-songs.mjs "$where" "$choir" "${dirs[@]}"
