export interface Env {
  DB: D1Database;
  SONGS: R2Bucket;
  ASSETS: Fetcher;
  SESSION_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Only the tests set these, to reach the fake Google. */
  GOOGLE_AUTH_URL?: string;
  GOOGLE_TOKEN_URL?: string;
}
