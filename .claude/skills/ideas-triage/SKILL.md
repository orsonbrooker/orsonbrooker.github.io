---
name: ideas-triage
description: Pull the newest ideas and player requests from the admin inbox on orsonbrooker.com and go through them with Luke one at a time - draft a category, a kid-friendly title, a duplicate check and whether it becomes a task. Makes any live change only after Luke says yes to that item. Use when Luke asks to check, triage or process the inbox, new ideas or player requests.
---

# Ideas triage

The ideas board is how Orson's friends steer the game. This skill turns the inbox into a short list of
decisions for Luke. **Reading is free; every write to the live database needs Luke's yes for that one
item** (CLAUDE.md: nothing goes live without Luke). A yes covers that item only, never "the rest".

## 1. Read the inbox (live, read-only)

Read with the `cf` CLI from `worker/`. It uses Luke's own Cloudflare sign-in on this Mac, so no Access
token is needed and nothing secret goes in the repo. If it says you're not signed in, ask Luke to run
`npx cf login` himself (it opens a browser); don't try to sign in for him.

```sh
cd worker
npx cf d1 query 67713a08-4e9f-46b0-874f-bbf9ccf05c4c --sql "<SELECT ...>"
```

Only `SELECT`s here. The answer is JSON after some log lines: the rows are in `[0].results`. Use these:

- New ideas: `SELECT id, app, text, nickname, date(created_at) AS day, title, description, note, merge_into FROM submissions WHERE status = 'new' ORDER BY id`
- The board, for duplicates: `SELECT id, app, title, description, status, votes FROM ideas WHERE status != 'hidden' ORDER BY app, votes DESC`
- Categories: `SELECT slug, name FROM apps` (`basketball` = Shootaround, `new-game`, `website`)
- Player requests: `SELECT id, name, base, number, team_name, pronoun, date(created_at) AS day FROM players WHERE status = 'new' ORDER BY id`

Working offline or want to try writes first? `python3 tools/dev/copy_live_db.py` copies the live inbox
into the local database (see CLAUDE.md, "Running it locally"); then add `--local --persist-to .cloudflare/state`.
The admin API (`/api/admin/inbox`) gives the same data but needs a Cloudflare Access sign-in, so prefer `cf`.

## 2. Draft each item (no writes yet)

For each new idea, work out:

- **Category**: which `apps` slug it belongs in (kids often send website ideas from the game).
- **Title and description**: a short title (80 characters max) and a tidy description (500 max) in the
  kid's own spirit. Fix spelling, keep their idea, don't add features. If it has a real name of someone
  who isn't a player, or anything unkind, rewrite it or suggest rejecting. Check the rewrite with
  `curl -s "https://orsonbrooker.com/api/check?text=<url-encoded>"` (`{"ok":true}` means it passes the
  rude-word filter).
- **Duplicate?** Compare with the board by meaning, not just words ("2 player", "1v1", "play with my
  friend" are the same). If it matches, suggest merging into that idea (it counts as an upvote).
- **What to do**: put it on the board, merge into idea N, keep it as kind words (a compliment with no
  idea in it), or reject (and why).
- **A task?** Say if it's small and clear enough to build now (and roughly what it touches), or should wait
  for votes. Top requests already known: see "Product notes" in CLAUDE.md.

For each player request: is the name a nickname (not a full real name) and friendly? Approve, rename (to
what), or hide. Only real kids Orson knows go in the game: if unsure, ask Luke.

## 3. Show Luke one at a time

Show one item, with its words exactly as sent, then your draft, then the question. Example:

> **Idea 212** (Shootaround, from "Jaz", 12 Nov): "can u make it so u can play with ur frend on another ipad"
> Draft: merge into **#14 Online 1v1** (31 votes), as an upvote. Not a task yet: needs the online play work.
> Write it?

Wait for his answer before showing the next. If he changes the draft, use his version.

## 4. Write, only after a yes

Run the one write for that item and say what changed. Bind every value with `--params` (never paste
typed text into the SQL). The public board's cache catches up within a minute.

- **Draft into the inbox** (safest; only the admin page sees it, then Luke taps Approve or Add there):
  `UPDATE submissions SET title = ?1, description = ?2, note = ?3, merge_into = ?4 WHERE id = ?5 AND status = 'new'`
  Start `note` with "Add to the board", "Reject" or anything else for "Needs a decision"; the admin page groups by it.
- **Reject**: `UPDATE submissions SET status = 'rejected' WHERE id = ?1 AND status = 'new'`
- **Keep as kind words**: `UPDATE submissions SET status = 'rejected', kept_at = COALESCE(kept_at, datetime('now')) WHERE id = ?1`
- **Edit an idea on the board** (rename, move category, mark done, hide): mirror `editIdea` in
  `worker/src/admin.ts`, including `done_at` (set the first time it's done, cleared if moved back) and
  `updated_at`. Status is one of `idea`, `planned`, `building`, `done`, `hidden`.
- **Player**: approve `UPDATE players SET status = 'approved', updated_at = datetime('now') WHERE id = ?1`;
  hide the same with `'hidden'`; rename sets `name` (12 characters max).

Approving an idea onto the board, or merging it, takes several steps (new idea, credit, upvote, recount):
write the draft above and let Luke tap the button on `/admin`, or mirror `triage` in `admin.ts` exactly.

Never delete rows. After the last item, list what was written and what's left waiting.
