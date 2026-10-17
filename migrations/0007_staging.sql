-- The test list (#73): song-app publishes a new song here, an admin tries it
-- out, then moves it to a choir's list at /c/testi. Only admins open it: no
-- members, no link, no requests or flags. song-app reads `staging` to publish
-- here without taking the song off any choir's list.
ALTER TABLE choirs ADD COLUMN staging INTEGER NOT NULL DEFAULT 0;
INSERT INTO choirs (id, name, public, staging) VALUES ('testi', 'Testilista', 0, 1) ON CONFLICT (id) DO NOTHING;
