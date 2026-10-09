// Fresh local D1 and R2 for the browser tests: the migrations, made-up
// members, a passphrase link for jm, and the synthetic two-part song uploaded
// for jm and for the public demo. Run from the repo root.
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { webcrypto } from "node:crypto";

export const PASSPHRASE = "testilinkki-jm";
const VERSION = "20261009T120000Z";
const FIXTURE = "tests/fixtures/two-part";
const FILES = ["score.musicxml", "timing.json", "manifest.json", "parts/1-Tenori.mp3", "parts/2-Basso.mp3"];
const PARTS = JSON.stringify([
  { name: "Tenori", file: "parts/1-Tenori.mp3" },
  { name: "Basso", file: "parts/2-Basso.mp3" },
]);

const wrangler = (...args) => execFileSync("node_modules/.bin/wrangler", args, { stdio: ["ignore", "ignore", "inherit"] });

async function hash(passphrase, salt) {
  const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveBits"]);
  const bits = await webcrypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 10000 }, key, 256);
  return Buffer.from(bits).toString("base64url");
}

rmSync(".wrangler/state", { recursive: true, force: true });
wrangler("d1", "migrations", "apply", "stemmanauhat", "--local");

const salt = Buffer.from("fixed-test-salt!");
const songs = [
  ["jm", "kokeilu", "Kokeilulaulu"],
  ["public", "esittely", "Esittelylaulu"],
];
const sql = [
  "INSERT INTO members (choir, email, added_at) VALUES ('jm', 'laulaja@example.com', '2026-10-09T00:00:00Z');",
  "INSERT INTO members (choir, email, added_at) VALUES ('naiskuoro', 'laulaja2@example.com', '2026-10-09T00:00:00Z');",
  "INSERT INTO admins (email) VALUES ('yllapito@example.com');",
  `INSERT INTO choir_links (choir, salt, hash, iterations, generation) VALUES ('jm', '${salt.toString("base64url")}', '${await hash(PASSPHRASE, salt)}', 10000, 1);`,
  ...songs.map(([choir, slug, title]) =>
    `INSERT INTO songs (choir, slug, title, prefix, parts, duration, published_at) VALUES ('${choir}', '${slug}', '${title}', 'songs/${choir}/${slug}/${VERSION}/', '${PARTS}', 8.0, '2026-10-09T12:00:00Z');`),
].join("\n");
writeFileSync("tests/fixtures/seed.generated.sql", sql + "\n");
wrangler("d1", "execute", "stemmanauhat", "--local", "--file", "tests/fixtures/seed.generated.sql");

for (const [choir, slug] of songs) {
  for (const file of FILES) {
    wrangler("r2", "object", "put", `stemmanauhat/songs/${choir}/${slug}/${VERSION}/${file}`,
      "--local", "--file", `${FIXTURE}/${file}`);
  }
}
console.log("seeded local D1 and R2");
