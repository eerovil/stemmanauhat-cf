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

1. Save `CLOUDFLARE_API_TOKEN` (Workers, D1 and R2 edit) and `CLOUDFLARE_ACCOUNT_ID` in
   `~/.local/share/stemmanauhat/cloudflare.env`.
2. `./scripts/cloudflare-setup.sh`, then commit the database id it writes into `wrangler.jsonc`.
3. Create a Google OAuth client (web app) with the redirect URI
   `https://stemmanauhat.eerovil.workers.dev/auth/callback`, then `./scripts/push-google-secrets.sh`.
4. `./scripts/add-admin.sh <your email>` and `./scripts/set-passphrase.sh jm` (and `naiskuoro`),
   with today's passphrases so the old links keep working.
5. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub Actions secrets. From then on,
   every merge to `main` tests, migrates and deploys. Until then the deploy job skips itself.

## Moving off YouTube

1. Publish every song in the old lists from song-app (eerovil/musescore-choir-plugins#382).
2. Check each one plays on the new site.
3. Merge eerovil/stemmanauhat#9: the old address becomes a redirect here, and the YouTube
   workflow goes away.
4. Delete the YouTube videos with song-app's "Delete from YouTube".
