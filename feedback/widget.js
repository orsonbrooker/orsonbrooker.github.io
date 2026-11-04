// Ideas widget for any page on the site. Add to a page:
//
//   <link rel="stylesheet" href="/feedback/widget.css" />
//   <script type="module" src="/feedback/widget.js"></script>
//
//   <div data-feedback="basketball"></div>   "Got an idea?" button plus a link to the board
//   <div data-feedback="" data-default-app="basketball"></div>   lets them pick the game, starting on this one
//   <div data-ideas-board></div>             the full voting board (used on /ideas/)
//
// The value of data-feedback is the game or app the idea is about. New games need a row in
// the apps table first (see worker/migrations).

import { markField, say } from "../ui/form.js?v=fd569ffc";
import { icon } from "../ui/icons.js?v=c284e3ca";

const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const API = LOCAL ? "http://localhost:8787/api" : "/api";
const STATUSES = [
	["idea", "Ideas"],
	["planned", "Planned"],
	["done", "Done!"],
];

let config;
const NEW_GAME = "new-game"; // the apps row for ideas about games that don't exist yet
function getConfig() {
	config ??= fetch(`${API}/config`).then((r) => (r.ok ? r.json() : Promise.reject(new Error("offline"))));
	return config;
}

// A random id for this browser, so each person gets one vote per idea.
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

const el = (tag, props = {}, ...children) => {
	const node = Object.assign(document.createElement(tag), props);
	node.append(...children.filter((c) => c != null));
	return node;
};

// ---------- Suggest an idea ----------

let turnstileLoading;
function loadTurnstile() {
	turnstileLoading ??= new Promise((resolve, reject) => {
		const s = el("script", { src: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", async: true });
		s.onload = () => resolve(window.turnstile);
		s.onerror = reject;
		document.head.append(s);
	});
	return turnstileLoading;
}

function openForm(app, defaultApp) {
	const text = el("textarea", { maxLength: 500, required: true, placeholder: "What would make it more fun?" });
	const nickname = el("input", { type: "text", maxLength: 20, placeholder: "Optional", autocomplete: "off" });
	// With no game set (e.g. on the ideas board), let them pick which game it's for.
	const picker = app ? null : el("select", { className: "fb-select" });
	const setPrompt = () => {
		const slug = app || picker?.value;
		text.placeholder = slug === NEW_GAME ? "What game should Orson make next?" : slug === "website" ? "What would make the website better?" : "What would make it more fun?";
	};
	picker?.addEventListener("change", setPrompt);
	const check = el("div", { className: "fb-check" });
	const message = el("p", { className: "fb-message", role: "status" });
	const send = el("button", { type: "submit", className: "fb-button fb-primary", textContent: "Send idea" });
	let token = "";
	let widgetId;

	const dialog = el(
		"dialog",
		{ className: "fb-dialog" },
		el(
			"form",
			{ method: "dialog" },
			el("h2", { textContent: "Got an idea?" }),
			picker ? el("label", { textContent: "What's it for?" }) : null,
			picker,
			el("label", { textContent: "Your idea" }),
			text,
			el("label", { textContent: "Nickname" }),
			nickname,
			el("p", { className: "fb-hint", textContent: "Just a nickname, please. No real names or schools." }),
			check,
			message,
			el(
				"div",
				{ className: "fb-row" },
				el("button", { type: "button", className: "fb-button", textContent: "Close", onclick: () => dialog.close() }),
				send,
			),
		),
	);

	// Friendly words: checked while typing (the server checks again when sending).
	const RUDE = "Let's keep it friendly. Try different words.";
	let checkTimer;
	const friendly = async (words) => {
		if (!words.trim()) return true;
		try {
			return (await fetch(`${API}/check?text=${encodeURIComponent(words)}`).then((r) => r.json())).ok;
		} catch {
			return true; // offline: the server checks again when sending
		}
	};
	const checkWords = () => {
		clearTimeout(checkTimer);
		checkTimer = setTimeout(async () => {
			const [textOk, nameOk] = await Promise.all([friendly(text.value), friendly(nickname.value)]);
			markField(text, textOk ? "" : RUDE);
			markField(nickname, nameOk ? "" : RUDE);
			send.disabled = !textOk || !nameOk;
			if (send.disabled) say(message, RUDE, { error: true });
			else if (message.classList.contains("fb-error")) say(message, "");
		}, 400);
	};
	text.addEventListener("input", checkWords);
	nickname.addEventListener("input", checkWords);

	dialog.querySelector("form").addEventListener("submit", async (e) => {
		e.preventDefault();
		if (!token) {
			say(message, "Please finish the robot check first.", { error: true });
			return;
		}
		send.disabled = true;
		say(message, "Sending…");
		try {
			const res = await fetch(`${API}/submit`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ app: app || picker.value, text: text.value, nickname: nickname.value, turnstileToken: token }),
			});
			const out = await res.json();
			if (!res.ok) throw new Error(out.error);
			dialog.querySelector("form").replaceChildren(
				el("h2", { textContent: "Thanks!" }),
				el("p", { textContent: "Your idea goes to Orson first. If he picks it, it goes on the ideas board with your nickname on it, so look out for it!" }),
				el("div", { className: "fb-row" }, el("button", { type: "button", className: "fb-button fb-primary", textContent: "Close", onclick: () => dialog.close() })),
			);
		} catch (err) {
			say(message, err.message || "That didn't send. Please try again.", { error: true });
			token = "";
			if (window.turnstile && widgetId !== undefined) window.turnstile.reset(widgetId);
		} finally {
			send.disabled = false;
		}
	});
	dialog.addEventListener("close", () => dialog.remove());

	document.body.append(dialog);
	dialog.showModal();
	text.focus();

	Promise.all([getConfig(), loadTurnstile()])
		.then(([{ turnstileSiteKey, apps }, turnstile]) => {
			// Ideas for a game that doesn't exist yet go last, as their own choice.
			const sorted = [...apps.filter((a) => a.slug !== NEW_GAME), ...apps.filter((a) => a.slug === NEW_GAME)];
			picker?.append(
				...sorted.map((a) => el("option", { value: a.slug, textContent: a.slug === NEW_GAME ? "A new game!" : a.name, selected: a.slug === defaultApp })),
			);
			setPrompt();
			widgetId = turnstile.render(check, {
				sitekey: turnstileSiteKey,
				theme: "dark",
				callback: (t) => (token = t),
				"expired-callback": () => (token = ""),
			});
		})
		.catch(() => say(message, "Ideas can't be sent right now. Please try later.", { error: true }));
}

function mountFeedback(node) {
	const app = node.dataset.feedback;
	const onBoard = location.pathname.startsWith("/ideas");
	node.classList.add("fb-bar");
	node.replaceChildren(
		el("button", { type: "button", className: "fb-button fb-primary", innerHTML: `${icon("idea")}<span>Got an idea?</span>`, onclick: () => openForm(app, node.dataset.defaultApp) }),
	);
	if (!onBoard) node.append(el("a", { className: "fb-button", href: "/ideas/", innerHTML: `<span>Ideas board</span>${icon("next")}` }));
}

// ---------- Ideas board ----------

async function mountBoard(node) {
	node.classList.add("fb-board");
	node.replaceChildren(el("p", { className: "fb-loading", textContent: "Loading ideas…" }));
	let apps, ideas, voted;
	try {
		const [cfg, list] = await Promise.all([getConfig(), fetch(`${API}/ideas?device=${deviceId()}`).then((r) => r.json())]);
		apps = cfg.apps;
		ideas = list.ideas;
		voted = new Set(list.voted);
	} catch {
		node.replaceChildren(el("p", { className: "fb-loading", textContent: "The ideas board is taking a break. Try again soon!" }));
		return;
	}
	const appName = (slug) => apps.find((a) => a.slug === slug)?.name ?? slug;
	const DONE_SHOWN = 4; // the Done list gets long, so only the latest few show until asked
	let showAllDone = false;
	let filter = new URLSearchParams(location.search).get("app") || "all";

	const tabs = el("div", { className: "fb-tabs", role: "tablist" });
	const columns = el("div", { className: "fb-columns" });
	node.replaceChildren(tabs, columns);

	function render() {
		tabs.replaceChildren(
			...[{ slug: "all", name: "All" }, ...apps].map((a) =>
				el("button", {
					type: "button",
					role: "tab",
					className: "fb-button",
					textContent: a.name,
					ariaSelected: String(a.slug === filter),
					onclick: () => {
						filter = a.slug;
						render();
					},
				}),
			),
		);
		const shown = ideas.filter((i) => filter === "all" || i.app === filter);
		columns.replaceChildren(
			...STATUSES.map(([status, label]) => {
				// Things being built are rare, so they sit with Planned rather than in a column of their own.
				let list = shown.filter((i) => i.status === status || (status === "planned" && i.status === "building"));
				const count = list.length;
				let more = null;
				if (status === "done") {
					// Most recently released first, and only a few unless they ask for all.
					list = [...list].sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? "") || b.id - a.id);
					if (!showAllDone && count > DONE_SHOWN) {
						list = list.slice(0, DONE_SHOWN);
						more = el("button", {
							type: "button",
							className: "fb-button fb-more",
							textContent: `Show all ${count}`,
							onclick: () => {
								showAllDone = true;
								render();
							},
						});
					}
				}
				// The most-voted idea still to build in each column (ideas come most-voted first).
				const top = status !== "done" && list[0]?.votes > 0 && list[0].votes > (list[1]?.votes ?? 0) ? list[0] : null;
				return el(
					"section",
					{ className: `fb-column fb-${status}` },
					el("h2", { textContent: `${label} (${count})` }),
					...(list.length ? list.map((i) => card(i, i === top)) : [el("p", { className: "fb-empty", textContent: "Nothing here yet" })]),
					more,
				);
			}),
		);
	}

	const voteLabel = (votes) => `${icon("up")}<span>${votes}</span>`;

	function card(idea, isTop) {
		const button = el("button", {
			type: "button",
			className: "fb-vote",
			ariaPressed: String(voted.has(idea.id)),
			ariaLabel: `Vote for ${idea.title}`,
			innerHTML: voteLabel(idea.votes),
			onclick: () => toggleVote(idea, button),
		});
		return el(
			"article",
			{ className: isTop ? "fb-card fb-top" : "fb-card" },
			el(
				"div",
				{ className: "fb-card-body" },
				isTop ? el("span", { className: "fb-chip fb-top-chip", innerHTML: `${icon("trophy")}<span>Top pick</span>` }) : null,
				filter === "all" ? el("span", { className: "fb-chip", textContent: appName(idea.app) }) : null,
				el("h3", { textContent: idea.title }),
				idea.description && idea.description !== idea.title ? el("p", { textContent: idea.description }) : null,
				// Nicknames are typed by visitors: set as text, never HTML.
				idea.credit ? el("p", { className: "fb-credit", innerHTML: icon("star") }, el("span", { textContent: `Idea from ${idea.credit}` })) : null,
			),
			idea.status === "done" ? null : button,
		);
	}

	async function toggleVote(idea, button) {
		const up = !voted.has(idea.id);
		button.disabled = true;
		try {
			const res = await fetch(`${API}/vote`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ideaId: idea.id, device: deviceId(), up }),
			});
			const out = await res.json();
			if (!res.ok) throw new Error(out.error);
			idea.votes = out.votes;
			up ? voted.add(idea.id) : voted.delete(idea.id);
			button.innerHTML = voteLabel(idea.votes);
			button.ariaPressed = String(up);
		} catch (err) {
			button.title = err.message || "Couldn't vote right now";
		} finally {
			button.disabled = false;
		}
	}

	render();
}

document.querySelectorAll("[data-feedback]").forEach(mountFeedback);
document.querySelectorAll("[data-ideas-board]").forEach(mountBoard);

// Other parts of the page can open the form, like the game's "Got an idea?" button.
window.addEventListener("feedback:open", (e) => openForm(e.detail?.app ?? "", e.detail?.defaultApp));
