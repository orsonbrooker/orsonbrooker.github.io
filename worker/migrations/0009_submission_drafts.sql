-- A tidied-up title and description for an idea in the inbox, ready to check before it goes on
-- the board, plus a note on what to do with it (and an existing idea it could be added to).
-- All empty until someone drafts them; the admin page falls back to the idea's own words.
ALTER TABLE submissions ADD COLUMN title TEXT;
ALTER TABLE submissions ADD COLUMN description TEXT;
ALTER TABLE submissions ADD COLUMN note TEXT;
ALTER TABLE submissions ADD COLUMN merge_into INTEGER;
