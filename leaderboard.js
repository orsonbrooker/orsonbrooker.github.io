// Shootaround's leaderboard: what a game's end shows, sending a score, and the top 10 for this
// week and all time.
//
// Each game asks the server for a signed start token when it begins. A score is sent with that
// token and the game's shot log, and the server checks they add up (see worker/src/index.ts,
// postScore). Odd-looking scores still show, flagged for Orson to check.

import { say } from "./ui/form.js";
import { icon } from "./ui/icons.js";
import { confirmDialog } from "./ui/confirm.js";
import { API } from "./api.js";
import { lowWins } from "./shared/rules.js";

const NICKNAME = "orson-hoops-nickname";
const NICKNAME_AT = "orson-hoops-nickname-at"; // when it was typed: the latest wins across their devices
/** Where the nickname is kept: saved progress (progress.js) carries it to their other devices. */
export const NICKNAME_KEYS = { name: NICKNAME, at: NICKNAME_AT };
const MY_SCORES = "orson-hoops-my-scores";

const load = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
};
const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing: it just isn't remembered.
  }
};

// The same random id the ideas board uses, so each browser counts as one person.
export function deviceId() {
  try {
    let id = localStorage.getItem("orson-device");
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, "");
      localStorage.setItem("orson-device", id);
    }
    return id;
  } catch {
    deviceId.fallback ??= crypto.randomUUID().replace(/-/g, "");
    return deviceId.fallback;
  }
}

// A start token for the game that's beginning, or null if the server can't be reached.
export async function startToken() {
  try {
    const res = await fetch(`${API}/games`, { method: "POST" });
    return res.ok ? (await res.json()).token : null;
  } catch {
    return null;
  }
}

let config;
let turnstileLoading;
function robotCheck(into) {
  config ??= fetch(`${API}/config`).then((r) => (r.ok ? r.json() : Promise.reject(new Error("offline"))));
  turnstileLoading ??= new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement("script"), { src: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", async: true });
    s.onload = () => resolve(window.turnstile);
    s.onerror = reject;
    document.head.append(s);
  });
  return Promise.all([config, turnstileLoading]).then(
    ([cfg, turnstile]) =>
      new Promise((resolve) => {
        turnstile.render(into, {
          sitekey: cfg.turnstileSiteKey,
          callback: resolve,
          "expired-callback": () => turnstile.reset(into),
        });
      }),
  );
}

// Every game played on this device, so they can see their own scores. Kept in this browser only.
const MY_GAMES = "orson-hoops-my-games";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "long" });
function when(at) {
  const day = (t) => new Date(t).toDateString();
  if (day(at) === day(Date.now())) return "Today";
  if (day(at) === day(Date.now() - 864e5)) return "Yesterday";
  return WEEKDAY.format(at);
}

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

// Around the world is timed: its score is the time in tenths of a second, and lower is better.
// (lowWins, from shared/rules.js, says Around the World ranks the fastest first.)
const scoreText = (mode, score) => (lowWins(mode) ? `${(score / 10).toFixed(1)}s` : String(score));
const scoresWord = (mode) => (lowWins(mode) ? "times" : "scores");

// What the game-over screen shows under the score, in `box`:
//   a new best this week: the board around where it would land (two above, two below), with
//   their nickname (a box to type it the first time) and a button to put it on
//   otherwise: their own top scores this week, from this device
// round: { score, look: {player, base, colours}, playerName, ownPlayer, canSend, payload(), faceFor }
// payload() is the game to send (with its start token), asked for only when they press the button.
// The nickname starts as their own player's name if they made the player, otherwise the nickname
// they typed last time, otherwise the name of who they played as (say "Orson").
export function showRoundResult(box, round) {
  const { score, look, playerName, ownPlayer, faceFor } = round;
  const mode = round.mode ?? "timed"; // each mode has its own board
  const at = Date.now();
  const game = { score, at, mode, ...look };
  const games = [game, ...load(MY_GAMES, [])].slice(0, 300);
  save(MY_GAMES, games);
  box.hidden = false;
  const typedBefore = load(NICKNAME, "");
  let nickname = (ownPlayer ? playerName : typedBefore || playerName).slice(0, 12);
  let editing = !ownPlayer && !typedBefore; // the first time, the name is a box to type in

  const preview = (name) =>
    fetch(`${API}/scores/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: name, score, mode, player: look.player, device: deviceId() }),
    }).then(async (res) => {
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(out.error), { checked: res.status === 400 });
      return out;
    });

  // Not a best (or nothing to send): their own top five this week as this player, with this game
  // marked. Games played here, plus ones the board has from this device (some from before games
  // were kept here). A game in both is counted once.
  const showMine = (note, sent = []) => {
    const fromBoard = sent.map((s) => ({ ...look, id: s.id, score: s.score, at: Date.parse(s.created_at.replace(" ", "T") + "Z") }));
    const ids = new Set(fromBoard.map((g) => g.id));
    const week = [...games.filter((g) => !ids.has(g.id)), ...fromBoard]
      .filter((g) => g.player === look.player && (g.mode ?? "timed") === mode && g.at > at - WEEK_MS)
      .sort((a, b) => (lowWins(mode) ? a.score - b.score : b.score - a.score) || a.at - b.at);
    const place = week.findIndex((g) => g.at === at);
    const rows = place < 5 ? week.slice(0, 5) : [...week.slice(0, 4), week[place]];
    const list = el("ol", { className: "board-list lb-mine" });
    for (const g of rows) {
      const li = el("li");
      if (g.at === at) li.className = "you";
      const rank = week.indexOf(g) + 1;
      li.append(...rowParts({ ...g, nickname: g.at === at ? "This game" : when(g.at) }, rank, faceFor, mode));
      list.append(li);
    }
    box.replaceChildren(el("h3", { textContent: `Your top ${scoresWord(mode)} this week` }), ...(note ? [el("p", { className: "lb-where lb-kept", textContent: note })] : []), list);
  };

  if (!round.canSend) return showMine();
  box.replaceChildren(el("p", { className: "fb-hint", textContent: "Checking the leaderboard…" }));
  preview(nickname)
    .then((out) => (out.kept ? showMine(`Your best this week is ${scoreText(mode, out.best)}, so that stays on the leaderboard.`, out.sent) : showBoard(out)))
    .catch((err) => {
      // A saved name the server won't take any more: start them off with a fresh box.
      if (err.checked) {
        editing = true;
        nickname = "";
        return showBoard(null);
      }
      showMine("The leaderboard can't be reached right now.");
    });

  // A new best: the board around them, their name, and the button.
  function showBoard(first) {
    const where = el("p", { className: "lb-where" });
    const list = el("ol", { className: "board-list lb-window" });
    const hint = el("p", { className: "fb-hint", textContent: "Just a nickname, please. No real names or schools." });
    const check = el("div", { className: "fb-check" });
    const message = el("p", { className: "fb-message", role: "status" });
    const send = el("button", { type: "button", className: "post-score" });
    send.innerHTML = `${icon("trophy")}<span>Put it on the leaderboard</span>`;
    box.replaceChildren(el("h3", { textContent: "Leaderboard this week" }), where, list, hint, check, message, send);

    // Their own row, kept between updates so typing isn't interrupted.
    const you = el("li", { className: "you" });
    const [rankEl, face, , points] = rowParts({ ...look, nickname, score }, "", faceFor, mode);
    const nameCell = el("span", { className: "lb-name" });
    you.append(rankEl, face, nameCell, points);
    const input = el("input", { type: "text", maxLength: 12, autocomplete: "off", placeholder: "Your nickname", value: nickname });
    input.setAttribute("aria-label", "Nickname");
    const change = el("button", { type: "button", className: "lb-change", textContent: "Change" });
    const drawName = () => {
      hint.hidden = !editing;
      if (editing) return nameCell.replaceChildren(input);
      nameCell.replaceChildren(el("span", { textContent: nickname }), change); // typed by visitors: text only
    };
    change.addEventListener("click", () => {
      editing = true;
      input.value = nickname;
      drawName();
      input.focus();
    });

    let token = "";
    robotCheck(check)
      .then((t) => (token = t))
      .catch(() => say(message, "The leaderboard can't be reached right now.", { error: true }));

    let latest = 0;
    const draw = (out) => {
      say(message, "");
      send.disabled = !nickname;
      if (!out || out.kept) return;
      where.textContent = out.rank === 1 ? "Top of the board this week!" : `You'd be #${out.rank} this week!`;
      rankEl.textContent = out.rank;
      list.replaceChildren(
        ...out.board.map((row) => {
          if (row.you) return you;
          const li = boardRow(row, row.rank, faceFor, mode);
          if (row.id) li.append(reportButton(row));
          return li;
        }),
      );
    };
    let timer;
    const rename = () => {
      clearTimeout(timer);
      nickname = input.value.trim();
      send.disabled = true;
      if (!nickname) return;
      const ask = ++latest;
      timer = setTimeout(() => {
        preview(nickname)
          .then((out) => ask === latest && draw(out))
          .catch((err) => ask === latest && say(message, err.message || "The leaderboard can't be reached right now.", { error: true }));
      }, 350);
    };
    input.addEventListener("input", rename);
    drawName();
    if (first) draw(first);
    else {
      list.replaceChildren(you);
      send.disabled = true;
    }

    send.addEventListener("click", async () => {
      const game = round.payload();
      if (!game?.token) return say(message, "The leaderboard can't be reached right now.", { error: true });
      if (!token) return say(message, "Please finish the robot check first.", { error: true });
      send.disabled = true;
      say(message, "Sending…");
      try {
        const res = await fetch(`${API}/scores`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...game, nickname, device: deviceId(), turnstileToken: token }),
        });
        const out = await res.json();
        if (!res.ok) throw new Error(out.error);
        // Remember a nickname they chose, not just the name of who they happened to play as.
        if ((ownPlayer || nickname.toLowerCase() !== playerName.toLowerCase()) && nickname !== typedBefore) {
          save(NICKNAME, nickname);
          save(NICKNAME_AT, Date.now());
        }
        save(MY_SCORES, [out.id, ...load(MY_SCORES, [])].slice(0, 50));
        game.id = out.id; // so their own list doesn't count it twice
        save(MY_GAMES, games);
        editing = false;
        drawName();
        change.remove();
        check.remove();
        say(message, "");
        send.lastChild.textContent = out.rank ? `On the board at #${out.rank}!` : "On the leaderboard!";
      } catch (err) {
        say(message, err.message || "That didn't send. Please try again.", { error: true });
        send.disabled = false;
      }
    });
  }
}

// One leaderboard row's insides: rank, face, nickname and points (or time).
function rowParts(row, rank, faceFor, mode) {
  const rankEl = Object.assign(document.createElement("span"), { className: "lb-rank", textContent: rank });
  const img = Object.assign(document.createElement("img"), { alt: "", width: 40, height: 40 });
  faceFor(row, img);
  const nameEl = Object.assign(document.createElement("span"), { className: "lb-name", textContent: row.nickname }); // typed by visitors: text only
  const score = Object.assign(document.createElement("span"), { className: "lb-points", textContent: scoreText(mode, row.score) });
  return [rankEl, img, nameEl, score];
}

function boardRow(row, rank, faceFor, mode) {
  const li = document.createElement("li");
  li.append(...rowParts(row, rank, faceFor, mode));
  return li;
}

// A small flag on someone else's row, to tell Orson's team if their name isn't friendly.
function reportButton(row) {
  const button = el("button", { type: "button", className: "lb-report" });
  button.setAttribute("aria-label", "Report this name");
  button.innerHTML = icon("flag");
  button.addEventListener("click", async () => {
    const yes = await confirmDialog("Report this name?", { yes: "Report", yesIcon: "flag", detail: "Tell Orson's team if a name isn't friendly." });
    if (!yes) return;
    let sent = false;
    let problem = "";
    try {
      const res = await fetch(`${API}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Device": deviceId() },
        body: JSON.stringify({ scoreId: row.id }),
      });
      sent = res.ok;
      if (!sent) problem = (await res.json().catch(() => ({}))).error ?? "";
    } catch {
      // Offline: said below.
    }
    if (sent) button.disabled = true;
    await confirmDialog(sent ? "Thanks! We'll take a look." : problem || "That didn't send. Please try again.", { yes: "Okay", no: null, yesIcon: "" });
  });
  return button;
}

// Fills the leaderboard list. faceFor(row, img) puts the player's face in an <img>, and
// bodyFor(row) resolves with a canvas of their whole player, for the card a row opens.
// A board seen before shows straight away, then updates if the server has something newer, so
// switching between This week and All time doesn't blank the list.
const seen = new Map(); // range -> scores
let showing = null; // the range asked for last
export async function renderBoard(list, note, range, mode, faceFor, bodyFor) {
  const key = `${mode} ${range}`;
  showing = key;
  const draw = (scores) => drawBoard(list, note, range, mode, scores, faceFor, bodyFor);
  if (seen.has(key)) draw(seen.get(key));
  else if (!list.children.length) note.textContent = "Loading…";
  let scores;
  try {
    const res = await fetch(`${API}/scores?range=${range}&mode=${mode}`);
    if (!res.ok) throw new Error();
    scores = (await res.json()).scores;
  } catch {
    if (showing === key && !seen.has(key)) {
      list.replaceChildren();
      note.textContent = "The leaderboard can't be reached right now.";
    }
    return;
  }
  if (showing !== key) return; // they've switched tabs since
  const before = seen.get(key);
  seen.set(key, scores);
  if (!before || JSON.stringify(before) !== JSON.stringify(scores)) draw(scores);
}

function drawBoard(list, note, range, mode, scores, faceFor, bodyFor) {
  note.textContent = scores.length ? "" : range === "week" ? "No scores this week yet. Be the first!" : "No scores yet. Be the first!";
  const mine = new Set(load(MY_SCORES, []));
  list.replaceChildren(
    ...scores.map((row, i) => {
      const li = document.createElement("li");
      if (mine.has(row.id)) li.className = "mine";
      const button = Object.assign(document.createElement("button"), { type: "button", className: "lb-row" });
      button.append(...rowParts(row, i + 1, faceFor, mode));
      button.addEventListener("click", () => showScoreCard(row, i + 1, range, mode, bodyFor));
      li.append(button);
      if (!mine.has(row.id)) li.append(reportButton(row)); // not on their own rows
      return li;
    }),
  );
}

const DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const played = (createdAt) => new Date(createdAt.replace(" ", "T") + "Z");

// A player's top 10 on their card, this week or all time, with their best marked.
function drawTop(dialog, top, range, mode) {
  const box = dialog.querySelector(".lb-top");
  const list = box.querySelector("ol");
  const tabs = [...box.querySelectorAll("[data-range]")];
  const show = (r) => {
    for (const tab of tabs) tab.setAttribute("aria-selected", String(tab.dataset.range === r));
    list.replaceChildren(
      ...top[r].map((g, i) => {
        const li = el("li", { className: i === 0 ? "best" : "" });
        li.append(
          el("span", { className: "lb-rank", textContent: i + 1 }),
          el("span", { className: "lb-name", textContent: SHORT_DATE.format(played(g.created_at)) }),
          ...(i === 0 ? [el("span", { className: "lb-best-tag", textContent: "Best" })] : []),
          el("span", { className: "lb-points", textContent: scoreText(mode, g.score) }),
        );
        return li;
      }),
    );
  };
  for (const tab of tabs) tab.addEventListener("click", () => show(tab.dataset.range));
  show(range);
  box.hidden = false;
}

// Around the world's spots, in order (the same as AROUND_LAYOUT in game.js).
const AROUND_SPOT_NAMES = ["Block", "Baseline", "Elbow", "Free throw", "Elbow", "Baseline", "Block"];
const FIRE_NAMES = ["Not yet", "On fire", "Purple fire", "Blue supernova"];

// The stats on a player's card: only the ones that mean something in that game mode. Newer things
// (supernova, bonus balls) come back empty for games from before them, so they don't show.
function cardStats(mode, d, score) {
  const green = ["Let go in the green", `${d.green} of ${d.shots}`]; // it can still go in from outside it
  const sent = ["Games sent", d.games];
  const balls = [
    ...(d.money?.seen ? [["Money balls made", `${d.money.made} of ${d.money.seen}`]] : []),
    ...(d.rainbow?.seen ? [["Rainbow balls made", `${d.rainbow.made} of ${d.rainbow.seen}`]] : []),
    ...(d.bonusPoints ? [["Bonus points", `${d.bonusPoints} of ${score}`]] : []),
  ];
  const moving = d.movingGreen ? [["Green zone", "Moving"]] : [];
  if (mode === "threes") {
    const racks = d.racks ?? [];
    const best = Math.max(0, ...racks);
    return [
      ["Shots made", `${d.made} of ${d.shots}`],
      ...(d.money?.seen ? [["Money balls made", `${d.money.made} of ${d.money.seen}`]] : []),
      ...(racks.length ? [["Best rack", `Rack ${racks.indexOf(best) + 1} (${best} of 5)`]] : []),
      ["Best streak", `${d.bestStreak} in a row`],
      ...moving,
      green,
      sent,
    ];
  }
  if (mode === "around") {
    const tries = d.tries ?? [];
    const most = Math.max(0, ...tries);
    const spot = tries.indexOf(most);
    return [
      ["Shots taken", d.shots],
      ["First try", `${tries.filter((t) => t === 1).length} of ${AROUND_SPOT_NAMES.length} spots`],
      ...(most > 1 ? [["Toughest spot", `${AROUND_SPOT_NAMES[spot]} (${most} tries)`]] : []),
      ...moving,
      green,
      sent,
    ];
  }
  if (mode === "survival") {
    // Every shot but the last went in, so the run is the story, and the miss that ended it.
    const t = d.missTiming;
    const miss = t === null || t === undefined ? null : Math.abs(t) <= 0.5 ? "In the green, but it didn't drop" : t < 0 ? "Let go too early" : "Let go too late";
    return [
      ["In a row", d.made],
      ["Threes made", d.threes],
      ["Hottest fire", FIRE_NAMES[d.hottestFire ?? 0]],
      ...balls,
      ...(miss ? [["The miss", miss]] : []),
      ...moving,
      green,
      sent,
    ];
  }
  const pct = d.shots ? Math.round((d.made / d.shots) * 100) : 0;
  return [
    ["Shots made", `${d.made} of ${d.shots} (${pct}%)`],
    ["Threes made", d.threes],
    ["Best streak", `${d.bestStreak} in a row`],
    ["Times on fire", d.onFire],
    ...(d.supernova ? [["Times on supernova", d.supernova]] : []),
    ...balls,
    green,
    sent,
  ];
}

// A bigger look at someone on the board: their whole player and how their best game went.
function showScoreCard(row, rank, range, mode, bodyFor) {
  const dialog = document.createElement("dialog");
  dialog.className = "fb-dialog lb-dialog lb-card";
  dialog.innerHTML = `
    <form method="dialog">
      <div class="lb-card-top">
        <div class="lb-body"></div>
        <div>
          <p class="lb-card-rank"></p>
          <h2></h2>
          <p class="lb-score"><span></span> <span class="lb-unit">points</span></p>
          <p class="lb-played"></p>
        </div>
      </div>
      <dl class="lb-stats"><p class="fb-hint">Loading…</p></dl>
      <div class="lb-top" hidden>
        <div class="lb-top-head">
          <h3>Top 10</h3>
          <div class="board-tabs" role="tablist">
            <button type="button" role="tab" data-range="week">This week</button>
            <button type="button" role="tab" data-range="all">All time</button>
          </div>
        </div>
        <ol class="board-list lb-top-list"></ol>
      </div>
      <div class="fb-row">
        <button type="submit" class="fb-button fb-primary">Close</button>
      </div>
    </form>`;
  const where = { survival: " in sudden death", around: " around the world", threes: " in the 3-point contest" }[mode] ?? "";
  dialog.querySelector(".lb-card-rank").textContent = `#${rank} ${range === "week" ? "this week" : "all time"}${where}`;
  dialog.querySelector("h2").textContent = row.nickname; // typed by visitors: text only
  dialog.querySelector(".lb-score span").textContent = lowWins(mode) ? (row.score / 10).toFixed(1) : row.score;
  dialog.querySelector(".lb-unit").textContent = lowWins(mode) ? "seconds" : "points";
  dialog.querySelector(".lb-top h3").textContent = `Top 10 ${scoresWord(mode)}`;
  const body = dialog.querySelector(".lb-body");
  bodyFor(row)
    .then((canvas) => body.append(canvas))
    .catch(() => {});

  const stats = dialog.querySelector(".lb-stats");
  fetch(`${API}/scores/${row.id}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
    .then((d) => {
      const when = new Date(d.created_at.replace(" ", "T") + "Z");
      dialog.querySelector(".lb-played").textContent = `Played ${DATE.format(when)}`;
      const rows = cardStats(mode, d, row.score);
      stats.replaceChildren(
        ...rows.map(([label, value]) => {
          const item = document.createElement("div");
          item.append(Object.assign(document.createElement("dt"), { textContent: label }), Object.assign(document.createElement("dd"), { textContent: value }));
          return item;
        }),
      );
      drawTop(dialog, d.top, range, mode);
    })
    .catch(() => (stats.innerHTML = '<p class="fb-hint">The stats can\'t be loaded right now.</p>'));

  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
