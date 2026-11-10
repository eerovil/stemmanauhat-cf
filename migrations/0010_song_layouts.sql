-- How wide each bar of a song version is drawn in the one-line view (#137). The
-- player widens uneven bars by laying the whole score out up to three times; a long
-- song took half a minute on a phone. The first browser to do it saves the bar
-- widths here, and every later opening lays the score out once with them.
-- `visible` says which parts were drawn, one digit per part ("1101"); `factors` is a
-- JSON array of OSMD width factors, one per drawn bar. A republished song is a new
-- prefix, so its old rows are never read again.
CREATE TABLE song_layouts (
  prefix TEXT NOT NULL,
  visible TEXT NOT NULL,
  factors TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  PRIMARY KEY (prefix, visible)
);
