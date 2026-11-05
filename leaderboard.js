// Shootaround's leaderboard: sending a score, and showing the top 10 for this week and all time.
//
// Each game asks the server for a signed start token when it begins. A score is sent with that
// token and the game's shot log, and the server checks they add up (see worker/src/index.ts,
// postScore). Odd-looking scores still show, flagged for Orson to check.

import { say } from "./ui/form.js?v=fd569ffc";
import { icon } from "./ui/icons.js?v=c284e3ca";

const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const API = LOCAL ? "http://localhost:8787/api" : "/api";
const NICKNAME = "orson-hoops-nickname";
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
function deviceId() {
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

// Asks for a nickname and sends the score. Resolves with the server's answer, or null if they
// closed it. The nickname starts as:
//   their own player's name, if they made the player they played as
//   otherwise the nickname they typed last time
//   otherwise the name of who they played as (say "Orson"), selected so typing replaces it
export function submitScore(game, { playerName = "", ownPlayer = false } = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "fb-dialog lb-dialog";
    dialog.innerHTML = `
      <form method="dialog">
        <h2>Put it on the leaderboard</h2>
        <p class="lb-score"><span></span> points</p>
        <label for="lb-name">Nickname</label>
        <input id="lb-name" type="text" maxlength="12" autocomplete="off" required placeholder="Up to 12 letters" />
        <p class="fb-hint">Just a nickname, please. No real names or schools.</p>
        <div class="fb-check"></div>
        <p class="fb-message" role="status"></p>
        <div class="fb-row">
          <button type="button" class="fb-button" value="close">Close</button>
          <button type="submit" class="fb-button fb-primary">${icon("trophy")}<span>Send</span></button>
        </div>
      </form>`;
    const name = dialog.querySelector("input");
    const message = dialog.querySelector(".fb-message");
    const send = dialog.querySelector("[type=submit]");
    dialog.querySelector(".lb-score span").textContent = game.score;
    const typedBefore = load(NICKNAME, "");
    const borrowed = !ownPlayer && !typedBefore && !!playerName; // who they played as, not their own name
    name.value = (ownPlayer ? playerName : typedBefore || playerName).slice(0, 12);
    let token = "";
    let result = null;
    robotCheck(dialog.querySelector(".fb-check"))
      .then((t) => (token = t))
      .catch(() => say(message, "The leaderboard can't be reached right now.", { error: true }));

    dialog.querySelector('[value="close"]').addEventListener("click", () => dialog.close());
    dialog.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!token) {
        say(message, "Please finish the robot check first.", { error: true });
        return;
      }
      send.disabled = true;
      say(message, "Sending…");
      try {
        const res = await fetch(`${API}/scores`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...game, nickname: name.value, device: deviceId(), turnstileToken: token }),
        });
        const out = await res.json();
        if (!res.ok) throw new Error(out.error);
        // Remember a nickname they chose, not just the name of who they happened to play as.
        if (ownPlayer || name.value.trim().toLowerCase() !== playerName.toLowerCase()) save(NICKNAME, name.value.trim());
        save(MY_SCORES, [out.id, ...load(MY_SCORES, [])].slice(0, 50));
        result = out;
        dialog.close();
      } catch (err) {
        say(message, err.message || "That didn't send. Please try again.", { error: true });
        send.disabled = false;
      }
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(result);
    });
    document.body.append(dialog);
    dialog.showModal();
    name.focus();
    // A borrowed name (who they played as) is selected, so typing replaces it.
    if (borrowed) name.setSelectionRange(0, name.value.length);
    else name.setSelectionRange(name.value.length, name.value.length);
  });
}

// Fills the leaderboard list. faceFor(row, img) puts the player's face in an <img>.
export async function renderBoard(list, note, range, faceFor) {
  list.replaceChildren();
  note.textContent = "Loading…";
  let scores;
  try {
    const res = await fetch(`${API}/scores?range=${range}`);
    if (!res.ok) throw new Error();
    scores = (await res.json()).scores;
  } catch {
    note.textContent = "The leaderboard can't be reached right now.";
    return;
  }
  note.textContent = scores.length ? "" : range === "week" ? "No scores this week yet. Be the first!" : "No scores yet. Be the first!";
  const mine = new Set(load(MY_SCORES, []));
  list.replaceChildren(
    ...scores.map((row, i) => {
      const li = document.createElement("li");
      if (mine.has(row.id)) li.className = "mine";
      const rank = Object.assign(document.createElement("span"), { className: "lb-rank", textContent: i + 1 });
      const img = Object.assign(document.createElement("img"), { alt: "", width: 40, height: 40 });
      faceFor(row, img);
      const nameEl = Object.assign(document.createElement("span"), { className: "lb-name", textContent: row.nickname }); // typed by visitors: text only
      const score = Object.assign(document.createElement("span"), { className: "lb-points", textContent: row.score });
      li.append(rank, img, nameEl, score);
      return li;
    }),
  );
}
