# stemmanauhat-cf

The choirs' practice-track player, hosted on Cloudflare. It replaces
[eerovil/stemmanauhat](https://github.com/eerovil/stemmanauhat), where each song was a YouTube video per voice part behind a passphrase.

- **Score:** drawn in the browser from the song's MusicXML, with a cursor that follows the music.
- **Sound:** the same per-part MP3s MuseScore exports today, so playback sounds exactly as before. Your own part is loud and the others are quieter.
- **Login:** Google sign-in with a per-choir email allow-list.
- **Songs:** published by song-app ([eerovil/musescore-choir-plugins](https://github.com/eerovil/musescore-choir-plugins)).

**No data in this repository.** Songs (MusicXML, MP3s, timing files) live in Cloudflare R2. The email allow-lists live in Cloudflare D1. Secrets are Cloudflare secrets. This repo is public and holds code only.

Status: being built; see the open issues.
