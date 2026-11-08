// Arena sound for the shootaround, all synthesised with Web Audio (no sound files).
//
// Everything plays through an arena mix: a compressor on the master, a big-room
// reverb send, a crowd bed that swells with the action, and music that builds
// with the game and ducks under the announcer.

const MUSIC_LEVEL = 0.2;
const CROWD_LEVEL = 0.07;

export const sound = {
  ctx: null,
  muted: false,
  musicOn: true,
  speechReady: false,

  // Must be called from a tap or key press: browsers only start audio after one.
  unlock() {
    if (!this.speechReady && "speechSynthesis" in window) {
      speechSynthesis.speak(new SpeechSynthesisUtterance(""));
      this.speechReady = true;
    }
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      buildGraph(this.ctx);
      this.setMuted(this.muted);
      preloadClips();
      preloadSfx();
      // The first tap or key press starts the menu music (browsers block sound before one).
      if (this.musicOn && !music.timer) startMusic("menu");
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  },

  setMuted(muted) {
    this.muted = muted;
    if (muted && "speechSynthesis" in window) speechSynthesis.cancel();
    if (muted && voice.playing) voice.playing.stop();
    if (this.ctx) ramp(bus.master.gain, muted ? 0 : 0.9, 0.05);
  },

  setMusic(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    if (on) startMusic(music.mode ?? "menu");
    else stopMusic(false);
  },

  // What the music is doing (for ?debug in the console).
  musicState() {
    return { mode: music.mode, playing: !!music.timer, layers: { ...music.layers }, bpm: bpm() };
  },

  // How intense the game is right now (game.js calls this as it plays). The music catches up
  // on the next bar.
  setIntensity({ stage = 0, fire = 0, final = false }) {
    const w = music.wanted;
    if (w && w.stage === stage && w.fire === fire && w.final === final) return;
    music.wanted = { stage, fire, final };
  },

  // Plays the recorded announcer clip for a phrase, or falls back to the device voice.
  say(text) {
    if (this.muted) return;
    if (voice.clips[text] && this.ctx) {
      playClip(voice.clips[text]);
      return;
    }
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const line = new SpeechSynthesisUtterance(text);
    line.rate = 1.1;
    line.pitch = 0.8;
    line.lang = "en-US";
    line.onstart = () => duck(true);
    line.onend = line.onerror = () => duck(false);
    speechSynthesis.speak(line);
  },

  // ---- Game moments ----

  gameStart() {
    if (!this.ctx) return;
    crowdLevel(1);
    horn(0.35);
    cheer(0.8);
    music.wanted = { stage: 0, fire: 0, final: false };
    music.mode = "game";
    if (this.musicOn) {
      stopMusic(false);
      startMusic("game");
    }
  },

  gameOver() {
    if (!this.ctx) return;
    music.wanted = null;
    if (music.timer) {
      stopMusic(false);
      ramp(bus.music.gain, MUSIC_LEVEL, 0.05);
      outro();
    }
    music.mode = "menu";
    setTimeout(() => {
      if (this.musicOn && music.mode === "menu" && !music.timer) startMusic("menu");
    }, 3500);
    horn(1.3);
    cheer(1.2);
    setTimeout(() => crowdLevel(0.35), 2500);
  },

  buzzerBeater() {
    if (!this.ctx) return;
    // The place erupts: a huge roar, the crowd bed surges, and three arena horn blasts.
    cheer(3);
    crowdLevel(1.6);
    setTimeout(() => crowdLevel(0.35), 4000);
    [0, 0.45, 0.9].forEach((delay) => setTimeout(() => horn(0.3), delay * 1000));
  },

  bounce(speed) {
    if (!this.ctx) return;
    const v = Math.min(1, speed / 7);
    // Softer bounces sound a touch higher and shorter, like a ball settling.
    if (playSfx("bounce", 0.75 * v, 1 + (1 - v) * 0.15)) return;
    const t = now();
    // Hardwood: a low thump with a short body resonance and a slap on top.
    tone("sine", 95, t, 0.18, { to: 55, peak: 0.55 * v });
    tone("triangle", 190, t, 0.07, { to: 150, peak: 0.18 * v });
    noise(t, 0.03, { type: "highpass", freq: 1800, peak: 0.12 * v });
  },

  dribble() {
    if (!this.ctx) return;
    // A recorded bounce on the hardwood (the synthesised one until the recordings have loaded).
    if (playSfx("bounce", 0.4, 0.97 + Math.random() * 0.06)) return;
    const t = now();
    tone("sine", 110, t, 0.14, { to: 60, peak: 0.22 });
    noise(t, 0.025, { type: "highpass", freq: 2000, peak: 0.04 });
  },

  // A sneaker footstep, for planting the feet (and running, once players run).
  step(level = 1) {
    if (this.ctx) playSfx("step", 0.35 * level, 0.95 + Math.random() * 0.1);
  },

  rim(speed) {
    if (!this.ctx) return;
    const v = Math.min(1, speed / 5);
    const t = now();
    // Metal: inharmonic partials that ring out at different rates.
    const partials = [
      [523, 0.9, 0.22],
      [1307, 0.6, 0.12],
      [2149, 0.35, 0.08],
      [3388, 0.2, 0.05],
    ];
    for (const [f, decay, peak] of partials) tone("sine", f * (0.98 + Math.random() * 0.04), t, decay * (0.5 + v), { peak: peak * v, reverb: 0.5 });
    noise(t, 0.02, { type: "bandpass", freq: 3000, peak: 0.15 * v });
  },

  board(speed) {
    if (!this.ctx) return;
    const v = Math.min(1, speed / 6);
    const t = now();
    tone("sine", 120, t, 0.22, { to: 80, peak: 0.4 * v });
    noise(t, 0.12, { type: "bandpass", freq: 450, q: 2, peak: 0.25 * v });
    // Glass and frame rattle.
    tone("square", 310, t, 0.15, { peak: 0.03 * v, tremolo: 32 });
  },

  swish() {
    if (!this.ctx) return;
    const t = now();
    noise(t, 0.32, { type: "bandpass", freq: 6500, to: 2200, q: 1.2, peak: 0.5, attack: 0.02 });
    noise(t + 0.05, 0.4, { type: "bandpass", freq: 1800, to: 900, q: 0.8, peak: 0.15, attack: 0.05 });
  },

  squeak() {
    if (!this.ctx) return;
    if (playSfx("squeak", 0.3, 0.92 + Math.random() * 0.16)) return;
    const t = now();
    const f = 1700 + Math.random() * 600;
    tone("triangle", f, t, 0.13, { to: f * 1.35, peak: 0.07, vibrato: 45, attack: 0.01 });
  },

  // Crowd reaction to a basket: 1 is a normal make, 2 is a huge moment.
  cheer(level = 1) {
    if (!this.ctx) return;
    cheer(level);
  },
  ooh() {
    if (this.ctx) ooh(0.8);
  },
  groan() {
    if (this.ctx) groan();
  },

  // level 0 is the first (orange) fire; higher levels add a magic shimmer and a bigger roar.
  fireIgnite(level = 0) {
    if (!this.ctx) return;
    const t = now();
    noise(t, 0.6, { type: "lowpass", freq: 300, to: 5000 + level * 3000, peak: 0.45, attack: 0.15 });
    tone("sine", 80, t, 0.5, { to: 40, peak: 0.4 });
    for (let i = 0; i < level * 4; i++) {
      tone("triangle", 880 * Math.pow(1.26, i), t + 0.1 + i * 0.06, 0.4, { peak: 0.08, reverb: 0.6 });
    }
    cheer(2 + level * 0.8);
  },

  fireWhoosh() {
    if (!this.ctx) return;
    noise(now(), 0.35, { type: "bandpass", freq: 700, to: 2600, q: 0.9, peak: 0.3, attack: 0.08 });
  },

  crackle() {
    if (!this.ctx) return;
    const t = now() + Math.random() * 0.03;
    noise(t, 0.004 + Math.random() * 0.01, { type: "bandpass", freq: 2000 + Math.random() * 4000, q: 2, peak: 0.08 + Math.random() * 0.12 });
  },

  tick() {
    if (!this.ctx) return;
    tone("square", 1320, now(), 0.06, { peak: 0.06, reverb: 0.1 });
  },
};

// ---------- Graph ----------

const bus = {};
let noiseBuffer;

function buildGraph(ctx) {
  bus.master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  bus.master.connect(comp).connect(ctx.destination);

  bus.reverb = ctx.createConvolver();
  bus.reverb.buffer = arenaImpulse(ctx, 2.4);
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  bus.reverb.connect(wet).connect(bus.master);

  bus.sfx = send(ctx, 1, 0.25);
  bus.crowd = send(ctx, 0, 0.35);
  bus.music = send(ctx, 0, 0.08);
  bus.voice = send(ctx, 1.1, 0.22);
  bus.duck = 1;

  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuffer.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  startCrowdBed(ctx);
}

// A gain node feeding the master directly plus a reverb send.
function send(ctx, level, reverbAmount) {
  const g = ctx.createGain();
  g.gain.value = level;
  g.connect(bus.master);
  const s = ctx.createGain();
  s.gain.value = reverbAmount;
  g.connect(s).connect(bus.reverb);
  return g;
}

// Big-room impulse: early reflections then a long diffuse tail.
function arenaImpulse(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2);
    }
    for (let r = 0; r < 8; r++) {
      const at = Math.floor(ctx.sampleRate * (0.012 + Math.random() * 0.08));
      data[at] += (Math.random() < 0.5 ? -1 : 1) * (0.9 - r * 0.08);
    }
  }
  return buf;
}

// ---------- Building blocks ----------

function now() {
  return sound.ctx.currentTime;
}

function ramp(param, value, time) {
  const t = now();
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.linearRampToValueAtTime(value, t + time);
}

function envelope(gain, t, attack, peak, decay) {
  gain.gain.value = 0.0001; // silent until t, which may be slightly in the future
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function tone(type, freq, t, decay, { to, peak = 0.2, attack = 0.004, vibrato, tremolo, reverb, out = bus.sfx } = {}) {
  const ctx = sound.ctx;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + attack + decay);
  if (vibrato) lfo(osc.frequency, vibrato, freq * 0.04, t, attack + decay);
  envelope(g, t, attack, peak, decay);
  let node = osc.connect(g);
  if (tremolo) {
    const trem = ctx.createGain();
    lfo(trem.gain, tremolo, 0.5, t, attack + decay);
    node = node.connect(trem);
  }
  node.connect(out);
  if (reverb) {
    const s = ctx.createGain();
    s.gain.value = reverb;
    g.connect(s).connect(bus.reverb);
  }
  osc.start(t);
  osc.stop(t + attack + decay + 0.05);
}

function lfo(param, rate, depth, t, duration) {
  const ctx = sound.ctx;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = rate;
  g.gain.value = depth;
  o.connect(g).connect(param);
  o.start(t);
  o.stop(t + duration + 0.05);
}

function noise(t, decay, { type = "bandpass", freq = 1000, to, q = 1, peak = 0.2, attack = 0.002, out = bus.sfx } = {}) {
  const ctx = sound.ctx;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + attack + decay);
  f.Q.value = q;
  const g = ctx.createGain();
  envelope(g, t, attack, peak, decay);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 1.5);
  src.stop(t + attack + decay + 0.05);
}

// ---------- Crowd ----------

let crowdBed;

// A looping murmur: pink noise with a slow, uneven "babble" swell, shaped to voice range.
function startCrowdBed(ctx) {
  const seconds = 6;
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0;
    const lfos = Array.from({ length: 5 }, () => [0.3 + Math.random() * 2.5, Math.random() * Math.PI * 2]);
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      const pink = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      const time = i / ctx.sampleRate;
      // Whole-number cycles over the loop so it repeats without a seam.
      let mod = 0;
      for (const [rate, phase] of lfos) mod += Math.sin(2 * Math.PI * (Math.round(rate * seconds) / seconds) * time + phase);
      data[i] = pink * (0.75 + 0.05 * mod);
    }
  }
  crowdBed = ctx.createBufferSource();
  crowdBed.buffer = buf;
  crowdBed.loop = true;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 180;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 2200;
  const voice = ctx.createBiquadFilter();
  voice.type = "peaking";
  voice.frequency.value = 650;
  voice.gain.value = 6;
  crowdBed.connect(hp).connect(lp).connect(voice).connect(bus.crowd);
  crowdBed.start();
}

let crowdTarget = 0;
function crowdLevel(level) {
  crowdTarget = level;
  ramp(bus.crowd.gain, CROWD_LEVEL * level * bus.duck, 0.8);
}

function cheer(level) {
  const t = now();
  // The bed swells, then settles back.
  const g = bus.crowd.gain;
  const base = CROWD_LEVEL * crowdTarget * bus.duck;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(base * (1.6 + level * 0.6), t + 0.15);
  g.linearRampToValueAtTime(base, t + 1.2 + level * 0.8);
  // A bright roar on top.
  noise(t, 0.9 + level * 0.9, { type: "bandpass", freq: 1400, q: 0.6, peak: 0.12 * level, attack: 0.12 });
  noise(t, 1 + level, { type: "bandpass", freq: 700, q: 0.8, peak: 0.1 * level, attack: 0.18 });
  // Whistles for the big ones.
  for (let i = 0; i < Math.floor(level); i++) {
    const at = t + 0.1 + Math.random() * 0.5;
    const f = 2400 + Math.random() * 700;
    tone("sine", f, at, 0.35, { to: f * 1.1, peak: 0.04, vibrato: 7, attack: 0.04, reverb: 0.4 });
  }
}

// Lots of voices sliding together: "ooooh" when it rattles out.
function crowdVoices(count, from, glide, decay, filterFreq, peak) {
  const ctx = sound.ctx;
  const t = now();
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = filterFreq;
  lp.Q.value = 1.5;
  lp.connect(bus.sfx);
  for (let i = 0; i < count; i++) {
    const f = from * (0.7 + Math.random() * 0.8);
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * glide[0], t + 0.25);
    o.frequency.linearRampToValueAtTime(f * glide[1], t + decay);
    const g = ctx.createGain();
    envelope(g, t + Math.random() * 0.06, 0.12, peak, decay);
    o.connect(g).connect(lp);
    o.start(t);
    o.stop(t + decay + 0.3);
  }
}

function ooh(level) {
  crowdVoices(14, 230, [1.15, 1.0], 0.9, 600, 0.03 * level);
}

function groan() {
  crowdVoices(14, 260, [1.0, 0.72], 1.1, 1100, 0.025);
}

// Arena horn: two detuned saws and a sub, driven a little hard.
function horn(length) {
  const ctx = sound.ctx;
  const t = now();
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * 2 - 1;
    curve[i] = Math.tanh(x * 2.5);
  }
  shaper.curve = curve;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 2400;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
  g.gain.setValueAtTime(0.22, t + length);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length + 0.12);
  shaper.connect(lp).connect(g).connect(bus.sfx);
  for (const [type, f] of [["sawtooth", 233], ["sawtooth", 236.5], ["square", 116.5]]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.connect(shaper);
    o.start(t);
    o.stop(t + length + 0.2);
  }
}

// ---------- Music ----------
//
// All made here, a step at a time, so it can change with the game:
//   menu  a laid-back groove for the title and menus
//   game  a 16-bit funk vamp (Em7 to A7) that builds as the game goes on:
//         stage 0  kick, snare and bass
//         stage 1  (40 seconds left) hi-hats and ghost notes
//         stage 2  (20 seconds left) chord stabs, busier hats, a bit faster
//         on fire  a lead melody joins in, an octave higher on purple fire
//         final    (10 seconds left) faster still, pumping bass, snare rolls
// Changes land on the next bar so it always stays in time, with a crash to mark them.

const music = { mode: null, timer: null, step: 0, next: 0, layers: { stage: 0, fire: 0, final: false }, wanted: null };
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

const GAME = {
  bass: { 0: [40, 2], 3: [40, 1], 6: [52, 1], 8: [43, 2], 10: [45, 1], 12: [47, 2], 14: [50, 1], 16: [45, 2], 19: [45, 1], 22: [57, 1], 24: [48, 2], 26: [49, 1], 28: [52, 2], 30: [55, 1] },
  chords: [[64, 67, 71, 74], [57, 61, 64, 67]],
  stabs: [2, 7, 10],
  kick: [0, 3, 10, 16, 19, 26],
  snare: [4, 12, 20, 28],
  ghost: [7, 15, 23, 31],
  lead: { 0: 76, 2: 79, 3: 83, 6: 86, 8: 83, 10: 79, 12: 81, 14: 79, 16: 76, 18: 73, 19: 76, 22: 79, 24: 81, 26: 79, 28: 76, 30: 73 },
};
const MENU = {
  bpm: 90,
  bass: { 0: [40, 6], 7: [47, 2], 10: [43, 4], 16: [45, 6], 23: [52, 2], 26: [49, 4] },
  chords: [[64, 67, 71, 74, 78], [57, 61, 64, 67, 71]], // Em9, A9
  bell: { 2: 83, 5: 79, 9: 76, 13: 74, 18: 76, 21: 73, 25: 69, 29: 71 },
};

function bpm() {
  if (music.mode === "menu") return MENU.bpm;
  const { stage, final } = music.layers;
  return final ? 124 : stage >= 2 ? 112 : 108;
}

function musicLevel() {
  return MUSIC_LEVEL * (music.mode === "menu" ? 0.75 : 1) * bus.duck;
}

function startMusic(mode) {
  if (!sound.ctx) return;
  if (music.timer && music.mode === mode) return;
  clearInterval(music.timer);
  music.mode = mode;
  music.step = 0;
  music.layers = { ...music.wanted ?? { stage: 0, fire: 0, final: false } };
  music.next = now() + 0.1;
  ramp(bus.music.gain, musicLevel(), 0.3);
  music.timer = setInterval(scheduleMusic, 25);
}

function stopMusic(fade) {
  if (!sound.ctx) return;
  ramp(bus.music.gain, 0, fade ? 1.2 : 0.2);
  clearInterval(music.timer);
  music.timer = null;
}

function scheduleMusic() {
  while (music.next < now() + 0.12) {
    const s = music.step % 32;
    // New layers come in on the downbeat of a bar, with a crash if things got bigger.
    if (s % 16 === 0 && music.wanted && music.mode === "game") {
      const before = music.layers;
      const after = music.wanted;
      const bigger = after.stage > before.stage || after.fire > before.fire || (after.final && !before.final);
      music.layers = { ...after };
      if (bigger) crash(music.next);
    }
    if (music.mode === "menu") playMenuStep(s, music.next);
    else playGameStep(s, music.next);
    music.next += 60 / bpm() / 4;
    music.step++;
  }
}

function crash(t) {
  noise(t, 1.4, { type: "highpass", freq: 5000, peak: 0.16, out: bus.music });
}

function bassNote(note, t, len, { type = "square", bright = 1400, peak = 0.5 } = {}) {
  const ctx = sound.ctx;
  const stepLen = 60 / bpm() / 4;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = midi(note);
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(bright, t);
  f.frequency.exponentialRampToValueAtTime(300, t + stepLen * len);
  const g = ctx.createGain();
  envelope(g, t, 0.005, peak, stepLen * len);
  o.connect(f).connect(g).connect(bus.music);
  o.start(t);
  o.stop(t + stepLen * len + 0.05);
}

function playGameStep(s, t) {
  const out = bus.music;
  const { stage, fire, final } = music.layers;
  const bar = s < 16 ? 0 : 1;
  const stepLen = 60 / bpm() / 4;

  // Bass: the riff, and in the final seconds an eighth-note pump underneath it.
  if (GAME.bass[s]) bassNote(GAME.bass[s][0], t, GAME.bass[s][1]);
  else if (final && s % 2 === 0) bassNote(bar ? 45 : 40, t, 1, { peak: 0.3, bright: 900 });

  // Drums.
  if (GAME.kick.includes(s) || (final && s % 4 === 0)) tone("sine", 150, t, 0.18, { to: 45, peak: 0.7, out });
  if (GAME.snare.includes(s)) {
    noise(t, 0.14, { type: "highpass", freq: 1500, peak: 0.35, out });
    tone("triangle", 190, t, 0.08, { peak: 0.25, out });
  }
  // A snare roll into every other bar when time's nearly up.
  if (final && s >= 28) noise(t, 0.06, { type: "highpass", freq: 1800, peak: 0.12 + (s - 28) * 0.06, out });
  if (stage >= 1 && GAME.ghost.includes(s)) noise(t, 0.05, { type: "highpass", freq: 2000, peak: 0.08, out });
  if (stage >= 1) {
    const offbeat = s % 4 === 2;
    if (stage >= 2 || s % 2 === 0) noise(t, offbeat ? 0.06 : 0.03, { type: "highpass", freq: 7000, peak: offbeat ? 0.12 : 0.06, out });
  }
  if (fire && s % 8 === 6) noise(t, 0.25, { type: "highpass", freq: 6000, peak: 0.09, out }); // open hat

  // Chord stabs.
  if (stage >= 2 && GAME.stabs.includes(s % 16)) {
    for (const n of GAME.chords[bar]) tone("sawtooth", midi(n), t, stepLen * 0.9, { peak: 0.05, out });
  }

  // On fire: a lead line, up an octave on purple fire.
  if (fire && GAME.lead[s]) {
    const note = GAME.lead[s] + (fire >= 2 ? 12 : 0);
    tone("square", midi(note), t, stepLen * 1.6, { peak: 0.045, out, vibrato: fire >= 2 ? 6 : 0 });
  }
}

function playMenuStep(s, t) {
  const out = bus.music;
  const bar = s < 16 ? 0 : 1;
  const stepLen = 60 / bpm() / 4;
  // A soft pad on each bar, round sine bass, little bell melody and light drums.
  if (s % 16 === 0) for (const n of MENU.chords[bar]) tone("triangle", midi(n), t, stepLen * 15, { peak: 0.028, attack: 0.25, out });
  if (MENU.bass[s]) bassNote(MENU.bass[s][0], t, MENU.bass[s][1], { type: "triangle", bright: 700, peak: 0.55 });
  if (MENU.bell[s]) tone("sine", midi(MENU.bell[s]), t, stepLen * 3, { peak: 0.05, out, reverb: 0.4 });
  if (s % 16 === 0 || s % 16 === 10) tone("sine", 120, t, 0.16, { to: 45, peak: 0.45, out });
  if (s % 8 === 4) noise(t, 0.05, { type: "bandpass", freq: 1800, q: 2, peak: 0.12, out }); // rim click
  if (s % 2 === 0) noise(t, 0.025, { type: "highpass", freq: 8000, peak: s % 4 === 2 ? 0.05 : 0.025, out });
}

// The game's last chord rings out, then the menu groove comes back.
function outro() {
  const t = now() + 0.05;
  for (const n of [52, 64, 67, 71, 74, 78]) tone("sawtooth", midi(n), t, 1.6, { peak: 0.035, out: bus.music });
  crash(t);
}

// ---------- Recorded sound effects ----------

// Bounces, a sneaker squeak and footsteps, recorded with the pixel-art videos and packed into one
// small file by tools/build_sfx.py. Each sound has a few takes, played in turn.
const sfx = { file: null, clips: {}, buffer: null, loading: null, shift: 0, next: {} };

export async function loadSoundClips() {
  try {
    const res = await fetch("assets/sfx/sfx.json");
    if (res.ok) Object.assign(sfx, await res.json());
  } catch {
    // No recordings: the synthesised sounds play instead.
  }
  if (sound.ctx) preloadSfx();
}

function preloadSfx() {
  if (!sfx.file || sfx.loading) return sfx.loading;
  sfx.loading = fetch(`assets/sfx/${sfx.file}`)
    .then((r) => r.arrayBuffer())
    .then((data) => sound.ctx.decodeAudioData(data))
    .then((buffer) => {
      sfx.shift = encoderDelay(buffer, Object.values(sfx.clips).flat());
      return (sfx.buffer = buffer);
    })
    .catch(() => null);
  return sfx.loading;
}

// Plays the next take of a recorded sound; false if the recordings aren't ready yet.
function playSfx(name, gain = 1, rate = 1) {
  const takes = sfx.clips[name];
  if (!sfx.buffer || !takes?.length) return false;
  const i = (sfx.next[name] ?? Math.floor(Math.random() * takes.length)) % takes.length;
  sfx.next[name] = i + 1;
  const [start, duration] = takes[i];
  const src = sound.ctx.createBufferSource();
  src.buffer = sfx.buffer;
  src.playbackRate.value = rate;
  const g = sound.ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(bus.sfx);
  src.start(now(), Math.max(0, start + sfx.shift - 0.005), duration + 0.01);
  return true;
}

// ---------- Recorded announcer ----------

// All the clips live in one small file; voice.json says where each phrase starts and how long
// it runs (made by tools/build_voice.py).
const voice = { file: null, clips: {}, buffer: null, loading: null, playing: null, shift: 0 };

export async function loadVoiceClips() {
  try {
    const res = await fetch("assets/voice/voice.json");
    if (res.ok) Object.assign(voice, await res.json());
  } catch {
    // No clips: the device voice is used instead.
  }
  if (sound.ctx) preloadClips();
}

// Download and decode the clip file once audio is unlocked.
function preloadClips() {
  if (!voice.file || voice.loading) return voice.loading;
  voice.loading = fetch(`assets/voice/${voice.file}`)
    .then((r) => r.arrayBuffer())
    .then((data) => sound.ctx.decodeAudioData(data))
    .then((buffer) => {
      voice.shift = encoderDelay(buffer, Object.values(voice.clips));
      return (voice.buffer = buffer);
    })
    .catch(() => null);
  return voice.loading;
}

// Some decoders keep the encoder's few ms of lead-in silence and some drop it, so find where the
// first clip really starts and shift every clip by the same amount.
function encoderDelay(buffer, clips) {
  const data = buffer.getChannelData(0);
  const first = Math.min(...clips.map(([start]) => start));
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i]) > 0.02) return Math.max(-0.1, Math.min(0.4, i / buffer.sampleRate - first));
  }
  return 0;
}

async function playClip([start, duration]) {
  const buffer = voice.buffer || (await preloadClips());
  if (!buffer || sound.muted) return;
  if (voice.playing) voice.playing.stop();
  const src = sound.ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(bus.voice);
  src.onended = () => {
    if (voice.playing === src) {
      voice.playing = null;
      duck(false);
    }
  };
  voice.playing = src;
  duck(true);
  // A little early and late, inside the silence between clips, so no word gets clipped.
  src.start(0, Math.max(0, start + voice.shift - 0.03), duration + 0.1);
}

// The announcer cuts through: music and crowd dip while he talks.
function duck(on) {
  if (!sound.ctx) return;
  bus.duck = on ? 0.4 : 1;
  if (music.timer) ramp(bus.music.gain, musicLevel(), 0.15);
  ramp(bus.crowd.gain, CROWD_LEVEL * crowdTarget * bus.duck, 0.15);
}

// Pause everything with the tab so the music doesn't stutter in the background.
document.addEventListener("visibilitychange", () => {
  if (!sound.ctx) return;
  if (document.hidden) sound.ctx.suspend();
  else sound.ctx.resume();
});
