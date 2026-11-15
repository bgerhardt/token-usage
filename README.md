# token-usage

A Claude Code mod: a side panel that stays next to the chat and shows token usage by model.

- Two views: the current session, and the last 7 days by day, as stacked bars with one segment per model.
- Each model is split into main thread (solid) and subagent (striped) usage.
- Toggle between all tokens, excluding cache reads, and output only.
- Updates after every turn and every 20 seconds, so you see the mix shift when you switch models or subagents run.

It reads your local logs in `~/.claude/projects/**/*.jsonl` (including subagent logs) with a small Python 3 script, `scan.py`. Only model names, token counts and timestamps are read; message text is never read, and nothing leaves your machine. Python 3 must be on your PATH.

## Install

At the prompt of a terminal session:

```
/plugin install token-usage --marketplace bgerhardt/token-usage
```

Answer `y` to add the marketplace, then choose a scope. From a shell: `claude plugin install token-usage --marketplace bgerhardt/token-usage`.

The pane opens at session start; `/token-usage` reopens it. Parsing is adapted from a standalone usage-by-model script.

## License

MIT
