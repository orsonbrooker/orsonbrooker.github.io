// The ways to play (MODES in shared/rules.js), each with its own best and leaderboard. Each mode is a
// file with the same shape; the rest of the game asks the one being played (mode() in play/state.js)
// instead of checking which it is.
//
//   id, bestKey          its name in MODES, and where this device keeps its best
//   bonusBalls           whether money and rainbow balls come up
// Playing:
//   startSpot()          where the player stands at the start
//   pickSpot()           where he goes after each shot
//   clock(dt)            each frame while playing: the clock, the music, and ending the game (phase "ending")
//   gameSeconds()        how far into the game it is, for the shot log
//   countsShot()         false once a ball still in the air no longer counts
//   onMake(b), onMiss(b) a basket; a miss (after the reaction every mode shares)
//   squeeze()            how much of the timing window is gone (0 to 1)
//   rumble()             how far the court shakes, in court pixels
//   drawFloor(ctx)       optional: drawn on the floor, under the players and balls
// Showing it:
//   hud()                [score, time] text under the court
//   scoreboard()         [[label, value], [label, value]] on the wall scoreboard
// The result:
//   result()             the number that's ranked and kept as the best (points, or seconds)
//   isBetter(r, best)    whether it beats the best
//   endCall(r, isBest)   the announcer's call at the end, or null
//   overText(r, isBest)  { title, final, unit, detail } for the game-over screen
//   formatBest(best)     a best as shown on the choose-a-game cards
//   boardScore()         what's sent to the leaderboard

import around from "../modes/around.js?v=a48ced3a";
import survival from "../modes/survival.js?v=57810ab6";
import timed from "../modes/timed.js?v=1ca20312";
import { modes } from "../play/state.js?v=21175a94";

Object.assign(modes, { timed, survival, around });

export { SUDDEN_DEATH } from "../modes/survival.js?v=57810ab6";
