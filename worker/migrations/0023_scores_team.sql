-- The team a game was played for (Top teams, worker/src/teams.ts), set by the Worker when the game is
-- sent: KINGS for Orson, an approved player's team name, or a kid's own player's (checked). NULL for
-- games from before teams, or with no team the board can show.
ALTER TABLE scores ADD COLUMN team TEXT;
CREATE INDEX scores_team ON scores (mode, team, status, created_at);
