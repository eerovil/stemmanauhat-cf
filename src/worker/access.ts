import type { Session } from "./session";

/** What the database says about one visitor and one choir. */
export interface AccessFacts {
  choirExists: boolean;
  choirPublic: boolean;
  /** The test list (#73): admins only. */
  choirStaging: boolean;
  /** The choir's current link generation, or null when link access is off. */
  linkGeneration: number | null;
  isMember: boolean;
  isAdmin: boolean;
}

/**
 * ok: show it. signin: nobody is signed in, send them to sign in.
 * refused: someone is signed in but this choir is not theirs (HTTP 403).
 * unknown: no such choir (HTTP 404).
 */
export type Access = "ok" | "signin" | "refused" | "unknown";

export function decideAccess(session: Session | null, choir: string, facts: AccessFacts): Access {
  if (!facts.choirExists) return "unknown";
  if (facts.choirPublic) return "ok";
  if (session === null) return "signin";
  if (facts.choirStaging) return session.email && facts.isAdmin ? "ok" : "refused";
  if (session.agent?.includes(choir)) return "ok";
  const linked = session.links?.[choir];
  if (linked !== undefined && facts.linkGeneration !== null && linked === facts.linkGeneration) return "ok";
  if (session.email && (facts.isMember || facts.isAdmin)) return "ok";
  return "refused";
}

export async function loadFacts(db: D1Database, session: Session | null, choir: string): Promise<AccessFacts> {
  const email = session?.email ?? "";
  const row = await db.prepare(
    `SELECT c.public AS public, c.staging AS staging,
            (SELECT generation FROM choir_links l WHERE l.choir = c.id AND l.hash IS NOT NULL) AS gen,
            EXISTS (SELECT 1 FROM members m WHERE m.choir = c.id AND m.email = ?2) AS member,
            EXISTS (SELECT 1 FROM admins a WHERE a.email = ?2) AS admin
       FROM choirs c WHERE c.id = ?1`,
  ).bind(choir, email).first<{ public: number; staging: number; gen: number | null; member: number; admin: number }>();
  if (row === null) {
    return { choirExists: false, choirPublic: false, choirStaging: false, linkGeneration: null, isMember: false, isAdmin: false };
  }
  return {
    choirExists: true,
    choirPublic: row.public === 1,
    choirStaging: row.staging === 1,
    linkGeneration: row.gen,
    isMember: email !== "" && row.member === 1,
    isAdmin: email !== "" && row.admin === 1,
  };
}

export async function isAdmin(db: D1Database, session: Session | null): Promise<boolean> {
  // A link session never makes anyone an admin: only a Google email can.
  if (!session?.email) return false;
  const row = await db.prepare("SELECT 1 AS yes FROM admins WHERE email = ?").bind(session.email).first();
  return row !== null;
}
