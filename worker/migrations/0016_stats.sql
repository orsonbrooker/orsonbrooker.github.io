-- The admin page's stats (worker/src/stats.ts): indexes so its counts by day read only the days they
-- need, and a daily copy of Cloudflare's page views (Cloudflare keeps them for about a month).
CREATE INDEX progress_games_day ON progress_games (created_at, progress_id, mode);
CREATE INDEX progress_day ON progress (created_at);
CREATE INDEX scores_day ON scores (created_at);

CREATE TABLE page_views (
  day TEXT NOT NULL, -- YYYY-MM-DD, UTC
  path TEXT NOT NULL, -- one of the site's pages (PAGES in stats.ts)
  views INTEGER NOT NULL, -- pages served to browsers (Cloudflare's sampled count)
  visits INTEGER NOT NULL, -- of those, arriving from another site or typed in
  PRIMARY KEY (day, path)
);
