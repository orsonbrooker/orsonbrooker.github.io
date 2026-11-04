-- The colours of a player made on someone's device, so everyone sees their face on the leaderboard.
-- JSON: {"skin":"#rrggbb","hair":…,"jersey":…,"team":…,"shoes":…}
ALTER TABLE scores ADD COLUMN colours TEXT;
