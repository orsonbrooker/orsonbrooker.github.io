"""Drives Luke's Google Flow project (Shootaround) through agent-browser's "flow" session on this Mac.

  python flow.py upload <file>...                      add images to the project (names must be unique)
  python flow.py queue <ref prefix> <first> <last> <prompt file> [<second reference>]
        for each NN: adds "<ref prefix>-NN" as the reference (then the second one, if given: a finished
        grid showing how an item looks, so every grid paints it the same) and sends the prompt ({n}
        becomes NN); stops unless the settings say 0 credits
  python flow.py grab <out dir> <title regex> [<screens>]
        scrolls the project's grid and saves each tile whose title (Flow's own short title, e.g. "Adding
        beanie to pixel art") matches, from the picture already shown (full size), as <out>/NNN.jpg; then
        sort them by picture with tools/pixelart/match_grids.py. Much faster than collect.
  python flow.py collect <newest N> <out dir> <tag regex> [<expected images>]
        finds the newest N items, reads each one's own page for its prompt tag and image link, and
        downloads the ones whose tag matches as <out>/<kid>-<kind>-NN-k.img

Two sessions can work in Flow at once, each in its own browser: FLOW_SESSION=flow2 uses the "flow2"
agent-browser session and ~/.agent-browser/flow2.json (a copy of the signed-in profile); the default is
"flow". Never drive one browser from two sessions.

The tag is the prompt's first words, e.g. "BUNS BALL KEY 03". Always check downloads with
tools/pixelart/match_grids.py before using them.
"""
import json
import os
import re
import subprocess
import sys
import time

SESSION = os.environ.get("FLOW_SESSION", "flow")
PROJECT = "/project/f2807216-5509-4ff8-971f-9401cf3e82fc"
URL = "https://flow.google.com" + PROJECT


def ab(*args, timeout=60):
    try:
        r = subprocess.run(["agent-browser", "--session", SESSION, *args], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return "timed out"
    return (r.stdout + r.stderr).strip()


def ev(js):
    out = ab("eval", js)
    try:
        return json.loads(out)
    except ValueError:
        return out


def open_project():
    ab("--config", os.path.expanduser(f"~/.agent-browser/{SESSION}.json"), "open", URL)
    time.sleep(8)


def upload(files):
    open_project()
    # Flow's "Upload media" opens a native picker; keep its file input in the page instead
    ev("""window.__origClick ||= HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () {
      if (this.type !== 'file') return window.__origClick.call(this);
      document.getElementById('__flowUpload')?.removeAttribute('id'); this.id = '__flowUpload';
      if (!this.isConnected) document.body.appendChild(this); }; 1""")
    ab("click", '[aria-label="Add ingredients to the prompt box"]')
    time.sleep(2)
    ev("[...document.querySelectorAll('button')].find(b => /Upload media/.test(b.textContent))?.click(); 1")
    time.sleep(1)
    print(ab("upload", "#__flowUpload", *files))
    time.sleep(10 + 2 * len(files))
    ev("HTMLInputElement.prototype.click = window.__origClick; 1")
    ab("press", "Escape")


ADD = """(async () => { const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let inp;
for (let i = 0; i < 20 && !(inp = document.querySelector('input[placeholder="Search assets"]')); i++) await sleep(300);
if (!inp) return 'picker not open';
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, NAME);
inp.dispatchEvent(new Event('input', { bubbles: true })); await sleep(1500);
const o = [...document.querySelectorAll('[role="listbox"] [role="option"]')].find((o) => o.textContent.replace(/^image/, '').startsWith(NAME));
if (!o) return 'not found'; o.click(); await sleep(800); return 'added'; })()"""

ONE = """(() => { const h = document.documentElement.outerHTML;
return [(h.match(/[A-Z]+ [A-Z]+ KEY \\d\\d/) || [''])[0], ([...new Set(h.match(/https:\\/\\/flow-content\\.google\\/image\\/[^"'\\s<>]+/g) || [])].map((x) => x.replace(/&amp;/g, '&'))[0] || '')]; })()"""

CREDITS = """(async () => { document.querySelector('[aria-label="Settings trigger"]').click(); await new Promise((r) => setTimeout(r, 800));
return [...document.querySelectorAll('*')].filter((e) => e.children.length < 3 && /Generating will use/.test(e.textContent)).map((e) => e.textContent.trim()).pop() || 'none'; })()"""


def add_ref(name):
    ab("click", '[aria-label="Add ingredients to the prompt box"]')
    time.sleep(1)
    added = ev(ADD.replace("NAME", json.dumps(name)))
    ab("press", "Escape")
    return added


def queue(ref, first, last, pfile, second=None):
    prompt = open(pfile).read().strip()
    open_project()
    cost = ev(CREDITS)
    ab("click", '[aria-label="Settings trigger"]')
    print("settings:", cost)
    if "use 0 credits" not in str(cost):
        sys.exit("not 0 credits: stopping (credits are Luke's call)")
    for g in range(first, last + 1):
        n = f"{g:02d}"
        added = add_ref(f"{ref}-{n}")
        if added == "added" and second:
            added = add_ref(second)
        if added != "added":
            print(n, "reference:", added)
            continue
        ab("click", '[role="textbox"]')
        ab("keyboard", "inserttext", prompt.format(n=n))
        time.sleep(0.5)
        ab("click", '[aria-label="Start generation"]')
        print(n, "sent", flush=True)
        time.sleep(1.5)


TILES = """JSON.stringify([...document.querySelectorAll('flow-grid-tile-container')].map((t) => {
  const i = t.querySelector('img'); return [t.getAttribute('aria-label') || '', i && i.complete && i.naturalWidth > 1000 ? i.src : ''];
}))"""

SAVE = """(() => { const i = [...document.querySelectorAll('flow-grid-tile-container img')].find((x) => x.src === SRC);
if (!i) return ''; const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight;
c.getContext('2d').drawImage(i, 0, 0); return c.toDataURL('image/jpeg', 0.95); })()"""

SCROLL = """(() => { document.querySelectorAll('*').forEach((e) => { if (e.scrollHeight > e.clientHeight + 50 &&
/auto|scroll/.test(getComputedStyle(e).overflowY)) e.scrollTop += 700; }); window.scrollBy(0, 700); return 1; })()"""


def grab(out, want, screens=200):
    import base64
    os.makedirs(out, exist_ok=True)
    open_project()
    seen, n, still = set(), len(os.listdir(out)), 0
    for _ in range(screens):
        tiles = ev(TILES)
        tiles = json.loads(tiles) if isinstance(tiles, str) else tiles or []
        new = [(label, src) for label, src in tiles if src and src not in seen]
        for label, src in new:
            seen.add(src)
            if not re.search(want, label, re.I):
                continue
            data = ev(SAVE.replace("SRC", json.dumps(src)))
            if isinstance(data, str) and data.startswith("data:image"):
                n += 1
                open(f"{out}/{n:03d}.jpg", "wb").write(base64.b64decode(data.split(",", 1)[1]))
                with open(f"{out}/titles.tsv", "a") as f:
                    f.write(f"{n:03d}.jpg\t{label}\n")
                print(f"{n:03d}", label, flush=True)
        still = 0 if new else still + 1
        if still >= 6:  # the end of the grid
            break
        ev(SCROLL)
        time.sleep(1.2)
    print(n, "saved;", len(seen), "tiles looked at", flush=True)


def collect(n, out, want, expect=0):
    """Steps through the newest n items, opening each one's own page (it only reads right when loaded on its
    own) and downloading those whose tag matches; stops early once it has `expect` images."""
    os.makedirs(out, exist_ok=True)
    open_project()
    ab("click", "flow-grid-tile-container")
    time.sleep(4)
    here = lambda: str(ev("location.pathname.split('/edit/')[1] || ''"))
    eid, seen, counts, got = here(), set(), {}, 0
    for _ in range(n):
        if not eid or eid in seen:
            break
        seen.add(eid)
        ab("open", f"https://flow.google.com{PROJECT}/edit/{eid}")
        tag = url = ""
        for _ in range(10):
            time.sleep(1)
            row = ev(ONE)
            if isinstance(row, list) and row[0] and row[1]:
                tag, url = row
                break
        if tag and url and re.fullmatch(want, tag):
            kid, kind, _, num = tag.split()
            c = counts[(kid, kind, num)] = counts.get((kid, kind, num), 0) + 1
            path = f"{out}/{kid.lower()}-{kind.lower()}-{num}-{c}.img"
            subprocess.run(["curl", "-sS", "-m", "60", "-o", path, url], check=False)
            print(tag, "->", os.path.basename(path), flush=True)
            got += 1
            if expect and got >= expect:
                break
        ab("click", '[aria-label="Next media"]')
        nxt = eid
        for _ in range(10):  # wait for the next item, not the same one again
            time.sleep(0.6)
            nxt = here()
            if nxt and nxt != eid:
                break
        if nxt == eid:
            print("no next item after", len(seen), flush=True)
            break
        eid = nxt
    print(f"{got} images from {len(seen)} items", flush=True)

if __name__ == "__main__":
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "upload":
        upload(args)
    elif cmd == "queue":
        queue(args[0], int(args[1]), int(args[2]), args[3], args[4] if len(args) > 4 else None)
    elif cmd == "grab":
        grab(args[0], args[1], int(args[2]) if len(args) > 2 else 200)
    elif cmd == "collect":
        collect(int(args[0]), args[1], args[2], int(args[3]) if len(args) > 3 else 0)
    else:
        sys.exit(__doc__)
