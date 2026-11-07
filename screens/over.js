// The game-over screen: the result and whether it's a new best, the daily challenge line, and the
// leaderboard result under it (where a new best this week would land, and the button to put it on).

import { countsIn, doneToday, progress, streakDays, todaysChallenge } from "../daily.js";
import { save } from "../engine/storage.js";
import { showRoundResult } from "../leaderboard.js";
import { claimCoins, progress as saved } from "../progress.js";
import { coinsFor } from "../shared/rules.js";
import { icon } from "../ui/icons.js";
import { boardFace, characters } from "../play/players.js";
import { announce, checkDaily } from "../play/react.js";
import { bestShot } from "../play/replay.js";
import { DEBUG, mode, state } from "../play/state.js";
import { $, showScreen } from "../screens/base.js";

// The game's version (game.js's ?v= stamp), sent with scores.
let gameVersion = null;
export function setGameVersion(version) {
  gameVersion = version;
}

export function endGame() {
  state.phase = "over";
  state.overAt = performance.now();
  checkDaily(); // things only known at the end, like the final score
  const m = mode();
  const result = m.result();
  const isBest = m.isBetter(result, state.best);
  if (isBest) {
    state.best = result;
    save(m.bestKey, result);
  }
  const call = m.endCall(result, isBest);
  if (call) announce(call, "#ffe066");
  const text = m.overText(result, isBest);
  $("over-title").textContent = text.title;
  $("final-score").textContent = text.final;
  $("final-unit").textContent = text.unit;
  $("over-detail").textContent = text.detail;
  $("replay").hidden = !bestShot(); // nothing to replay if nothing went in
  showDaily();
  showScreen("over");
  // Pass and play (HORSE) has no leaderboard: nothing is sent.
  if (m.passAndPlay) {
    $("over-board").hidden = true;
    $("over-daily").textContent = "";
    $("over-coins").hidden = true;
  } else {
    showRound();
    showCoins();
  }
}

// The coins this game earned, saved to their progress (progress.js). Worked out here to show straight
// away, then by the server, which has the final say.
async function showCoins() {
  const box = $("over-coins");
  const earned = coinsFor(state.shotLog);
  box.hidden = !earned;
  if (!earned) return;
  const line = (text) => {
    box.innerHTML = icon("coins");
    box.append(text);
  };
  const plus = `+${earned} ${earned === 1 ? "coin" : "coins"}`;
  if (DEBUG) return line(`${plus} (test mode, not saved)`);
  if (!state.gameToken) return line(`${plus}, but no internet, so they couldn't be saved.`);
  line(`${plus}!`);
  const shown = state.overAt;
  try {
    const got = await claimCoins({ token: state.gameToken, mode: state.mode, score: mode().boardScore(), shots: state.shotLog });
    if (state.overAt === shown) line(`+${got} ${got === 1 ? "coin" : "coins"}! You have ${saved.coins}.`);
  } catch (err) {
    if (state.overAt !== shown) return;
    if (err.offline) line(`${plus}, but no internet, so they couldn't be saved.`);
    else box.hidden = true; // the server didn't count this game
  }
}

// The daily challenge line on the game select and game-over screens.
export function showDaily() {
  const challenge = todaysChallenge();
  const days = streakDays();
  const inARow = days > 1 ? ` ${days} days in a row!` : "";
  $("mode-daily").textContent = doneToday() ? `Today's challenge done!${inARow}` : `Today's challenge: ${challenge.text}`;
  let over;
  if (state.dailyDone) over = `Daily challenge complete!${inARow}`;
  else if (doneToday()) over = `Daily challenge done for today.${inARow}`;
  else if (state.stats && countsIn(challenge, state.mode)) over = `Daily challenge: ${challenge.text} (${progress(challenge, state.stats)} of ${challenge.goal})`;
  else over = `Daily challenge: ${challenge.text}`;
  $("over-daily").textContent = over;
}

// Under the final score: where a new best this week would land (and the button to put it on),
// or their own top scores this week.
function showRound() {
  const score = mode().boardScore();
  const c = characters.list.find((p) => p.id === characters.selected);
  const look = { player: characters.selected, base: c?.base ?? null, colours: c?.mine ? c.colours : null }; // their own player, so everyone sees its face
  const shots = state.shotLog;
  showRoundResult($("over-board"), {
    mode: state.mode,
    score,
    look,
    playerName: c?.name ?? "",
    ownPlayer: !!c?.mine,
    canSend: !DEBUG && score > 0,
    faceFor: boardFace,
    payload: () =>
      state.gameToken && {
        token: state.gameToken,
        mode: state.mode,
        score,
        shots,
        ...look,
        input: state.input,
        hiddenTab: state.hiddenTab,
        version: gameVersion,
        debug: DEBUG,
      },
  });
}
