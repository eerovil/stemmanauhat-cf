-- Who wrote each song, from the score's metaTags (composer, lyricist, arranger).
-- Any of them may be missing; song-app's publish sets them when it knows them.
ALTER TABLE songs ADD COLUMN composer TEXT;
ALTER TABLE songs ADD COLUMN lyricist TEXT;
ALTER TABLE songs ADD COLUMN arranger TEXT;
