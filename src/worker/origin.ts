const PUBLIC_HOST = "stemmanauhat.vilpponen.fi";
const WORKER_HOST = "stemmanauhat.eerovil.workers.dev";

/**
 * The origin the browser used, for addresses that leave the site (Google's
 * redirect URI). The VPS proxies stemmanauhat.vilpponen.fi here and addresses
 * the Worker by its workers.dev name, so request.url carries that name. The
 * forwarded host is trusted only in that exact proxy shape: anyone can send
 * the header straight to workers.dev, and Google would refuse any other
 * redirect URI anyway.
 */
export function publicOrigin(url: URL, headers: Headers): string {
  if (url.hostname === WORKER_HOST
    && headers.get("X-Forwarded-Host") === PUBLIC_HOST
    && headers.get("X-Forwarded-Proto") === "https") {
    return `https://${PUBLIC_HOST}`;
  }
  return url.origin;
}
