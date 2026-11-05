-- Odd-looking scores now go straight on the board, marked for Orson to check, instead of waiting.
-- checked = 1 once he's looked (kept or hidden). Scores he already approved or hid count as checked.
ALTER TABLE scores ADD COLUMN checked INTEGER NOT NULL DEFAULT 0;
UPDATE scores SET checked = 1 WHERE status = 'hidden' OR (status = 'shown' AND flags != '[]');
UPDATE scores SET status = 'shown' WHERE status = 'held';
