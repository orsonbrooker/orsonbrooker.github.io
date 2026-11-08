-- Someone tapped "report" on a leaderboard row: that row's name may not be friendly. Each IP (hashed
-- with the day, util.ts ipKey) counts once per score, so tapping again is a no-op. Reported scores
-- show in the admin inbox until Luke hides the score, renames the player or says the name looks fine,
-- which marks their reports cleared (kept, so the same report can't bring it straight back).
CREATE TABLE reports (
  score_id INTEGER NOT NULL REFERENCES scores (id),
  ip_hash TEXT NOT NULL,
  cleared INTEGER NOT NULL DEFAULT 0, -- 1 once the admin has acted on it
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (score_id, ip_hash)
) WITHOUT ROWID;

CREATE INDEX reports_open ON reports (cleared, score_id);
