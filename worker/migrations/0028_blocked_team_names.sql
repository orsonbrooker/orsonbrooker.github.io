-- Team names Luke hid after they were reported (worker/src/teams.ts): nobody can make or rename a team to
-- exactly that name again. Unlike blocked_names (players' names, matched anywhere inside a name), only the
-- exact name is blocked, so a word inside another name or another team that already had it isn't caught.
-- "Show again" on the team in admin takes the block off.
CREATE TABLE blocked_team_names (
  name TEXT PRIMARY KEY, -- capitals, as teamNameOf tidies it
  team_id INTEGER REFERENCES community_teams (id), -- the hidden team it came from
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) WITHOUT ROWID;
