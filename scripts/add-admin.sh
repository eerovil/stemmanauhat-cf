#!/usr/bin/env bash
# Make a Google account an admin of the live site: ./scripts/add-admin.sh you@gmail.com
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib-cloudflare.sh
. ./scripts/lib-cloudflare.sh
email=$(printf '%s' "${1:?usage: add-admin.sh <email>}" | tr '[:upper:]' '[:lower:]')
case "$email" in *"'"*|*" "*|*@*@*) echo "not an email: $email" >&2; exit 2 ;; *@*.*) ;; *) echo "not an email: $email" >&2; exit 2 ;; esac
wrangler d1 execute stemmanauhat --remote \
  --command "INSERT INTO admins (email) VALUES ('$email') ON CONFLICT DO NOTHING"
