-- When an idea was released, so the Done column can show the newest first.
-- Set automatically when an idea is marked done in /admin.
ALTER TABLE ideas ADD COLUMN done_at TEXT;
UPDATE ideas SET done_at = updated_at WHERE status = 'done';
