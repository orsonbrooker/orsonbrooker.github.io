-- How many times each (hashed) IP has called a cheap route today, such as voting. Counted on every
-- call, so toggling a vote up and down still uses up the day's allowance. Old days are cleared by
-- the weekly cron.
CREATE TABLE rate_limits (
  bucket TEXT NOT NULL, -- which route: vote, preview
  ip_hash TEXT NOT NULL, -- keyed hash of the IP and day (util.ts ipKey)
  day TEXT NOT NULL, -- YYYY-MM-DD, UTC
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, ip_hash, day)
) WITHOUT ROWID;
