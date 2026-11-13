-- The team a game was played for (Top teams, worker/src/teams.ts), set by the Worker when the game is
-- sent and never changed after: an official team's name (shared/teams.js), or "c<id>" for a community
-- team (community_teams, 0024). NULL for games from before teams, or with no team.
ALTER TABLE scores ADD COLUMN team TEXT;
CREATE INDEX scores_team ON scores (mode, team, status, created_at);
