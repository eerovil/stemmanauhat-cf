#!/usr/bin/env bash
#
# Put stemmanauhat on Cloudflare in one command. Safe to run again.
#
#   ./scripts/cloudflare-setup.sh
#
# Credentials come from ~/.local/share/stemmanauhat/cloudflare.env, or the file
# STEMMANAUHAT_CLOUDFLARE_ENV names (CLOUDFLARE_API_TOKEN with Workers, D1 and
# R2 edit, and CLOUDFLARE_ACCOUNT_ID). It creates the D1 database and the R2
# bucket if they are missing, writes the database id into wrangler.jsonc
# (commit that change: CI deploys with it), applies the migrations and asks for
# the choirs, adding any that are missing. It does not deploy: a merge to main
# does that. After the first deploy, scripts/set-worker-secrets.sh sets the
# Worker's secrets. Runs wrangler with node if there is one, else in podman.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib-cloudflare.sh
. ./scripts/lib-cloudflare.sh
: "${CLOUDFLARE_API_TOKEN:?put CLOUDFLARE_API_TOKEN in ~/.local/share/stemmanauhat/cloudflare.env (or STEMMANAUHAT_CLOUDFLARE_ENV)}"
: "${CLOUDFLARE_ACCOUNT_ID:?put CLOUDFLARE_ACCOUNT_ID in ~/.local/share/stemmanauhat/cloudflare.env (or STEMMANAUHAT_CLOUDFLARE_ENV)}"

DATABASE=stemmanauhat
BUCKET=stemmanauhat

echo "==> database"
database_id=$(wrangler d1 list --json 2>/dev/null \
  | python3 -c "import json,sys; print(next((d['uuid'] for d in json.load(sys.stdin) if d['name']=='$DATABASE'), ''))")
if [ -z "$database_id" ]; then
  wrangler d1 create "$DATABASE" >/dev/null
  database_id=$(wrangler d1 list --json \
    | python3 -c "import json,sys; print(next(d['uuid'] for d in json.load(sys.stdin) if d['name']=='$DATABASE'))")
fi
sed -i -E "s/(\"database_id\"[[:space:]]*:[[:space:]]*\")[^\"]*(\")/\1${database_id}\2/" wrangler.jsonc
echo "    $DATABASE: $database_id (written to wrangler.jsonc)"

echo "==> bucket"
log=$(mktemp)
if wrangler r2 bucket create "$BUCKET" >"$log" 2>&1; then
  echo "    created $BUCKET"
elif grep -qi "already exists\|already owned" "$log"; then
  echo "    $BUCKET exists"
else
  cat "$log" >&2
  echo "could not create the bucket: is R2 enabled on the account, and does the token carry R2?" >&2
  exit 1
fi

echo "==> migrations"
wrangler d1 migrations apply "$DATABASE" --remote

echo "==> choirs"
wrangler d1 execute "$DATABASE" --remote --command "SELECT id, name, public FROM choirs ORDER BY id"
if [ -t 0 ]; then
  echo "Add a choir: its id (small letters, digits and dashes; goes in /c/<id>) and its name."
  while read -r -p "Choir id (Enter when done): " id && [ -n "$id" ]; do
    read -r -p "Name of $id: " name
    [ -n "$name" ] || { echo "a choir needs a name" >&2; continue; }
    ./scripts/add-choir.sh "$id" "$name" || true
  done
else
  echo "    add choirs with scripts/add-choir.sh <id> \"<name>\""
fi

host=$(wrangler_var WORKER_HOST)
echo "Done. Check WORKER_HOST in wrangler.jsonc (now ${host:-unset}), commit wrangler.jsonc,"
echo "merge to main to deploy, then run scripts/set-worker-secrets.sh."
