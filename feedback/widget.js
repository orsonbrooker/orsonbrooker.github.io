// Ideas widget for any page on the site. Add to a page:
//
//   <link rel="stylesheet" href="/feedback/widget.css" />
//   <script type="module" src="/feedback/widget.js"></script>
//
//   <div data-feedback="basketball"></div>   "Got an idea?" button plus a link to the board
//   <div data-ideas-board></div>             the full voting board (used on /ideas/)
//
// The value of data-feedback is the game or app the idea is about. New games need a row in
// the apps table first (see worker/migrations).

const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const API = LOCAL ? "http://localhost:8787/api" : "/api";
const STATUSES = [
	["idea", "Ideas"],
	["planned", "Planned"],
	["building", "Building"],
	["done", "Done!"],
];

let config;
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

function openForm(app) {
	const text = el("textarea", { maxLength: 500, required: true, placeholder: "What would make it more fun?" });
	const nickname = el("input", { type: "text", maxLength: 20, placeholder: "Optional", autocomplete: "off" });
	// With no game set (e.g. on the ideas board), let them pick which game it's for.
	const picker = app ? null : el("select", { className: "fb-select" });
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
			picker ? el("label", { textContent: "Which game?" }) : null,
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

	dialog.querySelector("form").addEventListener("submit", async (e) => {
		e.preventDefault();
		if (!token) {
			message.textContent = "Please finish the robot check first.";
			return;
		}
		send.disabled = true;
		message.textContent = "Sending…";
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
				el("p", { textContent: "Orson will read your idea. If it's picked, it'll show up on the ideas board." }),
				el("div", { className: "fb-row" }, el("button", { type: "button", className: "fb-button fb-primary", textContent: "Close", onclick: () => dialog.close() })),
			);
		} catch (err) {
			message.textContent = err.message || "That didn't send. Please try again.";
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
			picker?.append(...apps.map((a) => el("option", { value: a.slug, textContent: a.name })));
			widgetId = turnstile.render(check, {
				sitekey: turnstileSiteKey,
				theme: "dark",
				callback: (t) => (token = t),
				"expired-callback": () => (token = ""),
			});
		})
		.catch(() => (message.textContent = "Ideas can't be sent right now. Please try later."));
}

function mountFeedback(node) {
	const app = node.dataset.feedback;
	const onBoard = location.pathname.startsWith("/ideas");
	node.classList.add("fb-bar");
	node.replaceChildren(
		el("button", { type: "button", className: "fb-button fb-primary", textContent: "💡 Got an idea?", onclick: () => openForm(app) }),
	);
	if (!onBoard) node.append(el("a", { className: "fb-button", href: "/ideas/", textContent: "Ideas board ▸" }));
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
				const list = shown.filter((i) => i.status === status);
				return el(
					"section",
					{ className: `fb-column fb-${status}` },
					el("h2", { textContent: `${label} (${list.length})` }),
					...(list.length ? list.map(card) : [el("p", { className: "fb-empty", textContent: "Nothing here yet" })]),
				);
			}),
		);
	}

	function card(idea) {
		const button = el("button", {
			type: "button",
			className: "fb-vote",
			ariaPressed: String(voted.has(idea.id)),
			ariaLabel: `Vote for ${idea.title}`,
			textContent: `▲ ${idea.votes}`,
			onclick: () => toggleVote(idea, button),
		});
		return el(
			"article",
			{ className: "fb-card" },
			el(
				"div",
				{ className: "fb-card-body" },
				filter === "all" ? el("span", { className: "fb-chip", textContent: appName(idea.app) }) : null,
				el("h3", { textContent: idea.title }),
				idea.description && idea.description !== idea.title ? el("p", { textContent: idea.description }) : null,
				idea.credit ? el("p", { className: "fb-credit", textContent: `Idea from ${idea.credit}` }) : null,
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
			button.textContent = `▲ ${idea.votes}`;
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
