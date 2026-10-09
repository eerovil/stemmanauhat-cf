#!/usr/bin/env bash
# Store the Google OAuth client as Worker secrets. Asks for both values, so
# neither lands in shell history. The client's redirect URI must be
# https://stemmanauhat.eerovil.workers.dev/auth/callback
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
read -r -p "Google client id: " client_id
read -r -s -p "Google client secret: " client_secret; echo
printf '%s' "$client_id" | ./scripts/run.sh --cloudflare corepack pnpm exec wrangler secret put GOOGLE_CLIENT_ID
printf '%s' "$client_secret" | ./scripts/run.sh --cloudflare corepack pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET
