-- The weekly digest (worker/src/digest.ts): on Monday's cron, a snapshot of the odd-looking games and
-- reported names still waiting for a look. The newest one not yet marked seen sits at the top of the
-- admin inbox. A new week's digest replaces any older one that wasn't seen.
CREATE TABLE digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week TEXT NOT NULL UNIQUE, -- YYYY-MM-DD (UTC) of the day it was made
  items TEXT NOT NULL, -- JSON: { odd: [...], names: [...], newOdd, newNames } (digest.ts Digest)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  seen_at TEXT -- set when the admin taps "Got it"
);
