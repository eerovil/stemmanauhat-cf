#!/usr/bin/env bash
# Publish song-app bundles to the live site (or the local one with --local).
#
#   ./scripts/publish-songs.sh [--local] <choir>[,<choir>...] [--place "<name>=<id>"]... <bundle-dir> ...
#
# A part name not in the voice tree (#107) stops the publish and lists the places; ask the
# person publishing where it goes and give it with --place (see scripts/publish-songs.mjs).
#
# Several choirs (jm,public) put the song on each list with one copy of its files (#104).
#
# A bundle dir is what scripts/song-app-bundle.py builds: manifest.json,
# score.musicxml, score.mid and timing.json, plus parts/<n>-<Name>.mp3 when the
# parts are sung (and the manifest says "sung": true) (one per part, in the manifest's order; the player then plays
# those on one clock instead of score.mid). The container sees only
# this checkout, so the bundles are copied under .wrangler/publish/ (git-ignored)
# first. See scripts/publish-songs.mjs.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
where=--remote
[ "${1:-}" = "--local" ] && { where=--local; shift; }
choir="${1:?usage: publish-songs.sh [--local] <choir>[,<choir>...] [--place "<name>=<id>"]... <bundle-dir> ...}"; shift
places=()
while [ "${1:-}" = "--place" ]; do places+=(--place "${2:?--place needs a value}"); shift 2; done
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
"${run[@]}" node scripts/publish-songs.mjs "$where" "$choir" "${places[@]}" "${dirs[@]}"
