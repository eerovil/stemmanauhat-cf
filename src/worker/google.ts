import { base64UrlDecode } from "./signing";

/**
 * Google sign-in, authorization-code flow, done by the Worker.
 *
 * The id token's signature is not checked: the Worker posts the code straight
 * to Google's token endpoint over TLS and reads the token from that reply, so
 * the transport already proves who sent it. Its claims are checked, which is
 * what catches a genuine token meant for another app or another sign-in.
 */
export const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export function authorizeUrl(base: string, clientId: string, redirectUri: string,
  state: string, nonce: string): string {
  const url = new URL(base);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function exchangeCode(tokenUrl: string, clientId: string, clientSecret: string,
  redirectUri: string, code: string): Promise<string | null> {
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: "authorization_code",
    }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { id_token?: unknown };
  return typeof body.id_token === "string" ? body.id_token : null;
}

/** The verified email an id token claims, or null when it is not for us. */
export function readEmail(idToken: string, clientId: string, nonce: string, now: number): string | null {
  const segments = idToken.split(".");
  if (segments.length !== 3) return null;
  const decoded = base64UrlDecode(segments[1]!);
  if (decoded === null) return null;
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(new TextDecoder().decode(decoded));
  } catch {
    return null;
  }
  if (typeof claims.iss !== "string" || !ISSUERS.includes(claims.iss)) return null;
  if (claims.aud !== clientId) return null;
  if (typeof claims.exp !== "number" || claims.exp <= now) return null;
  if (claims.nonce !== nonce) return null;
  if (claims.email_verified !== true) return null;
  if (typeof claims.email !== "string" || !claims.email.includes("@")) return null;
  return normalizeEmail(claims.email);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
