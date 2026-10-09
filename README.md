# stemmanauhat-cf

The choirs' practice-track player, hosted on Cloudflare. It replaces
[eerovil/stemmanauhat](https://github.com/eerovil/stemmanauhat), where each song was a YouTube video per voice part behind a passphrase.

- **Score:** drawn in the browser from the song's MusicXML, with a cursor that follows the music.
- **Sound:** the same per-part MP3s MuseScore exports today, so playback sounds exactly as before. Your own part is loud and the others are quieter.
- **Login:** Google sign-in with a per-choir email allow-list.
- **Songs:** published by song-app ([eerovil/musescore-choir-plugins](https://github.com/eerovil/musescore-choir-plugins)).

**No data in this repository.** Songs (MusicXML, MP3s, timing files) live in Cloudflare R2. The email allow-lists live in Cloudflare D1. Secrets are Cloudflare secrets. This repo is public and holds code only.

Live address (once set up): https://stemmanauhat.eerovil.workers.dev

## How it works

- **Who gets in:** a Google account on the choir's email list, or a browser that opened the choir's
  old link (`/?user=jm&passphrase=...`). The old link is checked against a hash in D1 and then
  removed from the address bar. `public` is open to everyone. Admins manage the lists and the
  passphrases at `/admin`.
- **Songs:** song-app writes each version to R2 under `songs/<choir>/<slug>/<version>/` and points
  a D1 `songs` row at it. The format is in song-app's `docs/stemmanauhat-site.md`.
- **Player:** the score is drawn by OpenSheetMusicDisplay. Each part's MP3 streams in its own
  `<audio>` element, mixed through Web Audio: your part at full volume, the others at the videos'
  level (MuseScore 36/127, a gain of 0.08) or wherever the slider puts them. `timing.json` moves the
  cursor. Tempo uses the browser's pitch-keeping playback rate.

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
4. `./scripts/add-admin.sh <your Google email>`, sign in, and set each choir's passphrase at
   `/admin` (or with `./scripts/set-passphrase.sh jm`) to today's, so the old links keep working.

## Moving off YouTube

1. Publish every song in the old lists from song-app (eerovil/musescore-choir-plugins#382).
2. Check each one plays on the new site.
3. Merge eerovil/stemmanauhat#9: the old address becomes a redirect here, and the YouTube
   workflow goes away.
4. Delete the YouTube videos with song-app's "Delete from YouTube".
