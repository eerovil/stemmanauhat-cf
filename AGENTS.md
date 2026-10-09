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
- Playback must sound exactly like the MuseScore per-part MP3s: play those files; don't
  synthesise audio.

## Tests

Every change runs the test suite (`pnpm test`), which must include at least one end-to-end smoke
test: sign-in stubbed, a song's score renders, audio plays, the cursor moves. A build or a linter
alone is not a test. Use the AgentDeck job queue for test runs as the poller brief says.

## Where things are decided

The product decisions (D1–D7) are in the first issue of this repository, moved from
eerovil/stemmanauhat#8. Song publishing is eerovil/musescore-choir-plugins#382.
