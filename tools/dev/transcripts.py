#!/usr/bin/env python3
"""Luke's own typed messages from this project's Claude Code sessions, for the weekly retro.

    python3 -I tools/dev/transcripts.py --since 2026-11-03 --until 2026-11-13
    python3 -I tools/dev/transcripts.py --days 7 --format text
    python3 -I tools/dev/transcripts.py --days 7 --grep "phone|ipad"

Reads ~/.claude/projects/-Users-lukebrooker-Code-orsonbrooker-github-io*/*.jsonl (the main checkout and
every worktree). Keeps only what a person typed: no tool results, system reminders, task notifications,
messages from other sessions or subagents, or session briefs. Messages repeated by a resumed session are
kept once. Dates are local (this Mac's time zone) and both ends of the range are included.

Anything that looks like a secret is redacted before printing: tokens and keys, emails, IP addresses,
"password=..." pairs. Pasted blocks are replaced by "[pasted]" (they aren't Luke's own words).
Python standard library only.
"""
import argparse
import datetime as dt
import glob
import json
import os
import re
import sys

PROJECTS = os.path.expanduser("~/.claude/projects")
PROJECT_GLOB = "-Users-lukebrooker-Code-orsonbrooker-github-io*"
WORKTREE_PREFIX = "-Users-lukebrooker-Code-orsonbrooker-github-io--claude-worktrees-"

# Text that a person didn't type, for older records without an `origin` field.
NOT_TYPED = (
    "<task-notification", "<side-sessions-event", "<agent-message", "<cross-session", "[Cross-session",
    "Background (from", "Task (from", "<command-", "<local-command", "Caveat:", "[Request interrupted",
    "This session is being continued", "<bash-", "<ci-monitor-event", "<scheduled-task",
)

REDACTIONS = [
    # Private key blocks first, then things with a known shape.
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S), "[key]"),
    (re.compile(r"\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}"), "[token]"),  # JWT
    (re.compile(r"\b(?:sk|pk|rk)-[\w-]{16,}"), "[token]"),
    (re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_\w{16,}"), "[token]"),
    (re.compile(r"\bxox[abpr]-[\w-]{10,}"), "[token]"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "[token]"),
    (re.compile(r"(?i)\bbearer\s+[\w.~+/=-]{12,}"), "Bearer [token]"),
    (re.compile(r"(?i)\b(password|passwd|secret|token|api[_-]?key|apikey|client[_-]?secret)(\s*[:=]\s*)(\"[^\"]*\"|'[^']*'|\S+)"),
     r"\1\2[redacted]"),
    (re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), "[email]"),
    (re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"), "[ip]"),
    (re.compile(r"\b(?:[0-9a-fA-F]{1,4}:){4,7}[0-9a-fA-F]{1,4}\b"), "[ip]"),
    (re.compile(r"\b[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*::(?:[0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4}\b"), "[ip]"),
    # Long random-looking strings (hex, base64). Git SHAs up to 12 characters stay readable.
    (re.compile(r"\b[0-9a-fA-F]{32,}\b"), "[hex]"),
    (re.compile(r"(?<![\w/.-])(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Z])(?=[A-Za-z0-9+/_-]*[a-z])[A-Za-z0-9+/_-]{32,}={0,2}(?![A-Za-z0-9+/_=-]|\.[A-Za-z0-9]{2,4}\b)"),
     "[token]"),
]


def redact(text):
    for pattern, repl in REDACTIONS:
        text = pattern.sub(repl, text)
    return text


def clean(text):
    text = re.sub(r"<system-reminder>.*?</system-reminder>", "", text, flags=re.S)
    text = re.sub(r"<pasted_content[^>]*>.*?</pasted_content[^>]*>", "[pasted]", text, flags=re.S)
    text = re.sub(r"\[Image: [^\]]*\]", "[image]", text)
    text = re.sub(r"\[Image #\d+\]", "[image]", text)
    return text.strip()


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    return ""


def typed_by_a_person(record, text):
    if text.startswith(NOT_TYPED):
        return False
    origin = record.get("origin")
    if isinstance(origin, dict):
        return origin.get("kind") == "human"
    if record.get("isMeta") or record.get("isSidechain") or record.get("toolUseResult") is not None:
        return False
    return True


def place(project_dir, record):
    name = os.path.basename(project_dir)
    if name.startswith(WORKTREE_PREFIX):
        return name[len(WORKTREE_PREFIX):]
    cwd = record.get("cwd") or ""
    if "/.claude/worktrees/" in cwd:
        return cwd.split("/.claude/worktrees/", 1)[1].split("/", 1)[0]
    return "main"


def local_time(stamp):
    try:
        return dt.datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone()
    except (ValueError, AttributeError):
        return None


def read_messages(root, since, until):
    found = []
    for project_dir in sorted(glob.glob(os.path.join(root, PROJECT_GLOB))):
        for path in sorted(glob.glob(os.path.join(project_dir, "*.jsonl"))):
            file_session = os.path.basename(path)[:-6]
            with open(path, encoding="utf-8", errors="ignore") as f:
                for line in f:
                    try:
                        record = json.loads(line)
                    except ValueError:
                        continue
                    kind = record.get("type")
                    if kind == "user":
                        raw = text_of((record.get("message") or {}).get("content"))
                        uid = record.get("uuid")
                    elif kind == "attachment" and (record.get("attachment") or {}).get("type") == "queued_command":
                        att = record["attachment"]
                        raw = att.get("prompt") if isinstance(att.get("prompt"), str) else ""
                        record = dict(record, origin=att.get("origin"))
                        uid = att.get("source_uuid") or record.get("uuid")
                    else:
                        continue
                    text = clean(raw)
                    if not text or not typed_by_a_person(record, text):
                        continue
                    when = local_time(record.get("timestamp", ""))
                    if when is None or not (since <= when.date() <= until):
                        continue
                    found.append({
                        "when": when,
                        "uuid": uid,
                        "session": record.get("sessionId") or file_session,
                        "place": place(project_dir, record),
                        "text": text,
                    })
    found.sort(key=lambda m: m["when"])

    # A resumed session copies earlier messages into its new file, and a message typed while Claude was
    # busy shows up both as a queued command and as the user turn it became. Keep each once.
    kept, seen_ids, recent = [], set(), {}
    for m in found:
        if m["uuid"] and m["uuid"] in seen_ids:
            continue
        last = recent.get(m["text"])
        if last and (m["when"] - last).total_seconds() < 30 * 60:
            continue
        if m["uuid"]:
            seen_ids.add(m["uuid"])
        recent[m["text"]] = m["when"]
        kept.append(m)
    return kept


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--since", help="first day, YYYY-MM-DD (default: --days ago)")
    ap.add_argument("--until", help="last day, YYYY-MM-DD (default: today)")
    ap.add_argument("--days", type=int, default=7, help="days back when --since is missing (default 7)")
    ap.add_argument("--format", choices=["json", "text"], default="json")
    ap.add_argument("--grep", help="only messages matching this regular expression (case-insensitive)")
    ap.add_argument("--max-len", type=int, default=0, help="cut each message to this many characters")
    ap.add_argument("--root", default=PROJECTS, help="the Claude projects folder (for testing)")
    args = ap.parse_args()

    until = dt.date.fromisoformat(args.until) if args.until else dt.date.today()
    since = dt.date.fromisoformat(args.since) if args.since else until - dt.timedelta(days=args.days - 1)
    messages = read_messages(args.root, since, until)
    if args.grep:
        rx = re.compile(args.grep, re.I)
        messages = [m for m in messages if rx.search(m["text"])]

    out = []
    for m in messages:
        text = redact(m["text"])
        if args.max_len and len(text) > args.max_len:
            text = text[: args.max_len] + "…"
        out.append({
            "date": m["when"].strftime("%Y-%m-%d"),
            "time": m["when"].strftime("%H:%M"),
            "session": m["session"][:8],
            "place": m["place"],
            "text": text,
        })

    if args.format == "json":
        json.dump({"since": since.isoformat(), "until": until.isoformat(), "count": len(out),
                   "sessions": len({m["session"] for m in out}), "messages": out},
                  sys.stdout, ensure_ascii=False, indent=1)
        sys.stdout.write("\n")
    else:
        print(f"# {len(out)} messages, {len({m['session'] for m in out})} sessions, {since} to {until}")
        for m in out:
            body = m["text"].replace("\n", "\n    ")
            print(f"\n{m['date']} {m['time']} [{m['place']} {m['session']}]\n    {body}")


if __name__ == "__main__":
    main()
