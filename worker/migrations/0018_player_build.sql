-- A builder player's size from the builder's sliders: height and bulk, each -1, -0.5, 0, 0.5 or 1
-- (0 is the body as drawn). NULL when the player wasn't sent with a size (older players, plain bodies),
-- which the game draws at normal size.
ALTER TABLE players ADD COLUMN height REAL CHECK (height IN (-1, -0.5, 0, 0.5, 1));
ALTER TABLE players ADD COLUMN bulk REAL CHECK (bulk IN (-1, -0.5, 0, 0.5, 1));
