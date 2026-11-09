# Head sheets

Every player shares Orson's moving body (made from video). What makes them look different is their head
(face and hair), drawn once per direction and placed on the body in every frame by the build tool,
plus their colours, number and team name.

## What to make, per head

One image, like `template-orson.png`: **5 heads in a row**, each in a 512 x 512 square, on plain green
(#00B140):

| Square | Facing |
|---|---|
| 1 | front (looking at you) |
| 2 | front-right |
| 3 | right (side on) |
| 4 | back-right |
| 5 | back (back of the head) |

The left-facing ones are flipped from these.

- Same pixel-art style, size and place in the square as Orson's in `template-orson.png`: the top of the
  head about 80 px from the top, the neck ending about 415 px down, in the middle.
- Head and neck only: no shoulders, hands or ball. A little jersey collar is fine.
- Hair a mid brown and skin a mid tan, clearly different from each other: the game recolours both, so
  the actual colours don't matter, only that the tool can tell hair from skin.
- Anything that sticks out (a ponytail, braids, buns) stays inside its square, with green all round.
- A friendly, neutral face.

Prompt to start from (with `template-orson.png` attached):

> Pixel art kid basketball player, head and neck only, in exactly the same style, size and positions
> as the reference image: five views in a row (front, front-right, right side, back-right, back).
> Hairstyle: **a high ponytail**. Mid-brown hair, mid-tan skin, neutral friendly face. Plain flat green
> background (#00B140), nothing else in the picture.

For now a hat, headband or glasses is drawn into the head (a "cap" head). Separate item layers that
work with any hair are a later step.

## Dropping one in

1. Save it here as `head-<style>.png`. To replace a builder body, use its id: `spiky`, `curly`, `buzz`,
   `cap`, `glasses`, `headband`, `mullet`, `ponytail`, `buns`, `braids`. Any other name makes a new style.
2. Build it: `~/.venvs/announcer/bin/python tools/pixelart/heads.py <style>`
3. Check `preview-<style>.png` here (the head on the body in every facing), then try it in the game:
   `/games/shootaround/?debug&head=<style>&skin=8d5a3b&hair=3b2416` (add `&height=1&bulk=-1` for a build).

Once built, every builder player who chose that body moves like Orson with this head.

`head-orson.png` is Orson's own head, made by `tools/pixelart/rig.py`: a check that a head goes back on
the body in the right place.
