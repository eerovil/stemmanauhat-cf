#!/usr/bin/env bash
# Run a command in Microsoft's Playwright image (Node 24, corepack, browsers)
# against this checkout. There is no node on this host, so every pnpm, wrangler
# and test command goes through here:
#
#   ./scripts/run.sh corepack pnpm install
#   ./scripts/run.sh corepack pnpm test
#   ./scripts/run.sh --serve corepack pnpm dev        # http://127.0.0.1:8787
#   ./scripts/run.sh --cloudflare corepack pnpm exec wrangler deploy
#
# --cloudflare is the only way the account token reaches a command. Installs and
# tests never get production credentials. The token is read from
# ~/.local/share/stemmanauhat/cloudflare.env (see scripts/lib-cloudflare.sh).
#
# One run per checkout at a time: two would share the local D1 and R2 files in
# .wrangler/state and fail in ways that look like bugs.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container_home="${STEMMANAUHAT_CONTAINER_HOME:-$HOME/.local/share/stemmanauhat/home}"
mkdir -p "$container_home"

serve=0
with_cloudflare=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --serve) serve=1; shift ;;
    --cloudflare) with_cloudflare=1; shift ;;
    --) shift; break ;;
    *) break ;;
  esac
done
[ "$#" -gt 0 ] || { echo "usage: run.sh [--serve] [--cloudflare] command ..." >&2; exit 2; }

repo_hash="$(printf '%s' "$repo" | sha256sum | cut -c1-8)"
container="stemmanauhat-${repo_hash}"
if [ -n "$(podman ps --filter "name=^${container}\$" --format '{{.ID}}')" ]; then
  echo "refusing to start: another run is using this checkout ($container)." >&2
  echo "Wait for it, or stop it with: podman stop $container" >&2
  exit 1
fi

flags=(-i --name "$container" --network=host)
[ -t 0 ] && flags+=(-t)
[ "$serve" = "1" ] && flags+=(-e STEMMANAUHAT_SERVE=1)
if [ "$with_cloudflare" = "1" ]; then
  # shellcheck source=scripts/lib-cloudflare.sh
  . "$repo/scripts/lib-cloudflare.sh"
  # Forwarded by name, never by value, so the token stays off the command line.
  [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && flags+=(-e CLOUDFLARE_API_TOKEN)
  [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && flags+=(-e CLOUDFLARE_ACCOUNT_ID)
fi
for name in PLAYWRIGHT_PORT CI; do
  [ -n "${!name:-}" ] && flags+=(-e "$name=${!name}")
done

stop_container() { podman stop --time 5 "$container" >/dev/null 2>&1 || true; }
trap 'stop_container; exit 130' INT TERM
trap stop_container EXIT

status=0
podman run --rm "${flags[@]}" \
  -v "$repo":/app:Z \
  -v "$container_home":/home/dev:Z \
  -w /app \
  -e HOME=/home/dev \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e WRANGLER_SEND_METRICS=false \
  --userns=keep-id \
  mcr.microsoft.com/playwright:v1.62.1-noble \
  "$@" || status=$?
exit "$status"
