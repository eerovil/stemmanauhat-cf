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

## Where things are decided

The product decisions (D1–D7) are in the first issue of this repository, moved from
eerovil/stemmanauhat#8. Song publishing is eerovil/musescore-choir-plugins#382.
