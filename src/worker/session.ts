import { cookieValue, readValue, signValue } from "./signing";

/**
 * The session is one signed cookie; there is no session table. It holds the
 * Google email (if signed in with Google) and the choirs this browser came into
 * by passphrase link, each with the link generation it was valid for.
 */
export interface Session {
  email?: string;
  links?: Record<string, number>;
  /** Unix seconds. */
  exp: number;
}

const COOKIE = "stemmanauhat_session";
export const SESSION_SECONDS = 180 * 24 * 60 * 60;

export async function readSession(request: Request, secret: string, now: number): Promise<Session | null> {
  const value = await readValue(secret, cookieValue(request.headers.get("Cookie"), COOKIE));
  if (!isSession(value) || value.exp <= now) return null;
  return value;
}

function isSession(value: unknown): value is Session {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.exp !== "number") return false;
  if (v.email !== undefined && typeof v.email !== "string") return false;
  if (v.links !== undefined) {
    if (typeof v.links !== "object" || v.links === null) return false;
    if (!Object.values(v.links).every((g) => typeof g === "number")) return false;
  }
  return true;
}

export async function sessionCookie(secret: string, session: Omit<Session, "exp">, now: number): Promise<string> {
  const value = await signValue(secret, { ...session, exp: now + SESSION_SECONDS });
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
