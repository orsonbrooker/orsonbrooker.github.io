#!/bin/sh
# Waits until GitHub Actions has built and deployed a given commit to GitHub Pages (the "Pages"
# workflow, .github/workflows/pages.yml), then prints "success <sha>" (or the failure).
# Usage: sh tools/dev/wait_pages.sh <short sha>      (needs the gh CLI, signed in)
want="$1"
[ -n "$want" ] || { echo "usage: wait_pages.sh <short sha>"; exit 2; }
repo=orsonbrooker/orsonbrooker.github.io
for i in $(seq 1 60); do
  s=$(gh run list --repo "$repo" --workflow pages.yml --limit 10 --json headSha,status,conclusion \
    --jq ".[] | select(.headSha | startswith(\"$want\")) | .status + \" \" + .conclusion" 2>/dev/null | head -1)
  case "$s" in
    "completed success") echo "success $want"; exit 0 ;;
    completed*) echo "failed $want: $s (see: gh run list --repo $repo --workflow pages.yml)"; exit 1 ;;
  esac
  sleep 10
done
echo "timed out waiting for $want: ${s:-no run yet}"
exit 1
