-- Which device's player a request is (a keyed hash of the device and the player's id there), so
-- sending the same player again while the first request still waits replaces it.
ALTER TABLE players ADD COLUMN local_key TEXT;
CREATE INDEX players_local_key ON players (local_key);
