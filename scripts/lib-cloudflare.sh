# Load the Cloudflare credentials saved on this host, if any. Sourced, not run.
#
# Kept outside the repo and outside .dev.vars: .dev.vars is loaded into the
# Worker's own environment in local development, no place for an account token.
# The file holds CLOUDFLARE_API_TOKEN=... and CLOUDFLARE_ACCOUNT_ID=... lines.
cloudflare_env="${STEMMANAUHAT_CLOUDFLARE_ENV:-$HOME/.local/share/stemmanauhat/cloudflare.env}"
if [ -f "$cloudflare_env" ]; then
  # shellcheck disable=SC1090
  set -a
  . "$cloudflare_env"
  set +a
fi
unset cloudflare_env
