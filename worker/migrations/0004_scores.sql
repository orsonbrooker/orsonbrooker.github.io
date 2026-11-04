-- Shootaround leaderboard. Each row is one game, checked by the Worker before it's stored.
CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  score INTEGER NOT NULL,
  player TEXT NOT NULL, -- who they played as (a character id)
  base TEXT, -- builder body, for players made on their device, so others still see a face
  shots INTEGER NOT NULL,
  made INTEGER NOT NULL,
  threes INTEGER NOT NULL, -- threes made
  real_seconds REAL NOT NULL, -- from the game starting to the score being sent, timed by the server
  input TEXT, -- touch, mouse or keyboard
  hidden_tab INTEGER NOT NULL DEFAULT 0, -- the tab was hidden during the game
  version TEXT, -- the game.js version that played it
  log TEXT NOT NULL, -- JSON shot log: [seconds in, 3-pointer, made, release timing]
  flags TEXT NOT NULL DEFAULT '[]', -- JSON list of reasons it looks odd
  status TEXT NOT NULL DEFAULT 'shown' CHECK (status IN ('shown', 'held', 'hidden')),
  token TEXT NOT NULL UNIQUE, -- the game's start token: one score per game
  device TEXT NOT NULL, -- keyed hash of the browser's random device id
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX scores_board ON scores (status, score DESC);
CREATE INDEX scores_recent ON scores (status, created_at);
CREATE INDEX scores_device ON scores (device);
CREATE INDEX scores_ip ON scores (ip_hash, created_at);
