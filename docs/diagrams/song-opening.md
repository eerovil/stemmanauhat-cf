# Opening a song

How the song page loads a song and draws its score. Since #137 all downloads start together, the score file arrives compressed, and in the one-line view the score is laid out once with bar widths saved on the server, instead of up to three times.

```mermaid
flowchart TD
  A[Song page opens] --> B[Song info from /api/songs<br/>incl. saved bar widths]
  B --> C[Start every download at once]
  C --> D[score.musicxml<br/>gzip-compressed]
  C --> E[timing.json]
  C --> F[score.mid + piano sound]
  C --> G[score drawing code]
  F --> H[Piano ready: play works]
  D --> I[Read the score]
  G --> I
  I --> J{One-line view?}
  J -- No --> K[Lay out once]
  J -- Yes --> L{Saved widths for<br/>this version and parts?}
  L -- Yes --> M[Lay out once with saved widths]
  L -- No --> N[Lay out, then widen bars<br/>up to 2 more layouts]
  M --> O{Bars even<br/>within 5 %?}
  O -- Yes --> P[Score shown]
  O -- No --> S[Drop the saved widths]
  S --> N
  N --> R{Does the server already hold<br/>what the next opening keeps?}
  R -- No --> Q[Save the widths to the server<br/>or all ones if they would not be kept]
  R -- Yes --> P
  Q --> P
  K --> P
  class C,D,G,M,O,Q,L,R,S teal
  class H,P green
  class N amber
```

## Colours
- **teal**: new or changed by #137
- **amber**: the slow path: a song version's first opening, or a saved set that came out uneven
- **green**: what the singer is waiting for

## Boxes
- **Song info from /api/songs<br/>incl. saved bar widths**: `song()` in `src/worker/index.ts` adds the row from the new `song_layouts` table for this song's version.
- **Start every download at once**: `onMounted` in `src/client/views/Player.vue`: the score file, the timing file and the piano start together in one `Promise.all`, so the piano no longer waits for the score.
- **score.musicxml<br/>gzip-compressed**: `serveObject` in `src/worker/files.ts` marks whole MusicXML and JSON responses `Content-Encoding: gzip` and Cloudflare compresses them (8.2 MB → about 0.27 MB for Katedralen).
- **Lay out once with saved widths**: `Score.evenOut` in `src/client/player/score.ts` applies the saved `WidthFactor` per bar before the first layout.
- **Bars even<br/>within 5 %?**: `evenOut` in `src/client/player/score.ts` keeps a saved set whose biggest step between bars (`biggestStep`, `spacing.ts`) is at most 5 % over the cap; otherwise it drops them.
- **Drop the saved widths**: `evenOut` resets every bar to factor 1 and lays the score out again, so widening starts from the song's own widths and a wrong set's over-wide bar does not spread to its neighbours.
- **Does the server already hold<br/>what the next opening keeps?**: `evenOut` compares the saved set with what it would store (`sameFactors`): the widths if `keepable` would keep them next time, otherwise all ones (the song's own layout, treated as no set). A song that was even with no saved set saves nothing. So a wrong set costs one extra layout once (at most 4 in all), and is then replaced.
- **Save the widths to the server<br/>or all ones if they would not be kept**: `Score.onFactors`, then a new `PUT /api/songs/<choir>/<slug>/layout` in `src/worker/index.ts`, open to anyone who may open the song except on the open list (`public`); `parseLayout` in `src/worker/layouts.ts` checks the numbers (each factor 1–10, at most 32 parts). Stored in D1 `song_layouts` (`migrations/0010_song_layouts.sql`).
