-- A singer flags a published song's score as having issues (#41): a
-- song_requests row with `song` set, so Done/Delete and the admin list are shared.
ALTER TABLE song_requests ADD COLUMN song TEXT;      -- slug; NULL for a new-track request
ALTER TABLE song_requests ADD COLUMN bar INTEGER;    -- 1-based, as the player shows it; NULL if not given
ALTER TABLE song_requests ADD COLUMN problems TEXT;  -- comma-separated FLAG_PROBLEMS, e.g. "notes,lyrics"
ALTER TABLE song_requests ADD COLUMN part TEXT;      -- the flagger's own part name
