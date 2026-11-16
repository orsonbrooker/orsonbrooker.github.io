-- Someone tapped the flag on a community team's row on Top teams: its name may not be friendly. Every
-- community team is on Top teams now (worker/src/teams.ts), named without Luke's OK first, so like a
-- player's name (reports, 0013) each IP (hashed with the day) counts once per team, and a reported team
-- waits in the admin inbox until Luke hides it, renames it or says the name looks fine, which marks its
-- reports cleared (kept, so the same report can't bring it straight back).
CREATE TABLE team_reports (
  team_id INTEGER NOT NULL REFERENCES community_teams (id),
  ip_hash TEXT NOT NULL,
  cleared INTEGER NOT NULL DEFAULT 0, -- 1 once the admin has acted on it
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (team_id, ip_hash)
) WITHOUT ROWID;

CREATE INDEX team_reports_open ON team_reports (cleared, team_id);
