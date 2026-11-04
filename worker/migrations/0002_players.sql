-- Players made with the builder. Shown in the game's player picker once approved.
CREATE TABLE players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  base TEXT NOT NULL, -- a base body in assets/characters/bases/
  skin TEXT NOT NULL, -- #rrggbb colours
  hair TEXT NOT NULL,
  jersey TEXT NOT NULL,
  team TEXT NOT NULL,
  shoes TEXT NOT NULL,
  number TEXT, -- 0 to 99, printed on the jersey; NULL for none
  team_name TEXT NOT NULL DEFAULT 'KINGS', -- printed across the front
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'approved', 'hidden')),
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX players_status ON players (status, id);
CREATE INDEX players_ip ON players (ip_hash, created_at);
