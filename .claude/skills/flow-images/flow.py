"""Drives Luke's Google Flow project (Shootaround) through agent-browser's "flow" session on this Mac.

  python flow.py upload <file>...                      add images to the project (names must be unique)
  python flow.py queue <ref prefix> <first> <last> <prompt file> [<second reference>]
        for each NN: adds "<ref prefix>-NN" as the reference (then the second one, if given: a finished
        grid showing how an item looks, so every grid paints it the same) and sends the prompt ({n}
        becomes NN); stops unless the settings say 0 credits
  python flow.py collect <newest N> <out dir> <tag regex>
        finds the newest N items, reads each one's own page for its prompt tag and image link, and
        downloads the ones whose tag matches as <out>/<kid>-<kind>-NN-k.img

The tag is the prompt's first words, e.g. "BUNS BALL KEY 03". Always check downloads with
tools/pixelart/match_grids.py before using them.
"""
import json
import os
import re
import subprocess
import sys
import time

PROJECT = "/project/f2807216-5509-4ff8-971f-9401cf3e82fc"
URL = "https://flow.google.com" + PROJECT


def ab(*args, timeout=180):
    r = subprocess.run(["agent-browser", "--session", "flow", *args], capture_output=True, text=True, timeout=timeout)
    return (r.stdout + r.stderr).strip()


def ev(js):
    out = ab("eval", js)
    try:
        return json.loads(out)
    except ValueError:
        return out


def open_project():
    ab("--config", os.path.expanduser("~/.agent-browser/flow.json"), "open", URL)
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

CREDITS = """(async () => { document.querySelector('[aria-label="Settings trigger"]').click(); await new Promise((r) => setTimeout(r, 800));
return [...document.querySelectorAll('*')].filter((e) => e.children.length < 3 && /Generating will use/.test(e.textContent)).map((e) => e.textContent.trim()).pop() || 'none'; })()"""


def add_ref(name):
    ab("click", '[aria-label="Add ingredients to the prompt box"]')
    time.sleep(1.5)
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
        time.sleep(3)


READ = """(async () => { const ids = IDS; document.querySelectorAll('iframe[data-id]').forEach((f) => f.remove());
for (const id of ids) { const f = Object.assign(document.createElement('iframe'), { src: 'PROJ/edit/' + id, width: 800, height: 600 }); f.dataset.id = id; document.body.appendChild(f); }
await new Promise((r) => setTimeout(r, 15000));
const out = [...document.querySelectorAll('iframe[data-id]')].map((f) => { try { const h = f.contentDocument.documentElement.outerHTML;
  return [f.dataset.id, (h.match(/[A-Z]+ [A-Z]+ KEY \\d\\d/) || [''])[0], ([...new Set(h.match(/https:\\/\\/flow-content\\.google\\/image\\/[^"'\\s<>]+/g) || [])].map((x) => x.replace(/&amp;/g, '&'))[0] || '')]; }
  catch (e) { return [f.dataset.id, '', '']; } });
document.querySelectorAll('iframe[data-id]').forEach((f) => f.remove()); return JSON.stringify(out); })()"""


def collect(n, out, want):
    os.makedirs(out, exist_ok=True)
    open_project()
    ab("click", "flow-grid-tile-container")
    time.sleep(4)
    ids = []
    for _ in range(n):  # page ids, newest first (an item's page only reads right when loaded on its own)
        eid = ev("location.pathname.split('/edit/')[1] || ''")
        if eid and eid not in ids:
            ids.append(eid)
        ab("click", '[aria-label="Next media"]')
        time.sleep(1.5)
    open_project()
    counts = {}
    for k in range(0, len(ids), 5):  # small batches: more at once overloads the browser
        try:
            rows = json.loads(ev(READ.replace("IDS", json.dumps(ids[k:k + 5])).replace("PROJ", PROJECT)))
        except (TypeError, ValueError):
            print("batch", k, "failed")
            continue
        for eid, tag, url in rows:
            if not (tag and url and re.fullmatch(want, tag)):
                continue
            kid, kind, _, num = tag.split()
            c = counts[(kid, kind, num)] = counts.get((kid, kind, num), 0) + 1
            path = f"{out}/{kid.lower()}-{kind.lower()}-{num}-{c}.img"
            subprocess.run(["curl", "-sS", "-o", path, url], check=False)
            print(tag, "->", os.path.basename(path), flush=True)


if __name__ == "__main__":
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "upload":
        upload(args)
    elif cmd == "queue":
        queue(args[0], int(args[1]), int(args[2]), args[3], args[4] if len(args) > 4 else None)
    elif cmd == "collect":
        collect(int(args[0]), args[1], args[2])
    else:
        sys.exit(__doc__)
