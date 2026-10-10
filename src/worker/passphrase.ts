import { base64UrlDecode, base64UrlEncode } from "./signing";

/**
 * Choir passphrases, kept only as PBKDF2-SHA256 hashes. 10 000 rounds keeps a
 * check inside a free Worker's CPU budget; the per-address limit in index.ts
 * is what stops guessing online.
 */
export const DEFAULT_ITERATIONS = 10_000;

export async function hashPassphrase(passphrase: string, salt: Uint8Array<ArrayBuffer>,
  iterations = DEFAULT_ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase),
    "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return base64UrlEncode(new Uint8Array(bits));
}

export async function newPassphraseRecord(passphrase: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    salt: base64UrlEncode(salt),
    hash: await hashPassphrase(passphrase, salt),
    iterations: DEFAULT_ITERATIONS,
  };
}

export async function passphraseMatches(passphrase: string,
  record: { salt: string; hash: string; iterations: number }): Promise<boolean> {
  const salt = base64UrlDecode(record.salt);
  if (salt === null) return false;
  const candidate = await hashPassphrase(passphrase, salt, record.iterations);
  // Both sides are hashes of fixed length, so comparing them leaks nothing useful.
  return candidate === record.hash;
}
