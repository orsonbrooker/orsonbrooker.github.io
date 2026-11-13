// The ways to play, each with the same shape; the rest of the game asks the one being played (mode() in
// play/state.js) instead of checking which it is. The ones with a leaderboard are MODES in
// shared/rules.js, each with its own best; pass and play games (HORSE) and Free play are only here.
//
//   id, bestKey          its name, and where this device keeps its best (null: no best)
//   ranked               false for Free play: no start token, no leaderboard, no daily challenge, and
//                        it never ends (the others leave it out)
//   freeMove             optional: they move the player themselves (play/round.js steerPlayer), and he
//                        stays where he is after each shot
//   bonusBalls           whether money and rainbow balls come up (from the start token)
//   ballKind(i)          optional: the mode's own ball for shot i instead (the 3-point contest's racks)
// Playing:
//   startSpot()          where the player stands at the start
//   pickSpot()           where he goes after each shot
//   clock(dt)            each frame while playing: the clock, the music, and ending the game (phase "ending")
//   gameSeconds()        how far into the game it is, for the shot log
//   countsShot()         false once a ball still in the air no longer counts
//   onMake(b), onMiss(b) a basket; a miss (after the reaction every mode shares)
//   squeeze()            how much of the timing window is gone (0 to 1)
//   zoneShift()          optional: the moving green zone (play/zone.js), where the green sits this
//                        shot in seconds from the top of the jump; missing or 0 keeps it at the top
//   rumble()             how far the court shakes, in court pixels
//   drawFloor(ctx)       optional: drawn on the floor, under the players and balls
//   drawOver(ctx)        optional: drawn over the court, under the calls (HORSE's letters)
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
// Pass and play (optional, HORSE): several players take turns on one device. No start token, no
// leaderboard, no best, no daily challenge; nothing is sent.
//   passAndPlay          { min, max } players: choosing players picks that many, in turn order
//   setPlayers(list)     who's playing (characters from play/players.js), in turn order
//   begin()              optional, any mode: called at the end of starting a game
//   betweenTurns(dt)     each frame while the phase is "turn" (between shots, while the device is passed on)

import around from "../modes/around.js";
import free from "../modes/free.js";
import horse from "../modes/horse.js";
import survival from "../modes/survival.js";
import threes from "../modes/threes.js";
import timed from "../modes/timed.js";
import { flagOn, released } from "../flags.js";
import { modes } from "../play/state.js";
import { flagForMode } from "../shared/flags.js";

Object.assign(modes, { timed, survival, around, horse, threes, free });

// Modes that aren't out yet have a feature flag (shared/flags.js: the 3-point contest waits for its
// rack art, art/three-point-contest.md; Free play). Until Luke switches it on, the mode's card on
// "Choose a game", its leaderboard tab and its help only show with ?flags= or ?debug.
/** Whether players can choose this mode (and see its leaderboard and help). */
export const modeShown = (id) => !flagForMode(id) || flagOn(flagForMode(id));
/** Whether this mode's games count (scores and coins): false while it only shows for testing. */
export const modeReleased = (id) => !flagForMode(id) || released(flagForMode(id));

export { SUDDEN_DEATH } from "../modes/survival.js";
