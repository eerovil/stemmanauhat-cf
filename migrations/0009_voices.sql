-- The voice tree (#107): which part names mean the same voice, and which part a
-- divided one belongs to, so a singer's remembered part carries over between songs that
-- name or divide their parts differently. Up to four levels: group, voice, divided part,
-- its upper or lower half. Names are compared ignoring letter case and spaces. Edit the
-- rows to add a name or a voice; no code change is needed (README, "Part names").
CREATE TABLE voices (
  id TEXT PRIMARY KEY,
  parent TEXT,                  -- the id one level up; NULL at the top
  names TEXT NOT NULL           -- JSON array of the names this place goes by
);
INSERT INTO voices (id, parent, names) VALUES
  ('women', NULL, '["Naiset", "Women", "Naisäänet"]'),
  ('men', NULL, '["Miehet", "Men", "Miesäänet"]'),
  ('S', 'women', '["Sopraano", "Soprano", "S"]'),
  ('S1', 'S', '["Sopraano 1", "Soprano 1", "S1", "Sopraano I", "Soprano I"]'),
  ('S2', 'S', '["Sopraano 2", "Soprano 2", "S2", "Sopraano II", "Soprano II"]'),
  ('S3', 'S', '["Sopraano 3", "Soprano 3", "S3", "Sopraano III", "Soprano III"]'),
  ('S1u', 'S1', '["Upper sopraano 1", "Upper soprano 1", "Upper S1"]'),
  ('S1l', 'S1', '["Lower sopraano 1", "Lower soprano 1", "Lower S1"]'),
  ('S2u', 'S2', '["Upper sopraano 2", "Upper soprano 2", "Upper S2"]'),
  ('S2l', 'S2', '["Lower sopraano 2", "Lower soprano 2", "Lower S2"]'),
  ('Mz', 'women', '["Mezzo", "Mezzosopraano", "Mezzo-soprano", "Mz"]'),
  ('A', 'women', '["Altto", "Alto", "A"]'),
  ('A1', 'A', '["Altto 1", "Alto 1", "A1", "Altto I", "Alto I"]'),
  ('A2', 'A', '["Altto 2", "Alto 2", "A2", "Altto II", "Alto II"]'),
  ('A3', 'A', '["Altto 3", "Alto 3", "A3", "Altto III", "Alto III"]'),
  ('A1u', 'A1', '["Upper altto 1", "Upper alto 1", "Upper A1"]'),
  ('A1l', 'A1', '["Lower altto 1", "Lower alto 1", "Lower A1"]'),
  ('A2u', 'A2', '["Upper altto 2", "Upper alto 2", "Upper A2"]'),
  ('A2l', 'A2', '["Lower altto 2", "Lower alto 2", "Lower A2"]'),
  ('T', 'men', '["Tenori", "Tenor", "T"]'),
  ('T1', 'T', '["Tenori 1", "Tenor 1", "T1", "Tenori I", "Tenor I"]'),
  ('T2', 'T', '["Tenori 2", "Tenor 2", "T2", "Tenori II", "Tenor II"]'),
  ('T3', 'T', '["Tenori 3", "Tenor 3", "T3", "Tenori III", "Tenor III"]'),
  ('T1u', 'T1', '["Upper tenori 1", "Upper tenor 1", "Upper T1"]'),
  ('T1l', 'T1', '["Lower tenori 1", "Lower tenor 1", "Lower T1"]'),
  ('T2u', 'T2', '["Upper tenori 2", "Upper tenor 2", "Upper T2"]'),
  ('T2l', 'T2', '["Lower tenori 2", "Lower tenor 2", "Lower T2"]'),
  ('Bar', 'men', '["Baritoni", "Baritone", "Bar"]'),
  ('B', 'men', '["Basso", "Bass", "B"]'),
  ('B1', 'B', '["Basso 1", "Bass 1", "B1", "Basso I", "Bass I"]'),
  ('B2', 'B', '["Basso 2", "Bass 2", "B2", "Basso II", "Bass II"]'),
  ('B3', 'B', '["Basso 3", "Bass 3", "B3", "Basso III", "Bass III"]'),
  ('B1u', 'B1', '["Upper basso 1", "Upper bass 1", "Upper B1"]'),
  ('B1l', 'B1', '["Lower basso 1", "Lower bass 1", "Lower B1"]'),
  ('B2u', 'B2', '["Upper basso 2", "Upper bass 2", "Upper B2"]'),
  ('B2l', 'B2', '["Lower basso 2", "Lower bass 2", "Lower B2"]');
