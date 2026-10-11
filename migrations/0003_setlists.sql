-- Named, ordered song lists per choir (#34), such as a concert's program.
-- Every singer in the choir sees them; only admins change them.
CREATE TABLE setlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  choir TEXT NOT NULL,
  name TEXT NOT NULL,
  songs TEXT NOT NULL DEFAULT '[]',   -- JSON array of song slugs, in order
  updated_at TEXT NOT NULL
);
CREATE INDEX setlists_choir ON setlists (choir);
