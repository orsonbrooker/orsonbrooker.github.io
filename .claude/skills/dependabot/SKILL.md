---
name: dependabot
description: Check an open Dependabot pull request locally - test it in its own worktree with npm run check and the right npm run verify runs, read the changelogs for breaking changes, write a merge note and recommend merge or hold. Luke merges. Use when Luke asks about Dependabot, dependency updates or the weekly update PRs.
---

# Dependabot PRs

Dependabot opens weekly PRs (`.github/dependabot.yml`): the site's packages (`site` group), the
Worker's (`worker` group) and the GitHub Actions (`actions` group). This skill checks one **locally** and
ends with a recommendation. It never merges, pushes, comments on GitHub or deploys, and adds no workflows.

## 1. Pick the PR

```sh
gh pr list --author app/dependabot
gh pr view <N> --json number,title,headRefName,body,files
```

The body lists each package, its old and new version, and usually the release notes.

## 2. Test it in its own worktree

Test the update with today's code and tools: start from `test-all` and merge the PR branch into a scratch
branch. Run these one at a time (the worktree guard refuses chained commands):

```sh
git fetch origin <headRefName>
git worktree add -b dependabot-<N> .claude/worktrees/dependabot-<N> test-all
cd .claude/worktrees/dependabot-<N>
git merge --no-edit origin/<headRefName>
```

If the merge conflicts (usually `package-lock.json`), stop: say so and recommend asking Dependabot to
rebase (Luke comments `@dependabot rebase` on the PR). Then set up as in CLAUDE.md, "Running it locally":
`npm ci`, `npm --prefix worker ci`, copy `worker/.dev.vars` and `worker/.cloudflare/types` from the main
checkout. Use `npm ci` (not copied `node_modules`): the point is to install the new versions.

Then run:

- Always: `npm run check` (build, Worker tests, Worker types, house rules).
- **site** group (Vite and other build tools): `npm run verify -- pages` and `npm run verify -- play`
  (start the local Worker first, CLAUDE.md), and `npm run verify -- perf` if Vite itself moved a major or
  minor version.
- **worker** group: the local Worker must start (`cd worker && npx vite --port <free port> --strictPort`)
  and `npm run verify -- play` must send its scores to it. For `cf` or `@cloudflare/vite-plugin`, also
  run `npx cf build` in `worker/` to check the deploy build (no deploy).
- **actions** group: nothing runs locally. Check each action stays pinned to a full commit SHA with a
  version comment, and that the SHA is that tag's:
  `gh api repos/<owner>/<action>/commits/<tag> --jq .sha`.

Each verify run writes to `.verify/<branch>/`. Note anything that failed and its output.

## 3. Read the changelogs

For each package that moved, read the release notes between the two versions: the PR body first, then
`gh release list --repo <owner>/<repo>` and `gh release view <tag> --repo <owner>/<repo>` (find the repo
with `npm view <package> repository.url`). Look for breaking changes, removed options, new minimum Node
versions, and anything about config we use (`vite.config.js`, `worker/cloudflare.config.ts`). A major
version bump needs a line on what changed even if every check passes.

## 4. Write the merge note and recommend

Use the `pr` skill to write `.verify/dependabot-<N>/merge-note.md`: what moved, what was run and the
result, breaking changes found (or "none in the notes"), and a recommendation:

- **Merge**: checks pass and nothing breaking touches us.
- **Hold**: something failed, a breaking change needs code changes (say what), or a major version needs
  Luke's look. Say what would unblock it.

Show Luke the recommendation and the note's path. He merges on GitHub. Posting the note as a PR comment
is publishing: only if he asks. Afterwards remove the scratch worktree and branch
(`git worktree remove .claude/worktrees/dependabot-<N>`, then `git branch -D dependabot-<N>`); never push it.
