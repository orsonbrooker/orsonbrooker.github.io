"""Cuts the ball out of a drawn frame in a .pix file, so code can move it (a dribble with as many frames
as you like).

Usage: python3 tools/pixelart/ball.py art/pixel/spiky.pix [frame-with-free-ball] [frame ...] [--recut]
  (default: dribble0; any more frames named after it are frames holding the ball: their ball position
  is noted and a copy with the ball taken out from under the hand is made. Those copies are usually
  touched up by hand afterwards, so they're kept as they are unless --recut is given.)

Writes into the .pix file:
  frame ball feet <cx> <cy>       the ball on its own; its "feet" are its centre
  frame <frame>_noball ...        the frame with the ball taken out
  # ball <frame> <x> <y>          a note of where the ball's centre is in each named frame, measured
                                  from the frame's feet (so timelines can start and end a bounce there)
The ball is found as the round patch of orange around the biggest cluster of orange pixels, plus its
outline.
"""
import colorsys, re, sys

src = sys.argv[1]
free = sys.argv[2] if len(sys.argv) > 2 else "dribble0"
recut = "--recut" in sys.argv
others = [a for a in sys.argv[3:] if a != "--recut"]
text = open(src).read()

# Orange palette letters: the ball's colours (never a recolourable part).
orange = set()
for letter, hexc, tag in re.findall(r"^(\S) #([0-9a-f]{6})(.*)$", text, re.M):
    if tag.strip():
        continue
    r, g, b = (int(hexc[i:i + 2], 16) / 255 for i in (0, 2, 4))
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    if 0.0 <= h <= 0.11 and s > 0.45 and v > 0.4:
        orange.add(letter)


def grid(name):
    m = re.search(rf"^frame {name} feet (\d+) (\d+)\n((?:[^\n]+\n)+)", text, re.M)
    rows = m.group(3).rstrip("\n").split("\n")
    return int(m.group(1)), int(m.group(2)), rows, m


def ball_circle(rows):
    """Centre and radius of the biggest cluster of orange pixels."""
    pts = {(y, x) for y, r in enumerate(rows) for x, c in enumerate(r) if c in orange}
    best = []
    while pts:
        stack, comp = [pts.pop()], []
        while stack:
            y, x = stack.pop()
            comp.append((y, x))
            for d in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
                q = (y + d[0], x + d[1])
                if q in pts:
                    pts.remove(q)
                    stack.append(q)
        if len(comp) > len(best):
            best = comp
    ys, xs = [p[0] for p in best], [p[1] for p in best]
    cy, cx = (min(ys) + max(ys)) / 2, (min(xs) + max(xs)) / 2
    r = max(max(ys) - min(ys), max(xs) - min(xs)) / 2
    return cx, cy, r


fx, fy, rows, m = grid(free)
cx, cy, r = ball_circle(rows)
R = r + 1.6  # include the outline
inside = lambda y, x: (x - cx) ** 2 + (y - cy) ** 2 <= R * R
y0, y1 = int(cy - R), int(cy + R) + 1
x0, x1 = int(cx - R), int(cx + R) + 1
ball_rows = ["".join(rows[y][x] if 0 <= y < len(rows) and x < len(rows[y]) and inside(y, x) else "." for x in range(x0, x1 + 1))
             for y in range(y0, y1 + 1)]
def drop_specks(g):
    """Bits of the ball's outline left behind: small specks not joined to the body."""
    seen = set()
    for y0_, row in enumerate(g):
        for x0_, c in enumerate(row):
            if c == "." or (y0_, x0_) in seen:
                continue
            stack, comp = [(y0_, x0_)], []
            seen.add((y0_, x0_))
            while stack:
                y, x = stack.pop()
                comp.append((y, x))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    q = (y + dy, x + dx)
                    if 0 <= q[0] < len(g) and 0 <= q[1] < len(g[q[0]]) and g[q[0]][q[1]] != "." and q not in seen:
                        seen.add(q)
                        stack.append(q)
            if len(comp) < 12:
                for y, x in comp:
                    g[y][x] = "."
    return ["".join(r_) for r_ in g]


noball = drop_specks([list("." if inside(y, x) else c for x, c in enumerate(r_)) for y, r_ in enumerate(rows)])

notes = [f"# ball {free} {cx - fx:g} {cy - fy:g}"]
held = {}  # the other frames with their ball taken out, keeping the hand that's over it
# The hand's skin (not its outline tone, which the ball's outline can share).
skin = set(re.findall(r"^(\S) #[0-9a-f]{6} skin [1-4]$", text, re.M))
for name in others:
    ox, oy, orows, _ = grid(name)
    bx, by, br = ball_circle(orows)
    notes.append(f"# ball {name} {bx - ox:g} {by - oy:g}")
    BR = br + 3  # wider: the hand hides the top of the ball, so its orange looks smaller than it is
    near_skin = lambda y, x: any(0 <= y + dy < len(orows) and 0 <= x + dx < len(orows[y + dy]) and orows[y + dy][x + dx] in skin
                                 for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)))
    cut = []
    for y, row in enumerate(orows):
        out = []
        for x, c in enumerate(row):
            in_ball = (x - bx) ** 2 + (y - by) ** 2 <= BR * BR
            # Inside the ball keep only the hand: its skin, and dark outline pixels touching it.
            if in_ball and c != "." and (c in orange or (c not in skin and not near_skin(y, x))):
                c = "."
            out.append(c)
        cut.append(list(out))
    if recut or not re.search(rf"^frame {name}_noball ", text, re.M):
        held[name] = (ox, oy, drop_specks(cut))

for name in ("ball", f"{free}_noball", *[f"{n}_noball" for n in held]):
    text = re.sub(rf"\nframe {name} feet[^\n]*\n(?:[^\n]+\n?)+", "\n", text)
text = re.sub(r"^# ball \S+ [-\d.]+ [-\d.]+\n", "", text, flags=re.M)
text = text.rstrip("\n") + "\n\n" + "\n".join(notes) + "\n"
text += f"\nframe ball feet {cx - x0:g} {cy - y0:g}\n" + "\n".join(ball_rows) + "\n"
text += f"\nframe {free}_noball feet {fx} {fy}\n" + "\n".join(noball) + "\n"
for name, (ox, oy, cut) in held.items():
    text += f"\nframe {name}_noball feet {ox} {oy}\n" + "\n".join(cut) + "\n"
open(src, "w").write(text)
print("\n".join(notes))
print(f"ball: radius {r:g}, {len(ball_rows[0])}x{len(ball_rows)} px, colours {''.join(sorted(orange))}")
