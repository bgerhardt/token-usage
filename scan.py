#!/usr/bin/env python3
"""Scanner for the token-usage mod. Parsing logic adapted from
claude_usage_by_model.py (same dedupe by message.id + requestId, same
subagent detection). Prints JSON: current session + last N days by day."""
import json, os, sys, time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(os.path.expanduser("~/.claude/projects"))
session_id, days_n = sys.argv[1], int(sys.argv[2])
since = datetime.now(timezone.utc) - timedelta(days=days_n)
cutoff = time.time() - (days_n + 1) * 86400


def parse_ts(ts):
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")) if ts else None
    except ValueError:
        return None


def pretty_model(model):
    import re
    m = re.match(r"claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$", model)
    if m:
        return f"{m.group(1).capitalize()} {m.group(2)}{'.' + m.group(3) if m.group(3) else ''}"
    m = re.match(r"claude-(\d+)-(\d+)-([a-z]+)", model)
    if m:
        return f"{m.group(3).capitalize()} {m.group(1)}.{m.group(2)}"
    return model


records = {}
for f in ROOT.rglob("*.jsonl"):
    try:
        if f.stat().st_mtime < cutoff:
            continue
        fh = f.open("r", encoding="utf-8", errors="replace")
    except OSError:
        continue
    sub_file = "subagents" in f.parts or f.name.startswith("agent-")
    with fh:
        for line in fh:
            if '"usage"' not in line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("type") != "assistant":
                continue
            msg = obj.get("message") or {}
            usage = msg.get("usage") or {}
            model = msg.get("model")
            if not model or model.startswith("<") or not usage:
                continue
            ts = parse_ts(obj.get("timestamp"))
            if ts is None or ts < since:
                continue
            i, o = int(usage.get("input_tokens") or 0), int(usage.get("output_tokens") or 0)
            cw, cr = int(usage.get("cache_creation_input_tokens") or 0), int(usage.get("cache_read_input_tokens") or 0)
            key = (msg.get("id") or obj.get("uuid"), obj.get("requestId"))
            rec = {"ts": ts, "session": obj.get("sessionId") or f.stem, "model": model,
                   "sub": bool(obj.get("isSidechain")) or sub_file, "v": [i, o, cw, cr]}
            prev = records.get(key)
            if prev is None or (o, i + cw + cr) >= (prev["v"][1], sum(prev["v"]) - prev["v"][1]):
                if prev is not None and prev["sub"]:
                    rec["sub"] = True
                records[key] = rec


def bucket():
    return defaultdict(lambda: {"main": [0, 0, 0, 0], "sub": [0, 0, 0, 0]})


by_day, cur = defaultdict(bucket), bucket()
names = {}
for r in records.values():
    names[r["model"]] = pretty_model(r["model"])
    side = "sub" if r["sub"] else "main"
    day = r["ts"].astimezone().strftime("%Y-%m-%d")
    targets = [by_day[day][r["model"]]]
    if r["session"] == session_id:
        targets.append(cur[r["model"]])
    for t in targets:
        for k, x in enumerate(r["v"]):
            t[side][k] += x

days = []
d = datetime.now().astimezone().date() - timedelta(days=days_n - 1)
for _ in range(days_n):
    k = d.strftime("%Y-%m-%d")
    days.append({"key": k, "label": d.strftime("%a %-d"), "byModel": by_day.get(k, {})})
    d += timedelta(days=1)

print(json.dumps({
    "models": [{"id": m, "name": n} for m, n in sorted(names.items())],
    "session": {"key": session_id, "label": "This session", "byModel": cur},
    "days": days,
    "at": int(time.time() * 1000),
}))
