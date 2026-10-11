// Fresh local D1 and R2 for the browser tests: the migrations, made-up
// members, a passphrase link for jm, the synthetic two-part song uploaded for jm
// (with made-up composer, lyricist and arranger) and for the public demo (a composer only, and once more for jm as Iltalaulu), a synthetic song with one crowded bar for jm, a public one that opens with a very long bar, and a stand-in for the piano (spessasynth's own tiny
// saw-wave sound bank; the real piano is MuseScore's and lives only in R2).
// Run from the repo root.
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { BasicSoundBank } from "spessasynth_core";

export const PASSPHRASE = "testilinkki-jm";
const VERSION = "20261009T120000Z";
const FILES = ["score.musicxml", "timing.json", "manifest.json", "score.mid"];
// Songs published since #36 list part names only; kokeilu and iltalaulu keep the
// older rows' MP3 file names, which must still read.
const PARTS = JSON.stringify([{ name: "Tenori" }, { name: "Basso" }]);
const OLD_PARTS = JSON.stringify([
  { name: "Tenori", file: "parts/1-Tenori.mp3" },
  { name: "Basso", file: "parts/2-Basso.mp3" },
]);
const OLD_ROWS = ["kokeilu", "iltalaulu"];

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
  ["jm", "kokeilu", "Kokeilulaulu", "tests/fixtures/two-part", 8.0, ["Aino Esimerkki", "Eino Runoniekka", "Sulo Sovittaja"]],
  ["public", "esittely", "Esittelylaulu", "tests/fixtures/two-part", 8.0, ["Aino Esimerkki", null, null]],
  ["jm", "epatasainen", "Epätasainen", "tests/fixtures/uneven", 12.0, [null, null, null]],
  // A third jm song, so a setlist has something to leave out (#34).
  ["jm", "iltalaulu", "Iltalaulu", "tests/fixtures/two-part", 8.0, [null, null, null]],
  // A free-rhythm verse written as one bar of 32 quarters (#45).
  ["public", "vapaa-rytmi", "Vapaa rytmi", "tests/fixtures/long-bar", 20.0, [null, null, null]],
];
const value = (text) => (text === null ? "NULL" : `'${text}'`);
const sql = [
  "INSERT INTO members (choir, email, added_at) VALUES ('jm', 'laulaja@example.com', '2026-10-09T00:00:00Z');",
  "INSERT INTO members (choir, email, added_at) VALUES ('naiskuoro', 'laulaja2@example.com', '2026-10-09T00:00:00Z');",
  "INSERT INTO admins (email) VALUES ('yllapito@example.com');",
  `INSERT INTO choir_links (choir, salt, hash, iterations, generation) VALUES ('jm', '${salt.toString("base64url")}', '${await hash(PASSPHRASE, salt)}', 10000, 1);`,
  ...songs.map(([choir, slug, title, , duration, credits]) =>
    `INSERT INTO songs (choir, slug, title, prefix, parts, duration, published_at, composer, lyricist, arranger) VALUES ('${choir}', '${slug}', '${title}', 'songs/${choir}/${slug}/${VERSION}/', '${OLD_ROWS.includes(slug) ? OLD_PARTS : PARTS}', ${duration.toFixed(1)}, '2026-10-09T12:00:00Z', ${credits.map(value).join(", ")});`),
].join("\n");
writeFileSync("tests/fixtures/seed.generated.sql", sql + "\n");
wrangler("d1", "execute", "stemmanauhat", "--local", "--file", "tests/fixtures/seed.generated.sql");

for (const [choir, slug, , fixture] of songs) {
  for (const file of FILES) {
    wrangler("r2", "object", "put", `stemmanauhat/songs/${choir}/${slug}/${VERSION}/${file}`,
      "--local", "--file", `${fixture}/${file}`);
  }
}
writeFileSync(".wrangler/test-piano.sf2", Buffer.from(BasicSoundBank.getSampleSoundBankFile()));
wrangler("r2", "object", "put", "stemmanauhat/sound/piano-1.sf3", "--local", "--file", ".wrangler/test-piano.sf2");
console.log("seeded local D1 and R2");
