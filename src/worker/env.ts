import type { Hosts } from "./origin";

export interface Env extends Hosts {
  DB: D1Database;
  SONGS: R2Bucket;
  ASSETS: Fetcher;
  SESSION_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Signs agents' login links (#79, scripts/agent-login.sh). Unset: there are none. */
  AGENT_LOGIN_SECRET?: string;
  /** Only the tests set these, to reach the fake Google. */
  GOOGLE_AUTH_URL?: string;
  GOOGLE_TOKEN_URL?: string;
}
