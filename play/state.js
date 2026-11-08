// The game in progress: the one shared `state` object, the player, the feel of the shot, which mode
// is being played, and the seeded randomness for where he shoots from and how each shot wobbles.
// Everything else in play/, modes/ and screens/ reads and changes these.

import { DEFAULT_SPOT } from "../engine/court.js";
import { load } from "../engine/storage.js";
import { randomSeed, seededStreams } from "../rng.js";
import { GAME_SECONDS } from "../shared/rules.js";

export const DEBUG = new URLSearchParams(location.search).has("debug");

export const LAUNCH_ANGLE = (52 * Math.PI) / 180;
// Jump timing (seconds since leaving the ground). Releasing at the apex is a perfect shot.
export const JUMP_FRAME_TIME = 0.085;
// Jogging between spots (for players drawn jogging): metres a second, and the longest a move takes,
// so a long run across the court doesn't slow the game down much more than appearing there did.
export const JOG_SPEED = 4.5;
export const JOG_MAX_TIME = 0.9;
export const JUMP_APEX = 0.29;
export const TIMING_WINDOW = 0.13;
export const ANIM_FPS = { idle: 3, turn: 20, dribble: 14, gather: 24, release: 16 };

export const state = {
  phase: "loading", // loading | title | modes | select | playing | ending | over
  score: 0,
  mode: "timed",
  best: 0,
  timeLeft: GAME_SECONDS,
  elapsed: 0, // seconds since the start (sudden death has no clock to count down)
  aroundAt: 0, // around the world: the spot they're on (0 to 6)
  aroundTime: 0, // around the world: the time it took, once it's done
  stats: null, // what happened in this game, for the daily challenge (newStats)
  dailyDone: false, // finished the daily challenge in this game
  overAt: 0,
  balls: [],
  popups: [],
  shake: 0,
  shoeFire: null,
  confetti: [],
  flash: 0,
  timeScale: 1,
  endAt: 0,
  buzzerBeater: false,
  banner: null,
  streak: 0, // makes in a row
  coldStreak: 0, // misses in a row
  pressed: false,
  // For the leaderboard: each shot as [seconds in, 3-pointer, made, release timing], the game's
  // start token from the server, how it was played, and whether the tab was hidden mid-game.
  shotLog: [],
  gameToken: null,
  rngSeed: null, // what this game's random spots and aim came from (its start token, if it had one by then)
  input: "touch",
  hiddenTab: false,
};

export const player = {
  u: DEFAULT_SPOT.u,
  v: DEFAULT_SPOT.v,
  anim: "idle",
  t: 0, // time in current animation
  fade: 1,
  activeBall: null,
  moving: false,
  path: null, // jogging to the next spot: { from, to, t, dur }
  dir: "bl", // which way he faces the hoop from his spot (b, bl, l...), for sheets drawn that way
};

export function setAnim(name) {
  player.anim = name;
  player.t = 0;
  player.lastDribbleFrame = -1;
}

export const made = () => state.shotLog.filter((s) => s[2]).length;

// The very first shot: what to do next, in a bubble over the player. Never shown again after that.
export const hints = { learned: load("orson-hoops-learned", false) };

// ---------- Modes ----------
// The ways to play, by id (modes/index.js fills this in; see there for what each one has).
// mode() is the one being played, from state.mode.
export const modes = {};
export const mode = () => modes[state.mode] ?? modes.timed;

// ---------- Gameplay randomness ----------
// Where he shoots from and how each shot wobbles come from streams seeded by the start token, so the
// same token and the same inputs give the same game. The token is fetched as the game starts, so the
// streams are made at the game's first draw (the first shot's release): from the token if it's here
// by then (it nearly always is), otherwise from a random seed for the whole game. Effects, sounds and
// which announcer line plays stay on Math.random.
const RNG_STREAMS = ["spots", "aim"];
let rng = null; // this game's streams, made at its first draw
let debugSeed = null; // ?debug: a seed to use instead of the token (window.game.setSeed)
export function random(stream) {
  if (!rng) {
    state.rngSeed = debugSeed ?? state.gameToken ?? randomSeed();
    rng = seededStreams(state.rngSeed, RNG_STREAMS);
  }
  return rng[stream]();
}
// A new game: its streams are made at its first draw.
export function resetRandom() {
  rng = null;
}
// ?debug (window.game.setSeed): seed with this instead of the token (null for the token again),
// from the next draw on.
export function setSeed(seed) {
  debugSeed = seed == null ? null : String(seed);
  rng = null;
}
