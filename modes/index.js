// The ways to play. The ranked ones (MODES in shared/rules.js) each have their own best and
// leaderboard; Free play (free.js) has neither and never ends. Each mode is a file with the same
// shape; the rest of the game asks the one being played (mode() in play/state.js) instead of
// checking which it is.
//
//   id, bestKey          its name (in MODES, if ranked), and where this device keeps its best (null: none)
//   ranked               whether it ends, has a best, goes on the leaderboard (it gets a start token
//                        from the server) and counts for the daily challenge
//   freeMove             optional: they move the player themselves (play/round.js steerPlayer), and he
//                        stays where he is after each shot
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
// The result (ranked modes only):
//   result()             the number that's ranked and kept as the best (points, or seconds)
//   isBetter(r, best)    whether it beats the best
//   endCall(r, isBest)   the announcer's call at the end, or null
//   overText(r, isBest)  { title, final, unit, detail } for the game-over screen
//   formatBest(best)     a best as shown on the choose-a-game cards
//   boardScore()         what's sent to the leaderboard

import around from "../modes/around.js";
import free from "../modes/free.js";
import survival from "../modes/survival.js";
import timed from "../modes/timed.js";
import { modes } from "../play/state.js";

Object.assign(modes, { timed, survival, around, free });

export { SUDDEN_DEATH } from "../modes/survival.js";
