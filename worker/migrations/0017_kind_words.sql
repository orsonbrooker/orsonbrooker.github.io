-- Kind words: compliments sent through the ideas form ("great game!") with no idea in them. They stay
-- off the board but are kept for Orson to read, and maybe to quote one day. Kept ones are 'rejected'
-- (not on the board) with kept_at set; the admin's Kind words section lists them.
ALTER TABLE submissions ADD COLUMN kept_at TEXT;
