#!/usr/bin/env bash
# Set a choir's old-link passphrase on the live site: ./scripts/set-passphrase.sh jm
# Asks for the passphrase (never on the command line) and stores only its
# PBKDF2 hash. Changing it signs out every browser that came in by the old one.
# The admin page (/admin) does the same thing from a browser.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
choir="${1:?usage: set-passphrase.sh <jm|naiskuoro>}"
case "$choir" in jm|naiskuoro) ;; *) echo "unknown choir: $choir" >&2; exit 2 ;; esac
read -r -s -p "Passphrase for $choir: " passphrase; echo
[ "${#passphrase}" -ge 6 ] || { echo "at least 6 characters" >&2; exit 2; }
record=$(printf '%s' "$passphrase" | python3 -c '
import base64, hashlib, os, sys
p = sys.stdin.buffer.read(); salt = os.urandom(16)
h = hashlib.pbkdf2_hmac("sha256", p, salt, 10000, 32)
b = lambda x: base64.urlsafe_b64encode(x).decode().rstrip("=")
print(b(salt), b(h))')
read -r salt hash <<<"$record"
./scripts/run.sh --cloudflare corepack pnpm exec wrangler d1 execute stemmanauhat --remote --command \
  "INSERT INTO choir_links (choir, salt, hash, iterations, generation) VALUES ('$choir', '$salt', '$hash', 10000, 1)
   ON CONFLICT (choir) DO UPDATE SET salt = excluded.salt, hash = excluded.hash, iterations = 10000, generation = generation + 1"
