// Choosing a team. No team is ever picked for a kid. The first time a
// device plays as Orson or someone else's approved player, it picks the team its games count for on Top
// teams (players/community.js myTeam); the Team buttons change it. Its own players' teams are picked in
// the builder, the one place to change them: the Team button on Choose a game opens it on that player's
// Team tab, and so does the question before a scored game as a player with no team picked (a new one,
// or one saved in KINGS only because every player used to start there). Also: telling them when a
// community team they were on has gone, and making teams kept only on this device real teams.

import { IN_APP } from "../api.js";
import { loadTurnstile } from "../leaderboard.js";
import { dressInTeam, reloadMyPlayers } from "../play/players.js";
import { myPlayers, saveMyPlayer, teamPicked } from "../players/recolor.js";
import { kitColours } from "../players/teams.js";
import { goneTeams, keptTeam, keptTeams, myTeam, myTeamKit, refreshTeams, setMyTeam } from "../players/community.js";
import { draftName, makeDraft, waitingDrafts } from "../players/drafts.js";
import { TEAMS } from "../shared/teams.js";
import { confirmDialog } from "../ui/confirm.js";
import { icon } from "../ui/icons.js";

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
export const swatch = (kit) => el("span", { className: "team-kit" }, ...["jersey", "shorts", "trim"].map((p) => el("span", { style: `background:${kit[p]}` })));

/**
 * Whether a scored game as this player needs a team picked first: the device's (Orson and approved
 * players; chooseTeam) or, for its own player, theirs (in the builder; askPlayerTeam).
 */
// (The iOS app has no builder, so a player of theirs from saved progress isn't asked there: until a team's
// picked on the website, its games count for none.)
export const needsTeam = (player, gameMode) =>
  !gameMode.passAndPlay && !!gameMode.bestKey && (player?.mine ? !IN_APP && !teamPicked(player) : !myTeam());

/** The builder, on this own player's Team tab; saving there comes back to Choose a game. */
export function editTeam(player) {
  if (IN_APP) return; // no builder in the app (and so no players of its own)
  location.assign(`/players/?edit=${encodeURIComponent(player.id)}&tab=team&back=modes`);
}

/**
 * Before a scored game as their own player with no team picked: off to pick one in the builder. A team
 * kept only on this device is made a real team right here instead, after a robot check (unless the server
 * wouldn't make it: then it's off to the builder to change it). Resolves true when the game can start.
 */
export async function askPlayerTeam(player) {
  const name = player.colours?.teamName;
  if (!draftName(name)) {
    const go = await confirmDialog(`Pick ${player.name}'s team`, { yes: "Pick a team", yesIcon: "players", no: "Not now", detail: "Every player plays for a team. Their games count for it on Top teams." });
    if (go) editTeam(player);
    return false;
  }
  asked = true; // the background doesn't start (or go on) once the question's asked: it'd make the team twice
  await background?.stop(); // a robot check waiting in the background gives way to this one
  if (await madeYet(player)) return true;
  const draft = waitingDrafts().find((t) => t.name === name);
  if (draft && !refused.has(name) && !IN_APP) {
    const made = await makeHere(draft);
    if (made !== false) return made && madeYet(player);
  }
  const why = refused.get(name);
  const detail = why ? `${name} isn't a team yet: ${why}` : `${name} is only on this device, so its games don't count yet. Open it to make it a real team.`;
  const go = await confirmDialog(`Make ${name} a team`, { yes: "Open it", yesIcon: "players", no: "Not now", detail });
  if (go) editTeam(player);
  return false;
}

// ---------- Teams kept only on this device ----------

// Drafts (players/drafts.js) count for nothing until they're real teams. Once a visit the game makes them
// real teams in the background, one per robot check token, so a kid's next game counts without them doing
// anything. A check that wants a tap is left for the question before a scored game (askPlayerTeam).
const refused = new Map(); // draft name → why the server wouldn't make it (a name it refused, 3 teams made)
let background = null; // { stop } while the background check runs
let asked = false; // the question before a scored game took over (askPlayerTeam)

const madeYet = async (player) => {
  const now = myPlayers().find((p) => p.id === player.id);
  if (!teamPicked(now) || !now.colours?.teamId) return false;
  await reloadMyPlayers(); // the game's copy of the player wears the new team
  return true;
};

// Makes one draft a team; a refusal is kept (and said where it's asked), being offline isn't.
async function makeOne(draft, token) {
  try {
    await makeDraft(draft, token);
    return true;
  } catch (err) {
    if (!(err instanceof TypeError)) refused.set(draft.name, err.message || "That didn't work.");
    return false;
  }
}

/** Once a visit, in the background: drafts become private community teams. Resolves true if any did. */
export async function makeDraftsLater() {
  if (IN_APP || background || asked || !waitingDrafts().length) return false;
  let cancelled = false;
  const mine = (background = { stop: async () => void (cancelled = true) });
  const { teams, most, offline } = await refreshTeams();
  if (offline || cancelled || asked) return (background = null), false;
  if (teams.filter((t) => t.maker).length >= most) {
    for (const t of waitingDrafts()) refused.set(t.name, `You've made ${most} teams on this device. Pick one of them, or join a friend's team.`);
    return (background = null), false;
  }
  let made = false;
  try {
    const { turnstile, sitekey } = await loadTurnstile();
    if (cancelled || asked) throw new Error("stopped"); // a question before a game took over meanwhile
    const slot = el("div", { className: "team-robot" });
    document.body.append(slot);
    let posting = null;
    let finish;
    const done = new Promise((resolve) => (finish = resolve));
    const next = () => waitingDrafts().find((t) => !refused.has(t.name));
    const id = turnstile.render(slot, {
      sitekey,
      theme: "dark",
      appearance: "interaction-only", // nothing shows unless it wants a tap, and then it stops (below)
      callback: async (token) => {
        const draft = next();
        if (!draft) return finish();
        posting = makeOne(draft, token);
        made = (await posting) || made;
        posting = null;
        if (next()) turnstile.reset(id);
        else finish();
      },
      "before-interactive-callback": () => finish(),
      "error-callback": () => finish(),
      "expired-callback": () => turnstile.reset(id),
      "timeout-callback": () => finish(),
    });
    const stopped = done.then(() => {
      turnstile.remove(id);
      slot.remove();
    });
    // askPlayerTeam: stop waiting for tokens, but let a team being made finish first (or it'd be made twice)
    mine.stop = async () => {
      await posting;
      finish();
      await stopped;
    };
    setTimeout(finish, 60_000); // it shouldn't take this long
    await stopped;
  } catch {
    // Offline, or the robot check couldn't load: the question before a scored game says what to do.
  }
  background = null;
  if (made) await reloadMyPlayers();
  return made;
}

/**
 * Asks to make a draft a real team, with the robot check in the question. Resolves true once it's made,
 * null for Not now, and false if it couldn't be made (the server refused it, or the check didn't load).
 */
function makeHere(draft) {
  return new Promise((resolve) => {
    let result = null;
    let token = "";
    let widget;
    const dialog = el("dialog", { className: "confirm-dialog" });
    const check = el("div", { className: "team-robot-here" });
    const message = el("p", { className: "confirm-detail team-robot-message", role: "status" });
    const make = el("button", { type: "button", className: "primary", disabled: true }, el("span", { textContent: "Make it a team" }));
    make.insertAdjacentHTML("afterbegin", icon("players"));
    const later = el("button", { type: "button", textContent: "Not now" });
    dialog.append(
      el("p", { className: "confirm-question", textContent: `Make ${draft.name} a team` }), // a kid typed it: text only
      el("p", { className: "confirm-detail", textContent: `${draft.name} is only on this device, so its games don't count yet. Make it a real team, and friends can join it with its code.` }),
      check,
      message,
      el("div", { className: "confirm-actions" }, later, make),
    );
    dialog.querySelector(".confirm-actions").dataset.keys = "row"; // the arrow keys move between the buttons
    const close = (r) => {
      result = r;
      dialog.close();
    };
    later.addEventListener("click", () => close(null));
    dialog.addEventListener("click", (e) => e.target === dialog && !make.dataset.busy && close(null));
    dialog.addEventListener("cancel", (e) => make.dataset.busy && e.preventDefault());
    make.addEventListener("click", async () => {
      if (!token || make.dataset.busy) return;
      make.dataset.busy = "1";
      make.disabled = later.disabled = true;
      message.textContent = "Making your team...";
      try {
        await makeDraft(draft, token);
        return close(true);
      } catch (err) {
        if (!(err instanceof TypeError)) {
          refused.set(draft.name, err.message || "That didn't work.");
          return close(false);
        }
        message.textContent = "That didn't work. Check the internet and try again.";
        token = "";
        window.turnstile?.reset(widget);
      } finally {
        delete make.dataset.busy;
        later.disabled = false;
      }
    });
    dialog.addEventListener("close", () => {
      if (widget !== undefined) window.turnstile?.remove(widget);
      dialog.remove();
      resolve(result);
    });
    document.body.append(dialog);
    dialog.showModal();
    later.focus(); // the safe choice is the default
    loadTurnstile()
      .then(({ turnstile, sitekey }) => {
        if (!dialog.open) return;
        widget = turnstile.render(check, {
          sitekey,
          theme: "dark",
          callback: (t) => {
            token = t;
            make.disabled = false;
          },
          "expired-callback": () => {
            token = "";
            make.disabled = true;
            turnstile.reset(widget);
          },
        });
      })
      .catch(() => close(false));
  });
}

/**
 * The team a player plays for and the kit they wear: { name, kit: { jersey, shorts, trim } }, or null
 * before one's picked. Their own player's is the one saved with them in the builder, in the colours they
 * wear (it may be the away kit); anyone else's is the device's team.
 */
export function teamOf(player) {
  if (!player?.mine) {
    const kit = myTeamKit();
    return kit && { name: kit.name, kit: kit.home };
  }
  if (!teamPicked(player)) return null;
  const c = player.colours ?? {};
  const official = TEAMS.find((t) => t.name === c.teamName);
  const kit = c.jersey && c.shorts && c.team ? { jersey: c.jersey, shorts: c.shorts, trim: c.team } : (official?.home ?? null);
  return { name: c.teamName || official?.name || "", kit };
}

/** Asks which team the device plays for; resolves once they've picked (it can't be skipped the first time). */
export function chooseTeam(note = "") {
  return new Promise((resolve) => {
    const now = myTeam();
    const dialog = el("dialog", { className: "confirm-dialog team-dialog" });
    dialog.dataset.keys = "grid"; // the arrow keys move between the teams (ui/keys.js)
    const pick = (t) => {
      setMyTeam(t);
      dialog.close();
    };
    const row = (t, community) => {
      const on = now && (community ? now.key === t.key : !now.key && now.name === t.name);
      const b = el("button", { type: "button", className: "team-choice" }, swatch(t.home), el("span", { className: "team-choice-name", textContent: t.name })); // a kid may have typed it: text only
      b.setAttribute("aria-pressed", String(!!on));
      if (community) {
        const badge = el("span", { className: "lb-badge", title: "Made by players" });
        badge.innerHTML = icon("players");
        badge.append(el("span", { textContent: "Made by players" }));
        b.append(badge);
      }
      b.addEventListener("click", () => pick(community ? { name: t.name, key: t.key } : { name: t.name }));
      return b;
    };
    const joined = keptTeams().filter((t) => t.member !== false);
    dialog.append(
      el("p", { className: "confirm-question", textContent: "Choose your team" }),
      ...(note ? [el("p", { className: "confirm-detail team-gone", textContent: note })] : []),
      el("p", { className: "team-why", textContent: "Your games count for your team on Top teams." }),
      el("div", { className: "team-choices" }, ...joined.map((t) => row(t, true)), ...TEAMS.map((t) => row(t, false))),
      ...(IN_APP ? [] : [el("a", { className: "team-make", href: "/players/", textContent: "Make a team, or join a friend's with a code, in Make your player." })]),
    );
    // a team has to be chosen the first time (Escape does nothing); changing it can be left
    if (!myTeam()) dialog.dataset.keysRequired = "";
    dialog.addEventListener("cancel", (e) => {
      if (!myTeam()) e.preventDefault();
    });
    dialog.addEventListener("close", async () => {
      dialog.remove();
      await dressInTeam(); // he wears it
      resolve(myTeam());
    });
    document.body.append(dialog);
    dialog.tabIndex = -1;
    dialog.showModal();
    // Their team, or (none chosen yet) no team at all: showModal would ring the first, KINGS, as if picked.
    (dialog.querySelector('[aria-pressed="true"]') ?? dialog).focus();
  });
}

/**
 * Once a visit: if a community team this device was on has gone, its players stop wearing it (no team,
 * so they pick another before their next scored game) and the device chooses again next game. Says so, once. A team that was renamed or given new kits (Luke renames a team whose name isn't
 * friendly) shows its new name and kit on its players here too, not only once the builder opens them.
 */
export async function checkTeams() {
  const gone = await goneTeams(myPlayers().map((p) => ({ key: p.colours?.teamId, name: p.colours?.teamName })));
  const keys = new Set(gone.map((t) => t.key));
  if (keys.has(myTeam()?.key)) setMyTeam(null);
  await dressInTeam(); // a team chosen on another device, or a renamed one, is known now
  let changed = false;
  for (const p of myPlayers()) {
    const id = p.colours?.teamId;
    if (!id) continue;
    if (keys.has(id)) {
      const { teamId: _, ...colours } = p.colours;
      const { teamPicked: __, ...player } = p;
      saveMyPlayer({ ...player, colours: { ...colours, teamName: "" } });
      changed = true;
      continue;
    }
    const t = keptTeam(id);
    if (!t || t.member === false) continue;
    const c = p.colours;
    const wearing = [t.home, t.away].some((k) => k.jersey === c.jersey && k.shorts === c.shorts && k.trim === c.team);
    if (wearing && c.teamName === t.name) continue;
    saveMyPlayer({ ...p, colours: { ...c, ...(wearing ? {} : kitColours(t.home)), teamName: t.name } });
    changed = true;
  }
  if (changed) await reloadMyPlayers();
  if (gone.length) await confirmDialog(`${gone[0].name} isn't around any more.`, { yes: "Okay", no: null, yesIcon: "", detail: "Pick another team." });
}
