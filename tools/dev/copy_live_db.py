# Copies the live database into the LOCAL test database, so the game and /admin can be tried on real
# ideas, players and scores without touching the live site. Reads live (read-only), writes local only.
#
# Usage (from the repo, after `npx cf d1 migrations apply <id> --local --persist-to .cloudflare/state`
# in worker/):
#   python3 tools/dev/copy_live_db.py
# Copies: ideas, votes, players, the inbox (new submissions) and the last 14 days of scores (plus any
# flagged ones). Local rows in those tables are replaced.
import json, os, subprocess, sys

DB = "67713a08-4e9f-46b0-874f-bbf9ccf05c4c"
WORKER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "worker")


def cf(*args):
    return subprocess.run(["npx", "cf", "d1", *args], cwd=WORKER, capture_output=True, text=True)


def live(sql):
    res = cf("query", DB, "--sql", sql)
    out = res.stdout
    if "[" not in out:
        sys.exit(f"Couldn't read the live database:\n{res.stderr[-1000:]}")
    return json.loads(out[out.index("["):])[0]["results"]


def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def inserts(table, rows):
    return [f"INSERT OR REPLACE INTO {table} ({', '.join(r)}) VALUES ({', '.join(q(v) for v in r.values())});" for r in rows]


# Order matters for the foreign keys: clear what points at ideas first, fill ideas before what points at them.
sql = ["DELETE FROM submissions;", "DELETE FROM votes;", "DELETE FROM ideas;", "DELETE FROM players;", "DELETE FROM scores;"]
sql += inserts("ideas", live("SELECT * FROM ideas"))
sql += inserts("votes", live("SELECT * FROM votes"))
sql += inserts("players", live("SELECT * FROM players"))
sql += inserts("scores", live("SELECT * FROM scores WHERE created_at > datetime('now', '-14 days') OR flags != '[]'"))
sql += inserts("submissions", live("SELECT * FROM submissions WHERE status = 'new'"))

# One statement can't be too long for the local database, so send it a few lines at a time.
chunk, size, done = [], 0, 0
for line in sql + [None]:
    if chunk and (line is None or size + len(line) > 60000):
        res = cf("raw", DB, "--local", "--persist-to", ".cloudflare/state", "--sql", "\n".join(chunk))
        if res.returncode:
            sys.exit(f"Local load failed:\n{res.stdout[-800:]}{res.stderr[-800:]}")
        done += len(chunk)
        chunk, size = [], 0
    if line is not None:
        chunk.append(line)
        size += len(line)
print(f"Copied the live database into the local one ({done} statements).")
