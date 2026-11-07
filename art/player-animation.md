# Player animation: art brief

The aim: players who move smoothly all over the court in any direction, with enough moves for the future
games (1v1 and 2v2, defence, a city to explore), drawn once now in the current style. This replaces the
earlier shooting-angles brief.

## Today, for comparison

One 7 x 2 sheet per player (`art/character-template.png`), all from one angle (back to the camera, facing
the hoop up and to the left), with only a few distinct poses: 2 standing, 3 turning, 4 dribbling, 1 crouch,
2 jumping, 1 release, 1 landing. The game repeats frames to fill the time (the jump is 7 frames over
0.6 s, about 12 a second). Nothing walks or runs: players slide between spots.

## Directions

Eight, as seen on screen: **S** (facing the camera), **SE**, **E**, **NE**, **N** (back to the camera),
**NW** (today's shooting angle, towards the hoop), **W**, **SW**.

**SW, W and NW can be mirror images of SE, E and NE**, so only five need drawing, as long as nothing in the
art reads backwards when flipped. Builder bodies are fine: the game draws their jersey number. Jethro and
Orson have their number drawn in, so for them either all eight get drawn, or their numbers move into the
game the same way.

## Animations

Frame counts are per direction. "Loop" means the last frame leads back into the first. The shot and
anything quick runs at 24 frames a second, twice today's rate; calm ones at 12.

| Animation | Frames | Speed | Loop | Needed for |
|---|---|---|---|---|
| Stand (breathing, ball held) | 12 | 12/s | loop | everything |
| Dribble standing | 12 | 24/s | loop | everything |
| Gather (crouch, ball up) | 4 | 24/s | | everything |
| Jump shot: rise, top, release, fall, land | 16 | 24/s | | everything |
| Walk with the ball | 16 | 24/s | loop | moving round the court, the city |
| Run dribbling | 12 | 24/s | loop | moving round the court, 1v1 |
| Run without the ball | 12 | 24/s | loop | 1v1/2v2, the city |
| Crossover (ball from one hand to the other) | 12 | 24/s | | 1v1 |
| Layup | 16 | 24/s | | 1v1, Around the World close in |
| Chest pass | 8 | 24/s | | 2v2 |
| Catch | 6 | 24/s | | 2v2 |
| Rebound (jump, grab, land) | 14 | 24/s | | 1v1 |
| Defence stance | 8 | 12/s | loop | 1v1, Moni the blocker |
| Defence slide (side to side) | 12 | 24/s | loop | 1v1 |
| Block (jump, arms up, land) | 14 | 24/s | | 1v1, Moni the blocker |
| Celebrate | 16 | 12/s | | after big shots, winning |
| Disappointed | 12 | 12/s | | missing, losing HORSE |

That's 17 animations: about 215 frames per direction, or about 1,070 per player for five drawn directions.

### Keep the shot's timing

The game's timing bar is built on the jump: 0.6 s from leaving the floor to landing, highest at 0.29 s.
The new jump shot's 16 frames must keep those times: at 24 a second, leaving the floor on frame 1, the top of the
jump on frame 8, the release on frames 8-9, landing on frame 15 and settling on frame 16. The green then still
means the same thing and scores stay comparable.

## Sheets

One sheet per animation per direction, on a new template: **16:9, 8 columns x 2 rows** (up to 16 frames,
left to right, top row first), with the same backdrop, floor line, cell size and player size as now, so
`tools/build_character.py` can build it. Name them `art/characters/<player>/<animation>-<direction>.jpg`
(e.g. `jumpshot-se.jpg`). I'll make the template and the labelled version once the plan's agreed.

Keep across every frame and sheet:
- the same height and proportions (the head the same size in every frame)
- feet on the floor line when standing (the build tool lines frames up by the feet)
- the ball the same size, held at the same hand height between frames of one move
- the same light (from the upper left), the same outline and the same colours

**Builder bodies:** draw each part in its own flat key colour (skin, hair, jersey, team colour, shoes). The
recolouring glitches today come from guessing parts from shading, so flat colours fix that for good.

**Orson:** his sprites come from video, so he'd need new video for each move and direction, filmed from
the same height and angle, or drawn sheets in his look.

## How much, and in what order

About 85 sheets per player for five directions (17 animations x 5), 136 for all eight. For Jethro, the 10
builder bodies and Orson that's around 1,000 sheets. To get there without redoing work:

1. **Trial first (one body, two moves):** stand and jump shot in SE and NW. If you're trying the 3D route
   (a model rendered to pixel art), render the same two moves and put them side by side with the drawn
   ones. Go 3D only if it matches the current style almost exactly.
2. **Everything Shootaround uses now:** stand, dribble standing, gather and jump shot, in five directions, for
   every player. The game can then shoot from anywhere, the corners included.
3. **Moving:** walk, run dribbling, run without the ball.
4. **1v1 and 2v2:** crossover, layup, pass, catch, rebound, defence stance and slide, block.
5. **Reactions:** celebrate, disappointed.

The game work (8-way facing, walking between spots, an animation system that reads the new sheets) can
start as soon as step 2's sheets exist for one body.
