# Load the Cloudflare credentials saved on this host, if any. Sourced, not run.
#
# Kept outside the repo and outside .dev.vars: .dev.vars is loaded into the
# Worker's own environment in local development, no place for an account token.
# The file holds CLOUDFLARE_API_TOKEN=... and CLOUDFLARE_ACCOUNT_ID=... lines.
# Give another file with STEMMANAUHAT_CLOUDFLARE_ENV=<file>, or export the two
# variables yourself.
cloudflare_env="${STEMMANAUHAT_CLOUDFLARE_ENV:-$HOME/.local/share/stemmanauhat/cloudflare.env}"
if [ -f "$cloudflare_env" ]; then
  # shellcheck disable=SC1090
  set -a
  . "$cloudflare_env"
  set +a
elif [ -n "${STEMMANAUHAT_CLOUDFLARE_ENV:-}" ]; then
  echo "no such file: $STEMMANAUHAT_CLOUDFLARE_ENV" >&2
  exit 2
fi
unset cloudflare_env

# Wrangler against the live account, run from the repo root. With node on PATH
# it runs here (after `corepack pnpm install`); without it (this copy's host),
# in the container of scripts/run.sh.
wrangler() {
  if command -v node >/dev/null 2>&1; then
    corepack pnpm exec wrangler "$@"
  else
    ./scripts/run.sh --cloudflare corepack pnpm exec wrangler "$@"
  fi
}

# A value from "vars" in wrangler.jsonc, such as WORKER_HOST; empty if unset.
wrangler_var() {
  sed -nE "s/^[[:space:]]*\"$1\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/p" wrangler.jsonc | head -n 1
}
