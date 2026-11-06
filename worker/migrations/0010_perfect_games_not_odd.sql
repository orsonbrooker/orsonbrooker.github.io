-- A perfect game (every shot made) isn't flagged any more: good players often do it. Games that
-- were only flagged for that count as looked at, so they leave the admin inbox. They stay on the
-- leaderboard, as they already were.
UPDATE scores SET checked = 1 WHERE checked = 0 AND flags LIKE '["All % shots made"]';
