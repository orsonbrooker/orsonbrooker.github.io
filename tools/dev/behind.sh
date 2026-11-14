#!/bin/sh
# Says how far this checkout is behind main, so a session knows to merge before it builds.
# Run by the SessionStart hook in .claude/settings.json; fine to run by hand from any worktree.
# Prints nothing when it's up to date. Never fails: offline or not a git checkout are both fine.

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# Fetch, but give up after 5 seconds (macOS has no `timeout`). Other sessions may fetch at the same
# time; a lost race just means slightly old numbers.
GIT_TERMINAL_PROMPT=0 git fetch -q origin >/dev/null 2>&1 &
pid=$!
i=0
while kill -0 "$pid" 2>/dev/null; do
  [ "$i" -ge 50 ] && { kill "$pid" 2>/dev/null; break; }
  sleep 0.1
  i=$((i + 1))
done

# Commits on main (local or GitHub's, whichever is newer) that HEAD lacks.
mains=""
for ref in main origin/main; do
  git rev-parse -q --verify "$ref^{commit}" >/dev/null 2>&1 && mains="$mains $ref"
done
n=0
[ -n "$mains" ] && n=$(git rev-list --count $mains --not HEAD 2>/dev/null || echo 0)
[ "$n" = 0 ] && exit 0

if [ "$(git branch --show-current 2>/dev/null)" = main ]; then
  echo "main here is $n commits behind GitHub's main (git pull)."
  exit 0
fi

echo "This worktree is $n commits behind main. Merge before building on it (the ready skill does: git fetch, then git merge origin/main)."
exit 0
