"""Generates the announcer's voice clips from phrases.js with Chatterbox (free, runs locally).

Setup (once):
    uv venv --python 3.11 ~/.venvs/announcer
    VIRTUAL_ENV=~/.venvs/announcer uv pip install chatterbox-tts faster-whisper "setuptools<81"
Usage:
    ~/.venvs/announcer/bin/python tools/build_voice.py            # make clips for new phrases
    ~/.venvs/announcer/bin/python tools/build_voice.py --force    # remake every clip
    ~/.venvs/announcer/bin/python tools/build_voice.py --only "on fire"
    ~/.venvs/announcer/bin/python tools/build_voice.py --only "downtown" --samples ~/Desktop/voice  # listen first

Each clip is checked with speech recognition and retried if the words come out garbled.
Clips are kept in .voice-cache/ and packed into one small HE-AAC file (assets/voice/) so the
game makes a single small download. Needs ffmpeg (macOS build, for HE-AAC) and node on the PATH.
"""
import argparse, hashlib, json, os, re, subprocess, sys, tempfile, wave

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'assets', 'voice')
CACHE = os.path.join(ROOT, '.voice-cache')
CLIP_RATE = 22050
GAP = 0.2  # silence between packed clips, so encoder padding never clips a word
BITRATE = '16k'  # tested: as clear as 64k for these clips; 12k starts to blur words

# A hyped 90s arcade announcer: very dramatic delivery, quick pacing.
# VOICE_REF is a short recording whose voice Chatterbox copies (None = its built-in voice).
VOICE_REF = None
PITCH = 0.92  # below 1 is deeper
TEMPO = 1.12  # above 1 is faster
EXAGGERATION = 0.9
CFG_WEIGHT = 0.3
TEMPERATURE = 0.8
TAKES = 3  # clean takes to choose from; the most energetic one wins
MAX_TRIES = 6

# How a phrase should be said, when the written text trips up the voice.
SAY_AS = {
    "Boomshakalaka!": "Boom shaka laka!",
    "GOAT behaviour!": "Goat behaviour!",
    "He's on PURPLE fire!": "He's on purple fire!",
    "That's bussin'!": "That's bussin!",
    "Is it the shoes?!": "Is it the shoes?",
    "Sheesh!": "Sheeeesh!",
    # Build up, then explode on the last word, like the arcade.
    "From downtown!": "From... DOWNTOWN!!",
    "From way downtown!": "From waaay... DOWNTOWN!!",
    "He's dialing long distance!": "He's dialing... LONG DISTANCE!!",
    "From the parking lot!": "From the... PARKING LOT!!",
    "Logo range!": "LOGO... RANGE!!",
}

# Deeper and punchier, then an old arcade-speaker crunch. The game adds the arena echo live.
FILTERS = ",".join([
    "silenceremove=start_periods=1:start_threshold=-40dB",
    "areverse",
    "silenceremove=start_periods=1:start_threshold=-40dB",
    "areverse",
    "asetrate={sr}*{pitch}",
    "aresample={sr}",
    "atempo={tempo}",
    "highpass=f=110",
    "lowpass=f=7000",
    "equalizer=f=2800:t=q:w=1.2:g=5",
    "acompressor=threshold=-22dB:ratio=6:attack=3:release=60:makeup=4",
    "acrusher=bits=12:mode=log:aa=1:mix=0.3",
    "loudnorm=I=-14:TP=-1:LRA=7",
    f"aresample={CLIP_RATE}",
])


def phrases():
    # Every line, plus the she version of each line about the player (SHE).
    js = "import('./phrases.js').then(m => console.log(JSON.stringify({ ...m.PHRASES, she: Object.values(m.SHE) })))"
    data = json.loads(subprocess.run(['node', '-e', js], cwd=ROOT, check=True, capture_output=True, text=True).stdout)
    seen = []
    for group in data.values():
        for p in group:
            if p not in seen:
                seen.append(p)
    return seen


def filename(phrase):
    slug = re.sub(r'[^a-z0-9]+', '-', phrase.lower()).strip('-')[:40]
    return f"{slug}-{hashlib.sha1(phrase.encode()).hexdigest()[:6]}.wav"


def pack(all_phrases):
    """Joins every cached clip into one HE-AAC file plus an index of where each phrase starts."""
    clips, pcm, pos = {}, bytearray(), 0
    gap = b'\0\0' * int(CLIP_RATE * GAP)
    for phrase in all_phrases:
        path = os.path.join(CACHE, filename(phrase))
        if not os.path.exists(path):
            continue
        with wave.open(path) as w:
            frames = w.readframes(w.getnframes())
        pcm += gap + frames
        start = pos + len(gap) // 2
        pos += (len(gap) + len(frames)) // 2
        clips[phrase] = [round(start / CLIP_RATE, 3), round(len(frames) / 2 / CLIP_RATE, 3)]
    pcm += gap
    joined = os.path.join(tempfile.mkdtemp(), 'all.wav')
    with wave.open(joined, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(CLIP_RATE)
        w.writeframes(pcm)

    for f in os.listdir(OUT) if os.path.isdir(OUT) else []:
        os.remove(os.path.join(OUT, f))
    os.makedirs(OUT, exist_ok=True)
    tag = hashlib.sha1(bytes(pcm) + BITRATE.encode()).hexdigest()[:8]
    name = f'announcer-{tag}.m4a'  # new name whenever the clips change, so browsers never use a stale copy
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', joined, '-c:a', 'aac_at', '-profile:a', '4',  # 4 = HE-AAC
                    '-b:a', BITRATE, '-movflags', '+faststart', os.path.join(OUT, name)], check=True)
    with open(os.path.join(OUT, 'voice.json'), 'w') as fh:
        json.dump({'file': name, 'clips': clips}, fh, separators=(',', ':'), sort_keys=True)
    size = os.path.getsize(os.path.join(OUT, name)) / 1024
    print(f'packed {len(clips)} clips ({pos / CLIP_RATE:.0f}s) into {name}: {size:.0f} KB')


def words(text):
    return re.sub(r"[^a-z ]", "", text.lower().replace("-", " ")).split()


def matches(expected, heard):
    want, got = words(expected), set(words(heard))
    return sum(w in got for w in want) / max(1, len(want))


def energy(wav, sr):
    """How hyped a take sounds: louder and higher-pitched scores higher."""
    import numpy as np
    x = wav.squeeze().numpy()
    frame = int(sr * 0.04)
    rms, pitch = [], []
    for i in range(0, len(x) - frame, frame // 2):
        w = x[i:i + frame]
        level = np.sqrt((w ** 2).mean())
        if level < 0.02:
            continue
        rms.append(20 * np.log10(level))
        w = w - w.mean()
        ac = np.correlate(w, w, 'full')[frame - 1:]
        lo, hi = sr // 400, sr // 70
        lag = lo + int(np.argmax(ac[lo:hi]))
        if ac[lag] > 0.3 * ac[0]:
            pitch.append(sr / lag)
    if not rms or not pitch:
        return -99
    return np.log2(np.median(pitch)) + np.percentile(rms, 90) / 12


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--only', help='only phrases containing this text (use | for several)')
    ap.add_argument('--ref', default=VOICE_REF, help='voice to copy (wav)')
    ap.add_argument('--pitch', type=float, default=PITCH)
    ap.add_argument('--tempo', type=float, default=TEMPO)
    ap.add_argument('--exaggeration', type=float, default=EXAGGERATION)
    ap.add_argument('--samples', help='write test clips (mp3) to this folder instead of the game')
    ap.add_argument('--pack-only', action='store_true', help='just repack the cached clips')
    args = ap.parse_args()
    out = args.samples or CACHE
    all_phrases = phrases()
    if args.pack_only:
        pack(all_phrases)
        return

    import torch, torchaudio
    from chatterbox.tts import ChatterboxTTS
    from faster_whisper import WhisperModel

    device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    tts = ChatterboxTTS.from_pretrained(device=device)
    asr = WhisperModel('base.en', device='cpu', compute_type='int8')

    os.makedirs(out, exist_ok=True)
    wanted = [w.strip().lower() for w in (args.only or '').split('|') if w.strip()]
    todo = [p for p in all_phrases if not wanted or any(w in p.lower() for w in wanted)]
    tmp = tempfile.mkdtemp()
    for n, phrase in enumerate(todo, 1):
        name = filename(phrase)
        if args.samples:
            name = name.replace('.wav', '.mp3')
        elif not args.force and os.path.exists(os.path.join(out, name)):
            continue
        text = SAY_AS.get(phrase, phrase)
        takes = []
        for attempt in range(MAX_TRIES):
            wav = tts.generate(text, audio_prompt_path=args.ref, exaggeration=args.exaggeration,
                               cfg_weight=CFG_WEIGHT, temperature=TEMPERATURE)
            raw = os.path.join(tmp, f'take{attempt}.wav')
            torchaudio.save(raw, wav, tts.sr)
            heard = " ".join(s.text for s in asr.transcribe(raw, language='en')[0])
            takes.append((matches(phrase, heard), energy(wav, tts.sr), raw, heard))
            if sum(t[0] >= 0.8 for t in takes) >= TAKES:
                break
        clean = [t for t in takes if t[0] >= 0.8]
        score, _, raw, heard = max(clean, key=lambda t: t[1]) if clean else max(takes, key=lambda t: t[0])
        filters = FILTERS.format(sr=tts.sr, pitch=args.pitch, tempo=args.tempo)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-af', filters,
                        '-ac', '1', os.path.join(out, name)], check=True)
        flag = '' if score >= 0.8 else f'   <- check this one (heard "{heard.strip()}")'
        print(f'[{n}/{len(todo)}] {phrase}{flag}', flush=True)

    if not args.samples:
        pack(all_phrases)


if __name__ == '__main__':
    main()
