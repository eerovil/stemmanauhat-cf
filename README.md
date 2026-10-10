# stemmanauhat-cf

The choirs' practice-track player, hosted on Cloudflare. It replaces
[eerovil/stemmanauhat](https://github.com/eerovil/stemmanauhat), where each song was a YouTube video per voice part behind a passphrase.

- **Score:** drawn in the browser from the song's MusicXML, with a cursor that follows the music.
- **Sound:** the song's MIDI from MuseScore, played in the browser with MuseScore's own grand piano. Every part runs on one clock, so they stay exactly together; your own part is loud and the others are quieter.
- **Login:** Google sign-in with a per-choir email allow-list.
- **Songs:** published by song-app ([eerovil/musescore-choir-plugins](https://github.com/eerovil/musescore-choir-plugins)).

**No data in this repository.** Songs (MusicXML, MIDI, timing files) live in Cloudflare R2. The email allow-lists live in Cloudflare D1. Secrets are Cloudflare secrets. This repo is public and holds code only.

Live address (once set up): https://stemmanauhat.eerovil.workers.dev

## How it works

- **Who gets in:** a Google account on the choir's email list, or a browser that opened the choir's
  old link (`/?user=jm&passphrase=...`). The old link is checked against a hash in D1 and then
  removed from the address bar. `public` is open to everyone. Admins manage the lists and the
  passphrases at `/admin`.
- **Songs:** song-app writes each version to R2 under `songs/<choir>/<slug>/<version>/` and points
  a D1 `songs` row at it. The format is in song-app's `docs/stemmanauhat-site.md`.
- **Player:** the score is drawn by OpenSheetMusicDisplay with the videos' blue for the notes being
  sung and their translucent cursor band. "Kaikki" shows every staff that fits on one line sliding
  sideways under a fixed cursor (drag it to move); "Oma" shows your own staff alone in page lines.
  One bottom bar: back, the song with its bar number (tap to jump to a bar), your part (tap to
  change), play, and Säädöt: how you listen (Oma esillä / Tasan / Ilman omaa / Vain oma), the other
  parts' level, tempo, score size and staves. Tapping the score plays or pauses. Your part is
  remembered per song; how you listen, the tempo, the staves and the size carry from song to song.
  The size is a fixed staff height on the device, whatever the song or the view.
  `score.mid` is played by spessasynth (an AudioWorklet synth) with MuseScore's grand piano: each
  part's MIDI channel has its own gain, then +15 dB and a limiter. `timing.json` (from the same
  MIDI clock) moves the cursor.
- **App:** the site installs to a phone's home screen ("Lisää aloitusnäytölle" / "Asenna sovellus"):
  `public/manifest.webmanifest` and the icons drawn from `public/icon.svg` by
  `scripts/make-pwa-icons.mjs`. `public/sw.js` only shows an offline page when there is no network;
  it caches the icons and that page, never a song, a page or the API, so access checks and new
  versions work as before.

## Running it

There is no node on the host, so everything runs in the Playwright container:

```sh
./scripts/run.sh corepack pnpm install
./scripts/run.sh corepack pnpm test        # typecheck, unit tests, browser tests
./scripts/run.sh --serve corepack pnpm dev # needs .dev.vars with SESSION_SECRET etc.
```

## Setting up Cloudflare (once)

Done already: the D1 database `stemmanauhat` and the R2 bucket `stemmanauhat` exist in the
ruokalista Cloudflare account, with the migrations applied (`scripts/cloudflare-setup.sh`, which is
safe to run again). The credentials are in `~/.local/share/stemmanauhat/cloudflare.env`.

Still to do:

1. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub Actions secrets (the same
   values as in that file). Until then the deploy job skips itself.
2. Merge to `main`: CI tests, migrates and deploys.
3. Create a Google OAuth client (web app) with the redirect URI
   `https://stemmanauhat.eerovil.workers.dev/auth/callback`, then run
   `./scripts/set-worker-secrets.sh`, which also creates `SESSION_SECRET`.
4. `./scripts/add-admin.sh <your Google email>`, sign in, and make each choir's link at `/admin`.
   To keep the old site's links working instead, set the old passphrase with
   `./scripts/set-passphrase.sh jm`; `/admin` cannot show that link, and "Tee uusi linkki" replaces it.
   Anyone who opens a choir's link gets its songs at once, and signing in with Google from the
   offer on the song list makes their Google account a member.

## Publishing songs by hand

Until song-app's own publish uploads `score.mid`, songs go up in two steps. First build each
song's bundle with song-app's own code, on the host where song-app and MuseScore live:

```sh
<song-app>/.venv/bin/python scripts/song-app-bundle.py <song-app> /tmp/bundles <slug> ...
```

Each `/tmp/bundles/<slug>/` then holds `manifest.json`, `score.musicxml`, `score.mid`,
`timing.json` and `parts/`. Then upload them:

```sh
./scripts/publish-songs.sh public /tmp/bundles/<slug> ...          # the live site
./scripts/publish-songs.sh --local public /tmp/bundles/<slug> ...  # the local one
```

It writes the same R2 layout and D1 row as song-app. One process uploads the whole run, a few
files at a time, so a song takes a few seconds; a song whose upload fails is left out and named
at the end, and the others still go up. Only public-domain songs go in `public`
(every composer, lyricist, translator and arranger died over 70 years ago).

## The piano

`scripts/make-piano-soundfont.mjs` cuts MuseScore's `MuseScore_General.sf3` (MIT licensed, inside
MuseScore 3) down to the grand piano, and `scripts/upload-piano.sh` puts it in R2 as
`sound/piano-1.sf3` (done for the live bucket on 2026-10-09). A new piano needs a new name.

## Moving off YouTube

1. Publish every song in the old lists from song-app (eerovil/musescore-choir-plugins#382).
2. Check each one plays on the new site.
3. Merge eerovil/stemmanauhat#9: the old address becomes a redirect here, and the YouTube
   workflow goes away.
4. Delete the YouTube videos with song-app's "Delete from YouTube".
