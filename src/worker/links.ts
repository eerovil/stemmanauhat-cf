import { sign } from "./signing";

/**
 * The key in a choir's join link, `/?user=<choir>&passphrase=<key>`. It is
 * derived from the session secret and the link's generation instead of stored,
 * so /admin can show the current link at any time while D1 keeps only its
 * PBKDF2 hash. A new generation is a new key, and the old link stops working.
 */
export async function linkKey(secret: string, choir: string, generation: number): Promise<string> {
  return (await sign(secret, `choir-link:${choir}:${generation}`)).slice(0, 24);
}

export function joinUrl(origin: string, choir: string, key: string): string {
  return `${origin}/?${new URLSearchParams({ user: choir, passphrase: key })}`;
}
