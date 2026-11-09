# Head sheets

Every player shares Orson's moving body (made from video). What makes them look different is their head
(face and hair), drawn once per view and placed on the body in every frame by the build tool, plus their
colours, number and team name.

## What to make, per head

One **16:9** image (any size; 1920 x 1080 is the guide's) laid out like `template-orson.png`, on plain
green (#00B140): **two rows of five heads**.

| | front | front-right | right | back-right | back |
|---|---|---|---|---|---|
| **Top row** | looking at you | | side on | | back of the head |
| **Bottom row: looking up** (for shots) | same as the top | chin up a little | chin up | chin up a little | same as the top |

The left-facing ones are flipped from these. The bottom row is used while he jumps and shoots, looking
up at the hoop.

- Same pixel-art style, size and place as Orson's heads in `template-orson.png`. At 1920 x 1080 each head
  sits in a 360 px square: the columns start 60 px from the left edge, the top row's squares run from 180
  to 540 px down, the bottom row's from 540 to 900 px. Green above and below (that's just to make 16:9).
- Head and neck only: no shoulders, hands or ball. A little jersey collar is fine.
- Hair a mid brown and skin a mid tan, clearly different from each other: the game recolours both, so
  the actual colours don't matter, only that the tool can tell hair from skin.
- Anything that sticks out (a ponytail, braids, buns) stays inside its square, with green all round.
- A friendly, neutral face.

It doesn't need to be exact: the tool lines each head up by its neck with Orson's in the same view.

Prompt to start from (with `template-orson.png` attached):

> Pixel art kid basketball player heads, head and neck only, in exactly the same style, size, layout and
> positions as the reference image: two rows of five views (front, front-right, right side, back-right,
> back); the bottom row the same views with the chin tipped up, looking up. Hairstyle: **a high
> ponytail**. Mid-brown hair, mid-tan skin, neutral friendly face. Plain flat green background (#00B140),
> nothing else in the picture. 16:9.

For now a hat, headband or glasses is drawn into the head (a "cap" head). Separate item layers that
work with any hair are a later step.

## Dropping one in

1. Save it here as `head-<style>.png`. To replace a builder body, use its id: `spiky`, `curly`, `buzz`,
   `cap`, `glasses`, `headband`, `mullet`, `ponytail`, `buns`, `braids`. Any other name makes a new style.
2. Build it: `~/.venvs/announcer/bin/python tools/pixelart/heads.py <style>`
3. Check `preview-<style>.png` here (the head on the body in every facing), then try it in the game:
   `/games/shootaround/?debug&head=<style>&skin=8d5a3b&hair=3b2416` (add `&height=1&bulk=-1` for a build).

Once built, every builder player who chose that body moves like Orson with this head. A head with only
the top row (five in a row, the older layout) still works: shots use the normal views.

`head-orson.png` is Orson's own head, made by `tools/pixelart/rig.py`: a check that a head goes back on
the body in the right place. Its looking-up row is his normal head tipped back (his face is behind his
arms in most shot frames).
