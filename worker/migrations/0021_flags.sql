-- Feature flags (shared/flags.js lists them; worker/src/flags.ts reads and changes them): a row for
-- each flag Luke has switched on or off on the admin page. A flag with no row is off, so a new one
-- stays hidden until it's switched on.
CREATE TABLE flags (
	key TEXT PRIMARY KEY,
	enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
