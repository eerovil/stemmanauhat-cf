import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? "8787");
const googlePort = port + 1;
const origin = `http://127.0.0.1:${port}`;
const google = `http://127.0.0.1:${googlePort}`;

// Values for the local Worker only. None of these is a real credential.
const vars = {
  SESSION_SECRET: "test-session-secret-not-real",
  GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-not-a-secret",
  GOOGLE_AUTH_URL: `${google}/auth`,
  GOOGLE_TOKEN_URL: `${google}/token`,
};
const varFlags = Object.entries(vars).map(([k, v]) => `--var ${k}:${v}`).join(" ");

/**
 * The browser tests run against a real `wrangler dev` with local D1 and R2,
 * seeded fresh each run with a made-up song, and a fake Google sign-in.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [["list"]],
  use: {
    baseURL: origin,
    trace: "retain-on-failure",
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: `FAKE_GOOGLE_PORT=${googlePort} node tests/support/fake-google.mjs`,
      url: `${google}/health`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      command: `node tests/support/seed.mjs && node_modules/.bin/vite build && node_modules/.bin/wrangler dev --ip 127.0.0.1 --port ${port} ${varFlags}`,
      url: `${origin}/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
