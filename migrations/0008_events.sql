-- Usage events (eerovil/eeron-omat-taskit#72): do singers find the singing, and
-- which settings do they use? Rows older than a year are deleted when the admin
-- page loads. Admins' rows are kept, marked, and left out of counts.
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,                 -- ISO 8601 UTC
  visitor TEXT NOT NULL,            -- a random id this device keeps in localStorage
  email TEXT,                       -- the session's Google email; NULL for a link visitor
  admin INTEGER NOT NULL DEFAULT 0, -- 1 for an admin: left out of counts
  choir TEXT NOT NULL,
  song TEXT,                        -- slug
  part TEXT,                        -- the singer's part, e.g. "S1"
  name TEXT NOT NULL,               -- song_open | settings_open | sound_choice | setting | listen
  sung INTEGER NOT NULL DEFAULT 0,  -- 1 when the song has sung parts
  setting TEXT,                     -- setting: mode | others | rate | staves | zoom | sound
  value TEXT,                       -- sound_choice, listen: piano | sung; setting: the new value
  settings TEXT,                    -- listen: JSON of the six settings as they were
  seconds INTEGER,                  -- listen: how long it played
  listen TEXT UNIQUE                -- listen: the player's id for it, so the minute saves update one row
);
CREATE INDEX events_at ON events (at);
