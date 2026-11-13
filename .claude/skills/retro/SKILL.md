---
name: retro
description: Weekly retro on how we work - find corrections Luke gave more than once and review fixes that keep coming back, and propose a check, test or standard for each so he never has to say it again. Use when Luke asks for a retro, "what do I keep telling you", or on the weekly schedule.
---

# Retro

Goal: Luke never gives the same correction twice. A correction that repeats becomes something a machine
checks, not another reminder. This skill only **proposes**. Nothing changes until Luke ticks it.

Based on ideas from pstack's `correct` and `reflect` and Matt Pocock's `retro` (both MIT); written for this repo.

## 1. Gather (default: the last 7 days)

```sh
python3 -I tools/dev/transcripts.py --days 7 --format text > <scratchpad>/week.txt
git log --since="7 days ago" --oneline test-all
git log --since="7 days ago" --oneline main
ls .verify/*/merge-note.md
```

- `transcripts.py` gives Luke's own typed messages only, already redacted. Use `--since/--until` for another
  range and `--grep` to follow one theme. Never paste raw transcript files anywhere.
- In `git log`, look for rework: "fix", "again", "still", reverts, several commits on the same thing.
- In merge notes, look for review fixes and "couldn't verify" lines that show up on more than one branch.
- Read `docs/rules.md` (what's already enforced) and `docs/coding-standards.md` so you don't propose what exists.

## 2. Find what repeats

Read every message; don't sample. A **correction** is Luke telling the agent it was wrong, didn't look,
forgot, or must always/never do something ("still looks off", "can I have a URL", "pull main first",
"careful with commits", "did you test it?"). Group them by the underlying mistake, not the wording.

Keep a group when it happened **twice or more** (in any sessions), or once if it was costly (something live
broke, kids' safety, lost work). For each, note how many times, which days, and one short quote (no kids'
real names, nothing personal).

Do the same for review fixes and rework commits: the same kind of fix on two branches is a group.

## 3. Pick the highest fix that works

For each group, propose **one** fix, the first that would really stop it, in this order:

1. **Structure**: make the mistake impossible (a data table, one shared module, a tool that does the step,
   a hook, a default that's right).
2. **A grep in `tools/dev/check.mjs`** whose error message names the fix. Say the pattern, and show it
   would have caught a real past case (file and commit).
3. **A test** in `worker/test/` or a `verify` check, again shown failing on a past case.
4. **A line in `docs/coding-standards.md`** for judgement calls the reviewer applies.
5. **A pointer in `CLAUDE.md`** only as a last resort, and only one line.

If a rule already exists but was missed, say why (too long to find, wrong place, not checked) and propose
moving it up a level rather than repeating it.

## 4. Look at the steering files

Also flag, briefly:
- skills or CLAUDE.md sections that are long, repeat each other, or explain what a check already enforces
  (`wc -l CLAUDE.md .claude/skills/*/SKILL.md`);
- places agents got lost: a file or tool they searched for that a one-line pointer would have found;
- rows in `docs/rules.md` whose enforcer is "nothing yet": the next things to automate.

## 5. Output

A short ranked list, most repeated or most costly first, at most about 10 items:

```
1. [ ] <the mistake in a few words>  (N times, days)  "short quote"
       Fix: <level>: <exactly what to add or change, file and pattern>
       Proof: <the past case it would have caught>
```

Then the steering-file notes, then anything you dropped and why (one line each). Write it to
`<scratchpad>/retro-<date>.md` and show it to Luke. Plain English, short.

## 6. After Luke ticks

Build only the ticked items, on a branch in a worktree, through `ready` and `review` like any change. Add or
update each rule's row in `docs/rules.md` with its enforcer. Nothing goes live without Luke.

## Running it weekly

Luke can schedule this as one of Claude's scheduled tasks on this Mac (for example Monday mornings, prompt:
"run the retro skill on the last 7 days"). Don't set one up unless he asks.
