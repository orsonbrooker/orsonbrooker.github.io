-- Saved progress: coins earned by playing and what they bought, kept on the server so a kid can carry
-- them to another device. No names, emails or passwords: each device holds a random key, and a short
-- pairing code (shown on one device, typed on another within 10 minutes) adds a device.
CREATE TABLE progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coins INTEGER NOT NULL DEFAULT 0, -- to spend
  earned INTEGER NOT NULL DEFAULT 0, -- all ever earned
  ball TEXT NOT NULL DEFAULT 'classic', -- the ball style in use (shared/shop.js)
  save TEXT NOT NULL DEFAULT '{}', -- bests, daily streak, builder players, nickname (JSON, shared/save.js)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Each device's key, hashed. Several devices can share one progress.
CREATE TABLE progress_devices (
  key_hash TEXT PRIMARY KEY,
  progress_id INTEGER NOT NULL REFERENCES progress (id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) WITHOUT ROWID;
CREATE INDEX progress_devices_progress ON progress_devices (progress_id);

-- Games that earned coins: one claim per game (its start token).
CREATE TABLE progress_games (
  token TEXT PRIMARY KEY,
  progress_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  coins INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) WITHOUT ROWID;
CREATE INDEX progress_games_progress ON progress_games (progress_id, created_at);

-- What they've bought (shop item ids from shared/shop.js).
CREATE TABLE progress_items (
  progress_id INTEGER NOT NULL,
  item TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (progress_id, item)
) WITHOUT ROWID;

-- Pairing codes, hashed: each works once, for 10 minutes. Old ones are cleared by the weekly cron.
CREATE TABLE pair_codes (
  code_hash TEXT PRIMARY KEY,
  progress_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL
) WITHOUT ROWID;
