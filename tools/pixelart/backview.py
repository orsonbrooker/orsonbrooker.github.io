"""Makes a first draft of a body seen from behind (`back0`) from its front idle frame, in a .pix file.
The draft is then touched up by hand in the grid; run it again only to start over.

Usage: python3 tools/pixelart/backview.py art/pixel/spiky.pix [idle-frame]

From behind he holds the ball in front of him, so it's hidden. The parts:
  head    the front head's outline and hair, with the face filled in with hair (its strands carried
          down from above, darker towards the nape), the ears kept, and a neck under it
  body    the right half of the front frame (the side the ball doesn't cover), mirrored: the jersey
          with a back neckline instead of the V, the right arm down to the elbow (the forearm goes
          forward, out of sight), the shorts filled in where the ball was, the right leg and shoe
  light   the light stays on the right, so the mirrored (left) half's skin and shoes are a tone darker
"""
import re, sys

src = sys.argv[1]
base = sys.argv[2] if len(sys.argv) > 2 else "idle0"
text = open(src).read()
m = re.search(rf"^frame {base} feet (\d+) (\d+)\n((?:[^\n]+\n)+)", text, re.M)
FX, FY = int(m.group(1)), int(m.group(2))
F = m.group(3).rstrip("\n").split("\n")
H, W = len(F), 40
F = [r.ljust(W, ".") for r in F]
G = [["."] * W for _ in range(H)]

SKIN, HAIR, TEAM, SHOES = "abcde", "fghij", "pqrst", "uvwxy"
DARKER = {"e": "d", "d": "c", "c": "b", "b": "a", "y": "x", "x": "w", "w": "v", "v": "u",
          "j": "i", "i": "h", "h": "g", "g": "f"}

# Rows (from the top of the frame): where each part starts.
NECK_TOP, BODY_TOP, SHORTS_TOP = 29, 36, 65
AXIS_TOP, AXIS_LOW = 19, 21  # centre column of the torso, and of the hips and legs

# --- head ---------------------------------------------------------------------------------------
for y in range(0, NECK_TOP + 2):
    for x in range(W):
        G[y][x] = F[y][x]
for y in range(17, NECK_TOP + 2):
    for x in range(11, 28):
        c = F[y][x]
        if c == ".":
            continue
        hair = F[9 + (y - 17) % 8][x]
        hair = hair if hair in HAIR else "i"
        for _ in range((y >= 23) + (y >= 27)):
            hair = DARKER.get(hair, hair) if hair != "g" else "g"
        G[y][x] = hair
# The nape: the hair ends in tufts over the neck.
tufts = {12: 28, 13: 29, 14: 30, 15: 29, 16: 30, 17: 31, 18: 30, 19: 31, 20: 30, 21: 31, 22: 29, 23: 30,
         24: 29, 25: 28, 26: 27}
for x in range(9, 30):
    end = tufts.get(x, 27 if x < 12 else 28)
    for y in range(end + 1, NECK_TOP + 2):
        if 9 <= x <= 29:
            G[y][x] = "."
    if G[end][x] in HAIR:
        G[end][x] = "f"
neck = "acdddeeedca"  # cols 14..24, light on the right
for y in range(NECK_TOP, BODY_TOP):
    for i, c in enumerate(neck):
        x = 14 + i
        if G[y][x] == "." or y > max(tufts.values()):
            G[y][x] = c
        elif G[y][x] == "f" and 15 <= x <= 23:
            G[y][x] = "g"  # hair over skin, not over the background
for x in range(15, 24):  # shadow under the hair
    for y in range(NECK_TOP, BODY_TOP):
        if G[y][x] in neck[1:-1] and G[y - 1][x] in HAIR:
            G[y][x] = "b"
            break

# --- body: the right half ---------------------------------------------------------------------
R = [list(F[y]) for y in range(H)]
# Back neckline: the collar trim curves down to the middle; skin above it, jersey below.
trim = {19: 39, 20: 39, 21: 39, 22: 39, 23: 38, 24: 38, 25: 37}  # a shallow U
for x in range(AXIS_TOP, 27):
    t = trim.get(x, 37)
    for y in range(BODY_TOP, 46):
        if x == 26 and y == 37:
            continue
        if y < t:
            R[y][x] = "c" if y == t - 1 else ("d" if x < 24 else "c")
        elif y == t:
            R[y][x] = "s"
        elif y == t + 1:
            R[y][x] = "n"
        else:
            R[y][x] = "o"
R[36][25], R[36][26] = "b", "M"
R[38][26] = "o"
# Jersey down to its hem, and the arm ending at the elbow.
for y in range(46, 65):
    for x in range(AXIS_TOP, 27):
        R[y][x] = "o"
for y in range(59, 65):
    R[y][26], R[y][27], R[y][28] = "n", "m", "l"
elbow = {59: (29, "Deeeeee", "L"), 60: (29, "Ddeeed", "N"), 61: (29, "bcddc", "O"), 62: (29, "Mccb", "O"),
         63: (29, "kOOO", ""), 64: (29, "k", "")}
for y, (x0, s, end) in elbow.items():
    for x in range(x0, W):
        R[y][x] = "."
    for i, c in enumerate(s + end):
        R[y][x0 + i] = c
for x in range(AXIS_TOP, 29):
    R[63][x] = "m"
    R[64][x] = "l"
# Shorts: fill in where the hand and ball were, keeping the stripe and the outline on the right.
for y in range(SHORTS_TOP, 88):
    right = max(x for x in range(W) if R[y][x] != ".")
    for x in range(AXIS_LOW, right):
        if R[y][x] not in TEAM + "zAB":
            R[y][x] = "s"
    if y == SHORTS_TOP:
        for x in range(AXIS_LOW, right):
            R[y][x] = "q" if R[y][x] == "s" else R[y][x]
for x in range(AXIS_LOW, AXIS_LOW + 2):  # the seam up the middle
    for y in range(SHORTS_TOP + 2, 85):
        if x == AXIS_LOW:
            R[y][x] = "r"
for y in range(88, H):  # the front frame's other leg reaches past the middle: not ours
    for x in range(AXIS_LOW, AXIS_LOW + 3):
        R[y][x] = "."
for y in range(84, 89):  # between the legs
    for x in range(AXIS_LOW, AXIS_LOW + 2 + (y - 84)):
        R[y][x] = "q" if y < 87 else "."

for y in range(BODY_TOP, H):
    axis = AXIS_TOP if y < SHORTS_TOP else AXIS_LOW
    for x in range(axis, W):
        G[y][x] = R[y][x]
    for x in range(axis + 1, W):
        mx = 2 * axis - x
        if 0 <= mx < W:
            c = R[y][x]
            G[y][mx] = DARKER.get(c, c) if c in SKIN + SHOES else c
# The neck at the top of the body comes from the head pass.
for y in range(BODY_TOP, BODY_TOP + 1):
    for i, c in enumerate(neck):
        if G[y][14 + i] in "." + SKIN:
            G[y][14 + i] = c if 0 < i < len(neck) - 1 else G[y][14 + i]

rows = ["".join(r).rstrip(".") or "." for r in G]
block = f"frame back0 feet {FX} {FY}\n" + "\n".join(rows) + "\n"
text = re.sub(r"\nframe back0 feet[^\n]*\n(?:[^\n]+\n?)+", "\n", text)
open(src, "w").write(text.rstrip("\n") + "\n\n" + block)
print(block)
