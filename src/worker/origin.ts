/** The site's addresses, from `vars` in wrangler.jsonc. */
export interface Hosts {
  /** The name the Worker answers to on workers.dev, such as stemmanauhat.eerovil.workers.dev. */
  WORKER_HOST?: string;
  /** A name of your own that a proxy forwards to WORKER_HOST. Leave it out if there is none. */
  PUBLIC_HOST?: string;
}

/**
 * The origin the browser used, for addresses that leave the site (Google's
 * redirect URI). A proxy (this copy's VPS) can serve PUBLIC_HOST and address
 * the Worker by its workers.dev name, so request.url carries that name. The
 * forwarded host is trusted only in that exact proxy shape: anyone can send
 * the header straight to workers.dev, and Google would refuse any other
 * redirect URI anyway.
 */
export function publicOrigin(url: URL, headers: Headers, hosts: Hosts): string {
  const { WORKER_HOST, PUBLIC_HOST } = hosts;
  if (WORKER_HOST && PUBLIC_HOST
    && url.hostname === WORKER_HOST
    && headers.get("X-Forwarded-Host") === PUBLIC_HOST
    && headers.get("X-Forwarded-Proto") === "https") {
    return `https://${PUBLIC_HOST}`;
  }
  return url.origin;
}
