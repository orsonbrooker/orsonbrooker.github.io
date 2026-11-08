-- Names that were reported on the leaderboard and then hidden by Luke: from then on they count as
-- unfriendly words everywhere people type (util.ts isUnfriendly), on top of the rude-word filter.
-- `squashed` is the name as the filter compares it (lower-case letters only, look-alikes swapped
-- back), so "Poo Head", "poohead" and "P00-HEAD" are one entry. Removable from the admin page.
CREATE TABLE blocked_names (
  squashed TEXT PRIMARY KEY,
  name TEXT NOT NULL, -- as it was typed, to show on the admin page
  score_id INTEGER REFERENCES scores (id), -- the hidden game it came from
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) WITHOUT ROWID;
