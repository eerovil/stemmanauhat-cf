-- The choirs. Names are public; who is in them is not, and lives only in D1.
CREATE TABLE choirs (
  id TEXT PRIMARY KEY,          -- jm | naiskuoro | public
  name TEXT NOT NULL,
  public INTEGER NOT NULL DEFAULT 0
);
INSERT INTO choirs (id, name, public) VALUES
  ('jm', 'Joensuun Mieslaulajat', 0),
  ('naiskuoro', 'Naiskuoro', 0),
  ('public', 'Esittely', 1);

-- What song-app publishes (eerovil/musescore-choir-plugins docs/stemmanauhat-site.md).
-- song-app also runs this exact CREATE TABLE IF NOT EXISTS; keep the two the same.
CREATE TABLE IF NOT EXISTS songs (
  choir TEXT NOT NULL,          -- jm | naiskuoro | public
  slug TEXT NOT NULL,
  title TEXT NOT NULL,          -- the song's display name
  prefix TEXT NOT NULL,         -- R2 prefix of the current version, ends in "/"
  parts TEXT NOT NULL,          -- JSON, the manifest's "parts"
  duration REAL NOT NULL,       -- seconds
  published_at TEXT NOT NULL,   -- ISO 8601 UTC
  PRIMARY KEY (choir, slug)
);

-- The allow-lists: Google accounts, by lower-case email.
CREATE TABLE members (
  choir TEXT NOT NULL,
  email TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (choir, email)
);

CREATE TABLE admins (
  email TEXT PRIMARY KEY
);

-- The old passphrase links (?user=jm&passphrase=...). Only a PBKDF2 hash is kept.
-- generation goes up on every change, and link sessions carry it, so changing
-- or turning off a passphrase signs out every browser that came in by link.
CREATE TABLE choir_links (
  choir TEXT PRIMARY KEY,
  salt TEXT,                    -- base64url; NULL when link access is off
  hash TEXT,                    -- base64url PBKDF2-SHA256; NULL when off
  iterations INTEGER NOT NULL DEFAULT 10000,
  generation INTEGER NOT NULL DEFAULT 1
);

-- Wrong passphrases, for the 10-per-hour limit per address.
CREATE TABLE link_attempts (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL           -- Unix seconds
);
CREATE INDEX link_attempts_ip ON link_attempts (ip, at);
