# stemmanauhat-cf

The choirs' practice-track player, hosted on Cloudflare. It replaces
[eerovil/stemmanauhat](https://github.com/eerovil/stemmanauhat), where each song was a YouTube video per voice part behind a passphrase.

- **Score:** drawn in the browser from the song's MusicXML, with a cursor that follows the music.
- **Sound:** the song's MIDI from MuseScore, played in the browser with MuseScore's own grand piano. Every part runs on one clock, so they stay exactly together; your own part is loud and the others are quieter.
- **Login:** Google sign-in with a per-choir email allow-list.
- **Songs:** published by song-app ([eerovil/musescore-choir-plugins](https://github.com/eerovil/musescore-choir-plugins)).

**No data in this repository.** Songs (MusicXML, MIDI, timing files) live in Cloudflare R2. The email allow-lists live in Cloudflare D1. Secrets are Cloudflare secrets. This repo is public and holds code only.

This copy: https://stemmanauhat.vilpponen.fi (also https://stemmanauhat.eerovil.workers.dev). To run
a copy of your own for your choirs, see [Run your own copy](#run-your-own-copy).

## How it works

- **Who gets in:** a Google account on the choir's email list, or a browser that opened the choir's
  old link (`/?user=jm&passphrase=...`). The old link is checked against a hash in D1 and then
  removed from the address bar. `public` is open to everyone. Admins manage the lists and the
  passphrases at `/admin`.
- **Songs:** song-app writes each version to R2 under `songs/<choir>/<slug>/<version>/` and points
  a D1 `songs` row at it. The format is in song-app's `docs/stemmanauhat-site.md`.
  One song can be on several lists with one copy of its files (#104):
  `./scripts/publish-songs.sh jm,public <bundle>` uploads them once, under the first list's folder,
  and points each list's row at them. Publishing takes the song off any private list not named;
  `public` and `testi` keep theirs. A private list whose row points at the same files as a named
  list's keeps the song too, with the new version, so fixing a JOY-kuoro song keeps it on
  JOY-alumnit. Every JOY-alumnit song is on JOY-kuoro's list too, but a new JOY-kuoro song is not
  on the alumni's (eerovil/eeron-omat-taskit#101): publishing or moving a song to `joy-alumnit`
  puts it on `joy` as well (`ALSO_ON`). song-app's own Publish panel does not do that yet: publish a song that is on several
  lists with sing-song or `publish-songs.sh`. `scripts/merge-duplicate-songs.mjs` turned the earlier copies
  into one.
- **Test list:** `testi` ("Testilista", D1 `choirs.staging = 1`) is where a new song is tried out
  before a choir gets it. Only admins open it: it has no members, link, requests or flags. song-app
  publishes there like to any choir; on the list an admin picks "Siirrä…" and a choir, and the song
  moves: its files are copied to the choir's folder, it replaces a song of the same name there, and
  it leaves the test list.
- **Setlists:** a choir's named song lists in their own order, such as a concert's program (D1
  `setlists`). Singers pick one from the song list's dropdown and see only its songs, numbered;
  admins make and change them on the same page ("Uusi setlista", "Muokkaa").
- **Requests:** on a choir's song list, anyone in the choir can ask for a new practice track
  ("Pyydä stemmanauhaa"): a song name or the sheet music as a PDF, or both, and optionally who wrote
  it and a note. Everyone in the choir sees the open requests, without who sent them. Admins see who
  sent each one, open its PDF and mark it done or delete it at `/admin`. The rows are in D1
  `song_requests`; the PDFs are in R2 under `requests/<choir>/` and only admins can get them.
- **Flags:** in a private choir's player, Säädöt → "Ilmoita virheestä" lets a singer say what is
  wrong with the score (wrong note or part, lyrics, timing, sound), at which bar, with a note. A flag
  is a `song_requests` row with `song` set: it shows in that song's Säädöt for every singer, without
  who sent it, and in the admin's "Pyynnöt" list, where it is marked done or deleted like a request.
- **Player:** the score is drawn by OpenSheetMusicDisplay with the videos' blue for the notes being
  sung and their translucent cursor band. "Kaikki" shows every staff that fits on one line sliding
  sideways under a fixed cursor (drag it to move); "Oma" shows your own staff alone in page lines.
  One bottom bar: back, the song with its bar number (tap to jump to a bar), your part (tap to
  change), play, and Säädöt: how you listen (Oma esillä / Tasan / Ilman omaa / Vain oma), the other
  parts' level, tempo, score size and staves. Tapping the score plays or pauses. Your part is
  remembered per song; how you listen, the tempo, the staves and the size carry from song to song.
  The size is a fixed staff height on the device, whatever the song or the view.
  A very long bar (a free-rhythm verse written as one bar) is drawn cut into pieces of about a
  4/4 bar with invisible bar lines, so it wraps over lines (`player/split.ts`).
  `score.mid` is played by spessasynth (an AudioWorklet synth) with MuseScore's grand piano: each
  part's MIDI channel has its own gain, then +15 dB and a limiter. `timing.json` (from the same
  MIDI clock) moves the cursor.
  A song published with a sung MP3 per part (AI-sung: REMY for men's parts, LYSE for women's) also offers "Ääni: Laulu"
  in Säädöt: all its parts then play from those files on one Web Audio clock, at any tempo
  without changing the pitch. The piano stays the default; the choice carries from song to song.
  A note several parts start together is sung once (#76), but only where they sing it on the same
  syllable: the bundle's `words.json` (sing-song, eeron-omat-taskit#110) lists each part's
  [seconds, key, syllable] per note. A song without it merges every such note, as before.
- **App:** the site installs to a phone's home screen ("Lisää aloitusnäytölle" / "Asenna sovellus"):
  `public/manifest.webmanifest` and the icons drawn from `public/icon.svg` by
  `scripts/make-pwa-icons.mjs`. `public/sw.js` only shows an offline page when there is no network;
  it caches the icons and that page, never a song, a page or the API, so access checks and new
  versions work as before.

### Part names

A singer's part carries from song to song: the player starts each song on the part they last
picked in that choir. Songs name and divide their parts differently ("Basso 2", "Basso", "Bass",
"B2"), so the `voices` table in D1 (#107) holds a tree of voices: group (Naiset, Miehet), voice
(Basso), divided part (Basso 2) and its upper or lower half (Upper bass 2), at most four levels.
Each place lists every name it goes by, compared ignoring letter case and spaces, and has
its own name in Finnish and English (`name_fi`, `name_en`): the part picker and the player show
that one, so "B2", "Bass 2" and "Basso 2" all read "Basso 2" ("Bass 2" in English). Renaming a
place renames it in every song, with no republishing. A name not in the tree shows as the
song has it. A remembered
part that the song doesn't have falls back to the nearest place above it that it has, never
down or sideways; a name not in the tree ("Tenori solo") matches only itself, and a name ending
in "b" ("S1b") sits just below the name without it. Publishing with `scripts/publish-songs.sh`
stops on a part name in no place and not listed in `unplaced_parts` (solos, trios), before
anything goes up, and lists the places: the person publishing says where each one goes, and
it goes in with the song (`--place "Bassi=B"` a name of an existing place, `--place "Basso
4=B4@B"` a new place under one, `--place "Kertoja=-"` in no place). To change the tree by hand,
edit the table, no code change needed:

    ./scripts/run.sh --cloudflare corepack pnpm exec wrangler d1 execute stemmanauhat --remote \
      --command "UPDATE voices SET names = json_insert(names, '\$[#]', 'Bassi') WHERE id = 'B'"

A place made by `--place` shows as the name it was made for, in both languages, until renamed
(`UPDATE voices SET name_en = 'Bass 4' WHERE id = 'B4'`).

### Usage events

To see whether singers find the singing and which settings they use
(eerovil/eeron-omat-taskit#72), the player sends a few events to `/api/events`:
opening a song, opening Säädöt, choosing Piano or Laulu, each settings change
(sliders once, with the value they end on), and every listen of 3 seconds or
more, with its length, the sound and the six settings it played with. A listen
still playing is saved again each minute. They go to the `events` table in D1
with the signed-in Google email, or for anyone without one only a random id
the device keeps; no IP. Admins' own visits are kept, marked, and left out of the
counts. The admin page shows the last 30 days and the latest 50 listens, and
deletes events over a year old. Nothing is shown to singers about it.

The song list's notice that the site can be installed as an app (#91) sends
`install_shown`, `install_dismiss` and `install_accept`, and the installed app sends
`app_open` once per visit (iPhones never say they installed); the admin page counts
who saw the notice and who installed or used the app. The notice shows on at most
three song list pages, and never again once dismissed or installed.

## Running it

With Node 22 or newer:

```sh
corepack pnpm install
corepack pnpm test        # typecheck, unit tests, browser tests (after: corepack pnpm exec playwright install)
corepack pnpm dev         # http://127.0.0.1:8787; needs .dev.vars with SESSION_SECRET etc.
```

This copy's host has no node, so there everything runs in the Playwright container:

```sh
./scripts/run.sh corepack pnpm install
./scripts/run.sh corepack pnpm test
./scripts/run.sh --serve corepack pnpm dev
```

The scripts that talk to Cloudflare (`cloudflare-setup.sh`, `set-worker-secrets.sh`,
`add-choir.sh`, `add-admin.sh`, `set-passphrase.sh`, `upload-piano.sh`) run wrangler with node
when there is one, and through `run.sh` when there is not. They read the account's
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from `~/.local/share/stemmanauhat/cloudflare.env`,
or from the file `STEMMANAUHAT_CLOUDFLARE_ENV=<file>` names. Keep that file outside the repo.

## Run your own copy

The site runs on a free Cloudflare account. You need Node 22 or newer (or podman), a GitHub
account and a Google account. The choir app (song-app, in
[eerovil/musescore-choir-plugins](https://github.com/eerovil/musescore-choir-plugins)) publishes
the songs into your copy once step 9 is done.

1. **Fork** this repository on GitHub and clone your fork. In the fork's Actions tab, turn
   workflows on. Run `corepack pnpm install`.
2. **A Cloudflare API token.** In the Cloudflare dashboard, My Profile → API Tokens → Create
   Token, with *Account → Workers Scripts: Edit*, *D1: Edit* and *Workers R2 Storage: Edit* (R2
   must be turned on for the account once, under R2). Put it and the account id in a file outside
   the repo:

   ```sh
   CLOUDFLARE_API_TOKEN=...
   CLOUDFLARE_ACCOUNT_ID=...
   ```

   at `~/.local/share/stemmanauhat/cloudflare.env`, or anywhere with
   `export STEMMANAUHAT_CLOUDFLARE_ENV=<file>`.
3. **`./scripts/cloudflare-setup.sh`.** It creates the D1 database and the R2 bucket, writes the
   database id into `wrangler.jsonc`, applies the migrations and asks for your choirs: an id
   (small letters, digits and dashes, used in `/c/<id>`) and a name for each. It is safe to run
   again. Then edit `vars` in `wrangler.jsonc`: `WORKER_HOST` is
   `stemmanauhat.<your subdomain>.workers.dev` (the subdomain is under Workers & Pages in the
   dashboard), and remove `PUBLIC_HOST` unless a proxy of your own serves the site under another
   name. Commit `wrangler.jsonc`.

   The first migration also made this copy's sample choirs `jm` and `naiskuoro`. Delete them on
   yours (`corepack pnpm exec wrangler` instead of `wrangler` below, or `./scripts/run.sh
   --cloudflare corepack pnpm exec wrangler` without node):

   ```sh
   wrangler d1 execute stemmanauhat --remote --command "DELETE FROM choirs WHERE id IN ('jm', 'naiskuoro')"
   ```

   Keep `public`: it is the list open to everyone, and song-app treats it as that. Give it your
   own name with `UPDATE choirs SET name = '...' WHERE id = 'public'`. More choirs later:
   `./scripts/add-choir.sh <id> "<name>"`.
4. **GitHub Actions secrets.** In the fork's Settings → Secrets and variables → Actions, add
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (the same values as in the file). Until then
   the deploy job skips itself.
5. **The first deploy:** push or merge the `wrangler.jsonc` change to `main`. CI tests, migrates,
   deploys and checks `https://<WORKER_HOST>/health`. It warns that the Worker has no secrets yet.
6. **A Google OAuth client.** In the Google Cloud console, APIs & Services → Credentials → Create
   credentials → OAuth client ID, type *Web application*, with the authorized redirect URI
   `https://<WORKER_HOST>/auth/callback` (and `https://<PUBLIC_HOST>/auth/callback` if you set one).
7. **`./scripts/set-worker-secrets.sh`.** It makes `SESSION_SECRET` and asks for the client id and
   secret from step 6. Optional: `./scripts/agent-login.sh --setup` makes `AGENT_LOGIN_SECRET`,
   so this host can make short read-only singer login links for agents (see AGENTS.md).
8. **`./scripts/add-admin.sh <your Google email>`.** Sign in at `https://<WORKER_HOST>/admin`, add
   each choir's members or make its link there.
9. **The choir app.** song-app's `.env` needs three values for your copy:
   - `CLOUDFLARE_ACCOUNT_ID`: the same account id;
   - `CLOUDFLARE_API_TOKEN`: a token with *D1: Edit* and *Workers R2 Storage: Edit* (the one from
     step 2 works; a separate one without Workers is safer);
   - `STEMMANAUHAT_D1_DATABASE_ID`: the `database_id` in your `wrangler.jsonc`.

   Its Publish panel then lists your choirs, read from D1.

## This copy

eerovil's copy runs in the ruokalista Cloudflare account. The D1 database `stemmanauhat` and the
R2 bucket `stemmanauhat` are there, the credentials are in `~/.local/share/stemmanauhat/cloudflare.env`
on the host, and the GitHub Actions secrets are set. The VPS proxies `stemmanauhat.vilpponen.fi`
to the Worker (`PUBLIC_HOST`), so the Google client needs both names'
`/auth/callback`. Its choirs are `jm`, `naiskuoro`, `joy` (JOY-kuoro) and `joy-alumnit` (JOY-alumnit,
its former singers, with JOY's songs on the same files), `laurille` (Laurille) and `yl` (YL), and old-site links keep working with the
passphrase set by `./scripts/set-passphrase.sh jm`; `/admin` cannot show that link, and "Tee uusi
linkki" replaces it.

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
