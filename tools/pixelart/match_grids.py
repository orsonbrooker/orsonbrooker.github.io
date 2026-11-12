"""Matches Flow's repainted grids to the grids they were made from, by the picture, and names them
<prefix>-NN-k.img (what key_hair.py and ball_key.py read). Prints how close each match is: a good one is
well under 0.05, and a weak one (or two images on a grid they don't belong to) means a wrong download.

  python tools/pixelart/match_grids.py <grids dir> "<downloads glob>" <prefix>
"""
import glob
import os
import sys

import numpy as np
from PIL import Image


def sig(im):
    a = np.asarray(im.convert("RGB").resize((344, 192), Image.BILINEAR)).astype(float)
    green = (a[..., 1] > a[..., 0] + 30) & (a[..., 1] > a[..., 2] + 20)
    lum = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    return np.where(green, 0, lum / 255)


def main(gdir, pattern, prefix):
    grids = {int(os.path.basename(f)[5:7]): sig(Image.open(f)) for f in sorted(glob.glob(f"{gdir}/grid-[0-9][0-9].jpg"))}
    found = []
    for f in sorted(glob.glob(pattern)):
        s = sig(Image.open(f))
        scores = sorted((float(np.abs(s - gs).mean()), g) for g, gs in grids.items())
        found.append((f, scores[0][1], scores[0][0]))
    for f, _, _ in found:
        os.rename(f, f + ".m")
    counts = {}
    for f, g, score in found:
        counts[g] = counts.get(g, 0) + 1
        new = f"{prefix}-{g:02d}-{counts[g]}.img"
        os.rename(f + ".m", new)
        print(os.path.basename(f), "->", os.path.basename(new), f"{score:.3f}", "WEAK" if score > 0.05 else "")
    print({g: c for g, c in sorted(counts.items())})


if __name__ == "__main__":
    main(*sys.argv[1:4])
