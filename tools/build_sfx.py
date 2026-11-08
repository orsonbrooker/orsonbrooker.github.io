"""Packs the recorded sound effects into one small file the game loads once.

Sources are short mono WAVs in art/sfx/, named <sound>-<n>.wav (several takes of one sound play in
turn, so a dribble doesn't repeat the exact same thump) or <sound>.wav. They were cut from the
generated pixel-art videos (see notes). Writes assets/sfx/sfx-<hash>.m4a and assets/sfx/sfx.json:
{"file": ..., "clips": {"bounce": [[start, length], ...], ...}}.

  uv run --with numpy --with scipy python tools/build_sfx.py

Plain AAC (not the announcer's HE-AAC, which smears sharp sounds like a bounce). Needs ffmpeg.
"""
import hashlib
import json
import os
import re
import subprocess
import tempfile

import numpy as np
from scipy.io import wavfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "art", "sfx")
OUT = os.path.join(ROOT, "assets", "sfx")
RATE = 48000
GAP = 0.25  # silence between clips, so a clip played a little long never catches the next one
BITRATE = "96k"


def main():
    names = sorted(f for f in os.listdir(SRC) if f.endswith(".wav"))
    pcm = [np.zeros(int(GAP * RATE), np.int16)]
    pos = len(pcm[0])
    clips = {}
    for f in names:
        sr, x = wavfile.read(os.path.join(SRC, f))
        if sr != RATE or x.ndim != 1:
            raise SystemExit(f"{f}: needs to be mono {RATE} Hz")
        sound = re.sub(r"-\d+$", "", f[:-4])
        clips.setdefault(sound, []).append([round(pos / RATE, 3), round(len(x) / RATE, 3)])
        pcm += [x.astype(np.int16), np.zeros(int(GAP * RATE), np.int16)]
        pos += len(x) + int(GAP * RATE)
    allx = np.concatenate(pcm)
    tmp = os.path.join(tempfile.mkdtemp(), "all.wav")
    wavfile.write(tmp, RATE, allx)
    for f in os.listdir(OUT) if os.path.isdir(OUT) else []:
        os.remove(os.path.join(OUT, f))
    os.makedirs(OUT, exist_ok=True)
    tag = hashlib.sha1(allx.tobytes() + BITRATE.encode()).hexdigest()[:8]
    name = f"sfx-{tag}.m4a"  # a new name whenever the sounds change, so browsers never use a stale copy
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", tmp, "-c:a", "aac", "-b:a", BITRATE,
                    "-movflags", "+faststart", os.path.join(OUT, name)], check=True)
    with open(os.path.join(OUT, "sfx.json"), "w") as fh:
        json.dump({"file": name, "clips": clips}, fh, separators=(",", ":"), sort_keys=True)
    size = os.path.getsize(os.path.join(OUT, name)) / 1024
    print(f"packed {len(names)} clips ({', '.join(f'{k} x{len(v)}' for k, v in clips.items())}) into {name}: {size:.0f} KB")


if __name__ == "__main__":
    main()
