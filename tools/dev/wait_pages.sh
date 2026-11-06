#!/bin/sh
# Waits until GitHub Pages has built a given commit, then prints "built <sha>" (or "errored <sha>").
# Check live files only after this: fetching a ?v= URL before the build finishes can make Cloudflare
# cache the old copy under the new URL for 4 hours.
# Usage: sh tools/dev/wait_pages.sh <short sha>      (needs the gh CLI, signed in)
want="$1"
[ -n "$want" ] || { echo "usage: wait_pages.sh <short sha>"; exit 2; }
for i in $(seq 1 60); do
  s=$(gh api repos/orsonbrooker/orsonbrooker.github.io/pages/builds/latest --jq '.status + " " + .commit[0:7]' 2>/dev/null)
  case "$s" in "built $want"*|"errored $want"*) echo "$s"; exit 0;; esac
  sleep 10
done
echo "timed out: $s"
exit 1
