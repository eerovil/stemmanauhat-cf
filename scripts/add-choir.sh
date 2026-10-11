#!/usr/bin/env bash
# Add a choir to the live site: ./scripts/add-choir.sh <id> "<name>"
#
# The id goes in the address (/c/<id>) and in song-app's Publish panel, which
# reads the choirs from D1: small letters, digits and dashes. The new choir is
# private: only its members, admins and its link get in. A choir that is
# already there is left as it is.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib-cloudflare.sh
. ./scripts/lib-cloudflare.sh
id="${1:?usage: add-choir.sh <id> \"<name>\"}"
name="${2:?usage: add-choir.sh <id> \"<name>\"}"
[[ "$id" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "the id takes small letters, digits and dashes: $id" >&2; exit 2; }
quoted=${name//\'/\'\'}
wrangler d1 execute stemmanauhat --remote \
  --command "INSERT INTO choirs (id, name, public) VALUES ('$id', '$quoted', 0) ON CONFLICT (id) DO NOTHING"
echo "$id: $name (left as it was if it existed)"
