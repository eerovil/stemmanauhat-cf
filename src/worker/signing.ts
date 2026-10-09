/** HMAC-SHA256 signing for the cookies the Worker hands out. */

export async function sign(secret: string, payload: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"),
    new TextEncoder().encode(payload));
  return base64UrlEncode(new Uint8Array(signature));
}

/** crypto.subtle.verify compares in constant time; `===` would not. */
export async function verify(secret: string, payload: string, signature: string): Promise<boolean> {
  const bytes = base64UrlDecode(signature);
  if (bytes === null) return false;
  return crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), bytes,
    new TextEncoder().encode(payload));
}

async function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Signs a JSON value as `<base64url json>.<signature>`. */
export async function signValue(secret: string, value: unknown): Promise<string> {
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
  return `${payload}.${await sign(secret, payload)}`;
}

/** The JSON value of a `signValue` token, or null when it is not one we signed. */
export async function readValue(secret: string, token: string | null): Promise<unknown> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  if (!(await verify(secret, payload, token.slice(dot + 1)))) return null;
  const bytes = base64UrlDecode(payload);
  if (bytes === null) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export function cookieValue(header: string | null, name: string): string | null {
  if (header === null) return null;
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() === name) return pair.slice(separator + 1).trim();
  }
  return null;
}
