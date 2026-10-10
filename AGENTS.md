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

## Tests

Run everything through `./scripts/run.sh` (there is no node on the host); the suite is
`./scripts/run.sh corepack pnpm test`. Screenshots for a pull request:
`./scripts/run.sh env SCREENSHOTS_DIR=test-results/shots corepack pnpm exec playwright test screenshots`.

Every change runs the test suite (`pnpm test`), which must include at least one end-to-end smoke
test: sign-in stubbed, a song's score renders, audio plays, the cursor moves. A build or a linter
alone is not a test. Use the AgentDeck job queue for test runs as the poller brief says.

## Where things are decided

The product decisions (D1–D7) are in the first issue of this repository, moved from
eerovil/stemmanauhat#8. Song publishing is eerovil/musescore-choir-plugins#382.
