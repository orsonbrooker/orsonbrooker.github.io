"""Writes a dribble into a .pix file as a timeline: the hand stays on the ball, pushing it down and
riding it back up, with the in-between arm positions and the bounce made by code.

Usage: python3 tools/pixelart/dribble.py art/pixel/spiky.pix [fps]
  (run tools/pixelart/ball.py first: it cuts out the ball and notes where it is in each frame)

The two drawings are the ends of the push: dribble1, hand on the ball at the hip, and dribble0, arm
stretched down over the ball on the floor. In between, the forearm of dribble1 (with the ball cut out
from under it) is swung down with `bend`, and the ball is drawn under the hand, so they move
together. One frame of the ball squashed on the floor between two dribble0s, then back up, slowing.
14 frames at the default 22 fps: 0.64 s, the same as the drawn dribble.
"""
import re, sys

src = sys.argv[1]
fps = sys.argv[2] if len(sys.argv) > 2 else "22"
text = open(src).read()
pos = {n: (float(x), float(y)) for n, x, y in re.findall(r"^# ball (\S+) ([-\d.]+) ([-\d.]+)$", text, re.M)}
(hx, hy), (fx, fy) = pos["dribble1"], pos["dribble0"]  # ball centre: in the hand at the hip, on the floor

# dribble1's forearm: it runs left from the elbow; columns left of PIVOT swing down, the most at END.
PIVOT, END, TOP = -18, -39, -50


def pushed(n, flip):
    """dribble1 with the forearm swung down n pixels at the fingertips, the ball under the hand."""
    share = (PIVOT - hx) / (PIVOT - END)  # how much of n the ball's centre column sinks
    return f"dribble1_noball bend {PIVOT} {END} {TOP} {n} ball ball {hx:.0f} {hy + n * share:.0f}{' flip' if flip else ''} under"


lines = [f"timeline dribble {fps}",
         "dribble1",
         pushed(3, False),   # pushing down: getting faster
         pushed(8, True),
         pushed(14, True),
         "dribble0",         # arm stretched down, ball on the floor
         f"dribble0_noball ball ball {fx:.0f} {fy:.0f} squash under",
         "dribble0",         # bouncing back up into the hand
         pushed(14, False),
         pushed(10, False),
         pushed(7, True),
         pushed(4, True),
         pushed(2, False),   # slowing into the hip
         "dribble1",
         "dribble1"]
block = "# Dribble: the ball cut out by tools/pixelart/ball.py, the push and bounce by tools/pixelart/dribble.py.\n" + "\n".join(lines) + "\n"
text = re.sub(r"# Dribble: the ball cut out[^\n]*\ntimeline dribble [^\n]*\n(?:[^\n]+\n)+", "", text)
i = text.index("\ntimeline ")
text = text[:i + 1] + block + "\n" + text[i + 1:]
open(src, "w").write(text)
print("\n".join(lines))
