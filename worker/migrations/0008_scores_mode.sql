-- Shootaround has two modes, each with its own leaderboard: 'timed' (60 seconds) and 'survival'
-- (sudden death: keep shooting until the first miss). Every score so far is from a timed game.
ALTER TABLE scores ADD COLUMN mode TEXT NOT NULL DEFAULT 'timed';
CREATE INDEX scores_mode ON scores (mode, status, created_at);
