# Agent guide — stemmanauhat-cf

The choirs' practice-track player on Cloudflare (Workers with static assets, R2 for song files,
D1 for the per-choir email allow-lists, Google sign-in). Read README.md first.

## Hard rules

- **This repository is public. Never commit data**: no song files (MusicXML, MP3, MIDI, timing),
  no member emails or names, no choir passphrases, no exports of R2 or D1 contents. Test fixtures
  are synthetic: a made-up two-part song and `@example.com` addresses.
- **Never commit secrets.** Google OAuth client secret, session keys and Cloudflare API tokens are
  Cloudflare secrets (`wrangler secret put`) or local `.dev.vars` (git-ignored).
- **A merge to `main` deploys the live site.** Keep `main` deployable, and never deploy by hand
  from a branch.
- Playback is the song's MIDI (the one MuseScore exports, `score.mid`) played with MuseScore's
  own grand piano (MuseScore_General preset 0, made by `scripts/make-piano-soundfont.mjs`, served
  from R2 at `/sound/piano-1.sf3`). Eero chose this on 2026-10-09 over the per-part MP3s, which
  drifted apart and crackled on Android: keep one synth clock for all parts, and don't swap the
  piano for another sound without asking him. The soundfont is never committed (15 MB); tests use
  spessasynth's tiny built-in sound bank.
- **Sung parts are an option, not a replacement.** A song published with a sung MP3 per part
  (`parts/<n>-<Name>.mp3` from a bundle whose manifest says `"sung": true`, listed with
  `"sung": true`; rows from before #36 list piano MP3s under the same names, which are not
  singing; AI-sung with the REMY DiffSinger voice) offers "Ääni: Piano / Laulu" in
  Säädöt; the piano stays the default and the choice carries from song to song (Eero, 2026-10-13).
  The sung parts play on one Web Audio clock (`player/sung.ts`). Each voice's terms require a credit:
  keep "Ääni: <voice>, <its makers>" (`sungCredit`, `VOICE_CREDITS` in `api.ts`; REMY for the men's
  songs, LYSE for the women's, named per song by the manifest's `"voice"`; a mixed choir's parts name
  their own, `{"name": "Tenori", "voice": "REMY"}` in `manifest.parts`, and the credit names every voice that sings) visible whenever the sung parts play (it is in
  the dock's info, under the bar and time).
  The sung parts can be balanced by pitch, louder below the middle of the moment and quieter above
  it (`player/balance.ts`, #117), but it is off by default (0 dB per octave): with better headphones
  Eero found the parts in balance as recorded (2026-10-22). Säädöt's closed "Lisäasetukset" holds
  "Muut stemmat" on every song and, on a sung song, that amount and the middle (carried from song
  to song) and each sung part's own volume (kept per song). The piano plays every note as written.

- **Where a new part name goes in the voice tree** (#107) is the person publishing's call. When
  `scripts/publish-songs.sh` stops on part names not in the tree, ask Eero where each one goes
  and publish again with his `--place` answers; never guess a place.

- **Usage events** (eerovil/eeron-omat-taskit#72) are the `events` table: who listened to what,
  for how long and with which settings (README, "Usage events"). It holds members' emails, so
  never commit rows from it. Read it with `./scripts/run.sh --cloudflare corepack pnpm exec
  wrangler d1 execute stemmanauhat --remote --json --command "SELECT ... FROM events"`.

## Tests

Run everything through `./scripts/run.sh` (there is no node on the host); the suite is
`./scripts/run.sh corepack pnpm test`. Screenshots for a pull request:
`./scripts/run.sh env SCREENSHOTS_DIR=test-results/shots corepack pnpm exec playwright test screenshots`.

Every change runs the test suite (`pnpm test`), which must include at least one end-to-end smoke
test: sign-in stubbed, a song's score renders, audio plays, the cursor moves. A build or a linter
alone is not a test. Use the AgentDeck job queue for test runs as the poller brief says.

- Run the whole unit and end-to-end suite before the first push, and grep the tests for every
  string your change alters.
- Copy screenshots out of `test-results/` before the next Playwright run, because the run wipes it
  (`test-results/shots` included). Check that each file is non-empty before uploading.
- Set a free `PLAYWRIGHT_PORT` (default 8787) when another checkout holds the default port, and
  still run the test locally. Never leave a new browser test to CI as its first run.

## Checking the live site as a singer

The live site needs a Google sign-in, so an agent checks it with a login link
only this host can make (#79):

    ./scripts/agent-login.sh jm --next /c/jm/<song>

It prints a link that works for 5 minutes. Open it in Playwright inside `./scripts/run.sh`.
The session it starts lasts an hour and may open only the choirs named. It can never open
the test list or `/admin`, and it cannot send anything (song requests, flags, admin
changes): every POST is a 403. The key is the Worker secret `AGENT_LOGIN_SECRET`. Its only
other copy is `~/.local/share/stemmanauhat/agent-login.key` on this host, never in the
repository. Never paste a link into an issue, a pull request or a log you post.
`--rotate` makes a new key and ends every link and agent session already made.

## Working a singer's flag

A flag's `part` (`song_requests.part`) is the part the singer sings, not the part at fault:
compare all parts at the flagged bar. Check `songs.published_at` too: a republish after the flag
may already have fixed it.

## Publishing a JOY song

Every `joy-alumnit` song is on `joy` too; a new `joy` song is not on `joy-alumnit`
(eerovil/eeron-omat-taskit#101). `scripts/publish-songs.sh` (sing-song) and the test list's
"Siirrä…" keep that. song-app's own Publish panel does not: it publishes to one list and takes the
song off the other. Never publish a `joy` or `joy-alumnit` song with the panel; use sing-song or
`publish-songs.sh` (Eero, 2026-10-21).

## Where things are decided

The product decisions (D1–D7) are in the first issue of this repository, moved from
eerovil/stemmanauhat#8. Song publishing is eerovil/musescore-choir-plugins#382.
