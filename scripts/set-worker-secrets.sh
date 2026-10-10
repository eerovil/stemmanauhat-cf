#!/usr/bin/env bash
# Set the live Worker's secrets, after its first deploy (a merge to main).
#
#   ./scripts/set-worker-secrets.sh
#
# SESSION_SECRET is generated here the first time and never stored anywhere
# else. Then it asks for the Google OAuth client (press Enter to skip), whose
# redirect URI must be https://stemmanauhat.eerovil.workers.dev/auth/callback
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
wrangler() { ./scripts/run.sh --cloudflare corepack pnpm exec wrangler "$@"; }

if wrangler secret list 2>/dev/null | grep -q SESSION_SECRET; then
  echo "SESSION_SECRET already set"
else
  head -c 32 /dev/urandom | base64 | tr -d '\n' | wrangler secret put SESSION_SECRET
fi

read -r -p "Google client id (Enter to skip): " client_id
[ -n "$client_id" ] || exit 0
read -r -s -p "Google client secret: " client_secret; echo
printf '%s' "$client_id" | wrangler secret put GOOGLE_CLIENT_ID
printf '%s' "$client_secret" | wrangler secret put GOOGLE_CLIENT_SECRET
