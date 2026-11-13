-- Feature flags (shared/flags.js lists them; worker/src/flags.ts reads and changes them): a row for
-- each flag Luke has switched on or off, or linked to an idea, on the admin page. A flag with no row is
-- off, so a new one stays hidden until it's switched on. idea_id optionally ties a flag to the idea it
-- delivers: the board says "Coming soon" while the flag is off, and switching it on marks the idea done.
CREATE TABLE flags (
	key TEXT PRIMARY KEY,
	enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
	idea_id INTEGER REFERENCES ideas (id) ON DELETE SET NULL,
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX flags_idea ON flags (idea_id);
