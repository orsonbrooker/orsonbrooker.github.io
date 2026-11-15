-- Reading a board near a score (worker/src/scores.ts nearScore: "Your place" and the game-over preview) in score
-- order for one mode, instead of reading the whole board.
CREATE INDEX scores_mode_score ON scores (mode, status, score);
