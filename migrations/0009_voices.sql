-- The voice tree (#107): which part names mean the same voice, and which part a
-- divided one belongs to, so a singer's remembered part carries over between songs that
-- name or divide their parts differently. Up to four levels: group, voice, divided part,
-- its upper or lower half. Names are compared ignoring letter case and spaces. The player
-- shows each place by its own name (name_fi, name_en), whatever the song calls it. Edit the
-- rows to add a name or a voice, or to rename one; no code change is needed (README, "Part
-- names"). The publish script asks for a place for every new part name (--place).
CREATE TABLE voices (
  id TEXT PRIMARY KEY,
  parent TEXT,                  -- the id one level up; NULL at the top
  name_fi TEXT NOT NULL,        -- what the player shows, in Finnish
  name_en TEXT NOT NULL,        -- and in English
  names TEXT NOT NULL           -- JSON array of the names songs give this place
);
INSERT INTO voices (id, parent, name_fi, name_en, names) VALUES
  ('women', NULL, 'Naiset', 'Women', '["Naiset", "Women", "Naisäänet"]'),
  ('men', NULL, 'Miehet', 'Men', '["Miehet", "Men", "Miesäänet"]'),
  ('S', 'women', 'Sopraano', 'Soprano', '["Sopraano", "Soprano", "S"]'),
  ('S1', 'S', 'Sopraano 1', 'Soprano 1', '["Sopraano 1", "Soprano 1", "S1"]'),
  ('S2', 'S', 'Sopraano 2', 'Soprano 2', '["Sopraano 2", "Soprano 2", "S2"]'),
  ('S3', 'S', 'Sopraano 3', 'Soprano 3', '["Sopraano 3", "Soprano 3", "S3"]'),
  ('S1u', 'S1', 'Sopraano 1 ylä', 'Upper soprano 1', '["Sopraano 1 ylä", "Upper soprano 1", "Upper sopraano 1", "Upper S1"]'),
  ('S1l', 'S1', 'Sopraano 1 ala', 'Lower soprano 1', '["Sopraano 1 ala", "Lower soprano 1", "Lower sopraano 1", "Lower S1"]'),
  ('S2u', 'S2', 'Sopraano 2 ylä', 'Upper soprano 2', '["Sopraano 2 ylä", "Upper soprano 2", "Upper sopraano 2", "Upper S2"]'),
  ('S2l', 'S2', 'Sopraano 2 ala', 'Lower soprano 2', '["Sopraano 2 ala", "Lower soprano 2", "Lower sopraano 2", "Lower S2"]'),
  ('Mz', 'women', 'Mezzosopraano', 'Mezzo-soprano', '["Mezzo", "Mezzosopraano", "Mezzo-soprano", "Mz"]'),
  ('A', 'women', 'Altto', 'Alto', '["Altto", "Alto", "A"]'),
  ('A1', 'A', 'Altto 1', 'Alto 1', '["Altto 1", "Alto 1", "A1"]'),
  ('A2', 'A', 'Altto 2', 'Alto 2', '["Altto 2", "Alto 2", "A2"]'),
  ('A3', 'A', 'Altto 3', 'Alto 3', '["Altto 3", "Alto 3", "A3"]'),
  ('A1u', 'A1', 'Altto 1 ylä', 'Upper alto 1', '["Altto 1 ylä", "Upper alto 1", "Upper altto 1", "Upper A1"]'),
  ('A1l', 'A1', 'Altto 1 ala', 'Lower alto 1', '["Altto 1 ala", "Lower alto 1", "Lower altto 1", "Lower A1"]'),
  ('A2u', 'A2', 'Altto 2 ylä', 'Upper alto 2', '["Altto 2 ylä", "Upper alto 2", "Upper altto 2", "Upper A2"]'),
  ('A2l', 'A2', 'Altto 2 ala', 'Lower alto 2', '["Altto 2 ala", "Lower alto 2", "Lower altto 2", "Lower A2"]'),
  ('T', 'men', 'Tenori', 'Tenor', '["Tenori", "Tenor", "T"]'),
  ('T1', 'T', 'Tenori 1', 'Tenor 1', '["Tenori 1", "Tenor 1", "T1"]'),
  ('T2', 'T', 'Tenori 2', 'Tenor 2', '["Tenori 2", "Tenor 2", "T2"]'),
  ('T3', 'T', 'Tenori 3', 'Tenor 3', '["Tenori 3", "Tenor 3", "T3"]'),
  ('T1u', 'T1', 'Tenori 1 ylä', 'Upper tenor 1', '["Tenori 1 ylä", "Upper tenor 1", "Upper tenori 1", "Upper T1"]'),
  ('T1l', 'T1', 'Tenori 1 ala', 'Lower tenor 1', '["Tenori 1 ala", "Lower tenor 1", "Lower tenori 1", "Lower T1"]'),
  ('T2u', 'T2', 'Tenori 2 ylä', 'Upper tenor 2', '["Tenori 2 ylä", "Upper tenor 2", "Upper tenori 2", "Upper T2"]'),
  ('T2l', 'T2', 'Tenori 2 ala', 'Lower tenor 2', '["Tenori 2 ala", "Lower tenor 2", "Lower tenori 2", "Lower T2"]'),
  ('Bar', 'men', 'Baritoni', 'Baritone', '["Baritoni", "Baritone", "Bar"]'),
  ('B', 'men', 'Basso', 'Bass', '["Basso", "Bass", "B"]'),
  ('B1', 'B', 'Basso 1', 'Bass 1', '["Basso 1", "Bass 1", "B1"]'),
  ('B2', 'B', 'Basso 2', 'Bass 2', '["Basso 2", "Bass 2", "B2"]'),
  ('B3', 'B', 'Basso 3', 'Bass 3', '["Basso 3", "Bass 3", "B3"]'),
  ('B1u', 'B1', 'Basso 1 ylä', 'Upper bass 1', '["Basso 1 ylä", "Upper bass 1", "Upper basso 1", "Upper B1"]'),
  ('B1l', 'B1', 'Basso 1 ala', 'Lower bass 1', '["Basso 1 ala", "Lower bass 1", "Lower basso 1", "Lower B1"]'),
  ('B2u', 'B2', 'Basso 2 ylä', 'Upper bass 2', '["Basso 2 ylä", "Upper bass 2", "Upper basso 2", "Upper B2"]'),
  ('B2l', 'B2', 'Basso 2 ala', 'Lower bass 2', '["Basso 2 ala", "Lower bass 2", "Lower basso 2", "Lower B2"]');

-- Part names that are in no place on purpose (a solo, a trio): they match only themselves.
-- The publish script stops on a name in neither table, so whoever publishes says where it goes.
CREATE TABLE unplaced_parts (
  name TEXT PRIMARY KEY
);
INSERT INTO unplaced_parts (name) VALUES
  ('Solo'), ('Solo 1'), ('Solo 2'), ('Tenori solo'), ('Sopraano solo'), ('Trio T1'), ('Trio T2'), ('Trio Bar');
