---
name: coordinate
description: The coordinator session's playbook - split work into worker sessions, keep their state in the shared notes folder, merge branches that passed ready and review into test-all, check test-all after each merge, give Luke test links and a status roll-up, and leave going live to Luke. Use in the session that runs other sessions, or when asked "how's everything going?", "anything stalled?" or "what's on test-all?".
---

# Coordinate

The coordinator plans, starts sessions, merges and reports. It writes no code. Based on ideas from
pstack's Orchestrate playbook, in our own words.

## Where things are

- The coordinator runs in the main checkout, which stays on `main` (Luke's `git pull` lands there).
- `test-all` is checked out in its own worktree (today `.claude/worktrees/art-explore`; find it with
  `git worktree list`). All merges and checks of `test-all` happen there.
- Workers run in their own worktrees, cut from `test-all`, one branch each.
- State lives in the shared notes folder for this group of sessions (the path is in the session's
  instructions): `status.md` (the roll-up below, kept current) and one note per worker or topic.
  Plans and reports go there or in the main checkout's `notes/`, never in a session's chat only.

## Rules

1. **Never edit code.** Not even a one-line fix: send it to the session that owns the files, or start
   one. The coordinator's own commits are merges into `test-all` and nothing else.
2. **One owner per set of files.** Before starting a worker, write down which files it may touch. Two
   live sessions never share a file; if work overlaps, sequence it (the second starts from `test-all`
   after the first merges) or give it to the session that already owns the files.
3. **First unit all the way through.** For a new kind of work, take one small piece through brief, work,
   `ready`, review, merge and Luke's look before starting the rest. Fan out only once that path works.
4. **At most about 6 workers at once.** Luke's Mac runs hot. Builds, headless Chrome and video tools
   count double; queue the rest.
5. **Merge only what passed.** A branch goes into `test-all` only when its `ready` hand-over says
   `Verdict: ready` and its merge note (`.verify/<branch>/merge-note.md` in the worker's worktree) says
   two-way door. One-way doors (live migration, data fix, saved progress, coins or scores, the App Store)
   wait for Luke, with the merge note put in front of him. A branch whose review didn't run doesn't merge.
6. **Check after every merge.** In the `test-all` worktree run `npm run check`. If it fails, undo the
   merge (`git reset --hard ORIG_HEAD`, only right after your own merge, with a clean tree) and send the
   output to the branch's owner.
7. **Nothing goes live without Luke.** No push to `main`, Worker deploy or live database write until he
   says so for that change; then follow the `go-live` skill from `test-all`.

## The loop

1. **Brief.** One task per worker: goal, the files it owns, what done looks like (always "run the
   `ready` skill"), and anything other sessions are doing nearby. Start it with `start_session`, fresh
   context, its own worktree.
2. **Wait.** Don't poll. Each worker's turn-end note reaches you. Answer workers' questions, or put them to
   Luke as one short question each. Pass facts between workers who depend on each other (for example, a
   rebuild that moves sprite frames, so gear must be re-keyed) and record the order in the notes.
3. **Merge.** When a worker hands over `READY <branch> @ <sha>`: read the merge note and look at its
   pictures; then in the `test-all` worktree `git merge <sha>`; then `npm run check`. Merge the commit
   the worker named, so later commits on its branch don't slip in unreviewed.
4. **Show Luke.** Build `test-all` and serve it (`npm run verify -- serve` there; today's fallback is
   `npm run build` and `python3 tools/dev/lan_server.py 5174 dist`, reachable on the Tailscale address).
   Give the link to the page that changed, with one line on what to look at.
5. **Tell the others.** After a merge, workers whose branches are now behind will see it from the
   session-start hook; message any that are mid-task and touch nearby files.
6. **Update `status.md`.**

## Status roll-up

When Luke asks how it's going (or after any merge), answer with this, short, newest first:

- **On test-all, not on main:** each merged change in a line (`git log --oneline --first-parent
  main..test-all`), and whether a one-way door is among them.
- **Waiting for Luke:** questions, one-way doors, and anything ready to go live.
- **Working:** each worker, what it's on, and its last news (from `list_sessions {"linked": true}`).
- **Stalled:** a worker idle without a `READY` hand-over, waiting on another session, blocked on a tool
  (Flow credits, a Cloudflare outage), or with no news for a long time. Say what would unstick it.
- **Next:** what starts when a slot frees up.

Link each session as `[title](#local_<id>)`.
