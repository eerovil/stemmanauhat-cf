import type { Session } from "./session";
import { readValue, sign } from "./signing";

/**
 * Login links for agents checking the live site as a singer (#79). Only this
 * host can make one: scripts/agent-login.sh signs `{ choirs, exp }` with
 * AGENT_LOGIN_SECRET, a key of its own, so its host copy can never make an
 * admin or a long session. The session it starts names its choirs, has no
 * email, and may only read. It also carries a mark made from the key, so a
 * new key (--rotate) or none ends every agent session at once.
 */

/** How far ahead a link may expire: a link is made for one check, at once. */
export const AGENT_LINK_SECONDS = 5 * 60;
/** How long the session a link starts lasts. */
export const AGENT_SESSION_SECONDS = 60 * 60;

/** The choirs a link names, or null when it is not a good, current link. */
export async function readAgentLink(secret: string, token: string | null, now: number): Promise<string[] | null> {
  const value = await readValue(secret, token);
  if (typeof value !== "object" || value === null) return null;
  const { choirs, exp } = value as Record<string, unknown>;
  if (typeof exp !== "number" || exp <= now || exp > now + AGENT_LINK_SECONDS) return null;
  if (!Array.isArray(choirs) || choirs.length === 0) return null;
  if (!choirs.every((c) => typeof c === "string" && c !== "")) return null;
  return choirs as string[];
}

/** The mark an agent session carries: which key let it in, without the key. */
export async function agentKeyMark(secret: string): Promise<string> {
  return (await sign(secret, "agent-session")).slice(0, 16);
}

/** False for an agent session the current key did not start, or when there is no key. */
export async function agentSessionValid(session: Session, secret: string | undefined): Promise<boolean> {
  if (session.agent === undefined) return true;
  return !!secret && session.agentKey === (await agentKeyMark(secret));
}
