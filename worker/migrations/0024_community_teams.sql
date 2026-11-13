-- Community teams (worker/src/teams.ts): teams kids make in the player builder, apart from the six
-- official ones in shared/teams.js. Private from the start (friends join with a code, shared in person);
-- the maker can ask for one to be listed for everyone, which Luke OKs in the admin inbox.
CREATE TABLE community_teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, -- capitals, numbers and spaces, at most 10 (teamNameOf)
  home TEXT NOT NULL, -- kit JSON: { jersey, shorts, trim }
  away TEXT NOT NULL,
  owner TEXT NOT NULL, -- the maker's leaderboard id (scores.device: boardOf), so paired devices share it
  code_hash TEXT NOT NULL, -- the join code, keyed hash only (the maker's device keeps the code)
  listing TEXT NOT NULL DEFAULT 'private' CHECK (listing IN ('private', 'asked', 'listed', 'refused')),
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'hidden')), -- hidden by Luke: gone everywhere
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX community_teams_owner ON community_teams (owner);
CREATE UNIQUE INDEX community_teams_code ON community_teams (code_hash);
CREATE INDEX community_teams_listing ON community_teams (listing, status);

-- Which devices (leaderboard ids, like scores.device) are on a team. Which of a device's players wears
-- it is kept with the player on the device; a game only counts for a team its device is on.
CREATE TABLE team_members (
  board TEXT NOT NULL,
  team_id INTEGER NOT NULL REFERENCES community_teams (id),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (board, team_id)
) WITHOUT ROWID;
CREATE INDEX team_members_team ON team_members (team_id);
