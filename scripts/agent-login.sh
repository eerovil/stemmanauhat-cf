#!/usr/bin/env bash
# A login link to the live site for an agent checking it as a singer (#79).
#
#   ./scripts/agent-login.sh jm                    # link for one choir
#   ./scripts/agent-login.sh jm naiskuoro --next /c/jm/kokeilu
#   ./scripts/agent-login.sh --local http://127.0.0.1:8787 jm
#   ./scripts/agent-login.sh --setup               # once: make the key, give it to the Worker
#   ./scripts/agent-login.sh --rotate              # new key: every old link and session stops
#
# The link works for 5 minutes. It starts a one-hour session that may open the
# named choirs (never the test list), cannot send anything, and is never an
# admin. Never paste a link into an issue or a pull request.
#
# The key is AGENT_LOGIN_SECRET, a Worker secret of its own (not SESSION_SECRET).
# Its only other copy is on this host, in ~/.local/share/stemmanauhat/agent-login.key
# (or STEMMANAUHAT_AGENT_KEY=<file>), never in the repository. Deleting the
# Worker secret turns the links off, and a new or deleted key ends every
# agent session already started.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

key_file="${STEMMANAUHAT_AGENT_KEY:-$HOME/.local/share/stemmanauhat/agent-login.key}"
link_seconds=300

usage() {
  echo "usage: agent-login.sh [--local <origin>] [--next <path>] <choir>... | --setup | --rotate" >&2
  exit 2
}

put_secret() {
  # shellcheck source=scripts/lib-cloudflare.sh
  . ./scripts/lib-cloudflare.sh
  wrangler secret put AGENT_LOGIN_SECRET < "$key_file"
}

new_key() {
  mkdir -p "$(dirname "$key_file")"
  (umask 077; head -c 32 /dev/urandom | base64 | tr -d '\n' > "$key_file")
}

base64url() { base64 | tr -d '\n=' | tr '+/' '-_'; }

origin=""
next=""
choirs=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --setup)
      [ -f "$key_file" ] || new_key
      put_secret
      exit 0 ;;
    --rotate)
      new_key
      put_secret
      exit 0 ;;
    --local) [ "$#" -ge 2 ] || usage; origin="$2"; shift 2 ;;
    --next) [ "$#" -ge 2 ] || usage; next="$2"; shift 2 ;;
    -*) usage ;;
    *) choirs+=("$1"); shift ;;
  esac
done
[ "${#choirs[@]}" -gt 0 ] || usage
[ -f "$key_file" ] || { echo "no key in $key_file: run ./scripts/agent-login.sh --setup" >&2; exit 2; }

for choir in "${choirs[@]}"; do
  [[ "$choir" =~ ^[a-z0-9-]+$ ]] || { echo "not a choir id: $choir" >&2; exit 2; }
done
if [ -z "$origin" ]; then
  host=$(sed -nE 's/^[[:space:]]*"PUBLIC_HOST"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' wrangler.jsonc | head -n 1)
  [ -n "$host" ] || host=$(sed -nE 's/^[[:space:]]*"WORKER_HOST"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' wrangler.jsonc | head -n 1)
  origin="https://$host"
fi

list=$(printf '"%s",' "${choirs[@]}")
payload=$(printf '{"choirs":[%s],"exp":%d}' "${list%,}" "$(( $(date +%s) + link_seconds ))" | base64url)
# The key is briefly on openssl's command line; this host has one user.
# The same format as signValue in src/worker/signing.ts: <payload>.<HMAC-SHA256 of payload>.
signature=$(printf '%s' "$payload" | openssl dgst -sha256 -mac HMAC -macopt "key:$(cat "$key_file")" -binary | base64url)
link="$origin/auth/agent?t=$payload.$signature"
if [ -n "$next" ]; then
  # A path on the site; the Worker drops anything else (safeNext).
  link="$link&next=$(printf '%s' "$next" | sed 's/%/%25/g; s/&/%26/g; s/#/%23/g; s/?/%3F/g; s/+/%2B/g; s/ /%20/g')"
fi
echo "$link"
