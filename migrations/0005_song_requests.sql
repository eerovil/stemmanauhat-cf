-- A singer's request for a new practice track (#38), optionally with the sheet
-- music as a PDF. Every field is optional, but a request has a title or a PDF.
CREATE TABLE song_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  choir TEXT NOT NULL,
  title TEXT,                     -- NULL when only a PDF was sent
  credits TEXT,                   -- composer / arranger, free text
  note TEXT,
  requester TEXT,                 -- Google email, or the name a link visitor typed; NULL if neither
  pdf INTEGER NOT NULL DEFAULT 0, -- 1 when requests/<choir>/<id>.pdf is in R2
  done_at TEXT,                   -- ISO 8601 UTC; NULL while open
  created_at TEXT NOT NULL
);
CREATE INDEX song_requests_choir ON song_requests (choir, created_at);
