-- Games and apps that ideas can be about. Add a row when a new game or app goes on the site.
CREATE TABLE apps (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

-- Public ideas on the board. Only ever created from the admin page.
CREATE TABLE ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app TEXT NOT NULL REFERENCES apps(slug),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  credit TEXT, -- nickname shown on the card, if the admin chose to credit it
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'planned', 'building', 'done', 'hidden')),
  votes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- What visitors send in. Never shown publicly; triaged on the admin page.
CREATE TABLE submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app TEXT NOT NULL,
  text TEXT NOT NULL,
  nickname TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'approved', 'merged', 'rejected')),
  idea_id INTEGER REFERENCES ideas(id),
  ip_hash TEXT NOT NULL, -- keyed hash of IP + day, only for rate limits
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One upvote per idea per device.
CREATE TABLE votes (
  idea_id INTEGER NOT NULL REFERENCES ideas(id),
  voter TEXT NOT NULL, -- keyed hash of the browser's random device id
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (idea_id, voter)
);

CREATE INDEX submissions_status ON submissions (status, created_at);
CREATE INDEX submissions_ip ON submissions (ip_hash, created_at);
CREATE INDEX votes_ip ON votes (ip_hash, created_at);
CREATE INDEX votes_voter ON votes (voter);
CREATE INDEX ideas_app ON ideas (app, status);

INSERT INTO apps (slug, name) VALUES
  ('basketball', 'Shootaround'),
  ('website', 'The website');
