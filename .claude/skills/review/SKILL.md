---
name: review
description: Review a branch before it merges into test-all - a fresh subagent (never the implementer) reads the diff, runs check and verify, looks at the pictures, fixes small things, writes the merge note and gives a verdict. Use when a branch is ready, when asked to "review" a branch, or from the ready skill.
---

# Review a branch

The session that wrote the code never reviews it. This skill only gathers the facts and starts a **fresh
subagent** with `reviewer-brief.md`; the subagent does the review. Based on ideas from Matt Pocock's
code-review and pr skills and pstack's interrogate.

## 1. Gather (you, the caller)

Run each as a separate command (the worktree guard refuses chains):

- Branch: `git branch --show-current`. Base: `test-all` unless told `main`.
- `git status --short` must be empty. If not, stop: the implementer commits first.
- `git merge-base <base> HEAD` and `git log --oneline <base>..HEAD`. If there are no commits, stop.
- **The brief**: what was asked. In order of preference: the task text this session was given, a note in
  the shared notes folder for this branch, the commit messages. Copy it word for word; don't summarise
  what you built.

## 2. Start the reviewer

Start one subagent with the Agent tool (`general-purpose`), in this same worktree, with this prompt:

```
You are reviewing branch <branch> in <worktree path>. You did not write it.
Base: <base>. Merge base: <sha>.
What was asked (verbatim): <brief>
Follow .claude/skills/review/reviewer-brief.md exactly. <"Dry run: don't commit." if asked>
```

Don't add your own view of what's wrong or right: it anchors the reviewer. Don't pass the transcript.

## 3. Afterwards

Relay the reviewer's verdict and the path of the merge note (`.verify/<branch>/merge-note.md`).

- **ready**: say so; the coordinator can merge.
- **needs work**: the implementer (this session, if it wrote the code) fixes the listed findings, commits,
  and runs this skill again with a new subagent.
- **needs Luke**: put the question to Luke as written, with the pictures it points at.

Don't argue a finding away. If the implementer disagrees, say so next to the finding for Luke to decide.
