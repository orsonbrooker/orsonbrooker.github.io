-- Whether a builder player is a he or a she, so the announcer's lines fit ("She's heating up!").
-- NULL when the kid didn't say: the announcer then skips the lines that say he or she.
ALTER TABLE players ADD COLUMN pronoun TEXT CHECK (pronoun IN ('he', 'she'));
