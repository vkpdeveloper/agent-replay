---
name: agent-replay
description: Turn a Claude Code or Codex session into a replay that looks like the real terminal UI, as a self-contained replay.html (a video player with an Export MP4 button) or an MP4. Use when the user asks to replay, record, share, export, or make a video of an agent session, "this session", or a session by id.
---

# Agent Replay

`replay.sh` (next to this file) runs the installed `agent-replay` binary at
`~/.local/bin/agent-replay`. If it reports the binary is missing, or the user
changed the code, run `bun install && bun run install:bin` in the repository
this skill lives in.

## Pick the session

- "This session" is the newest session of the agent you are running as:
  `latest:claude` from Claude Code, `latest:codex` from Codex. T3 Code threads
  are stored as ordinary Claude Code or Codex sessions, so this works there too.
- For anything else, list the local sessions and match on title, project, or time:

  ```sh
  <skill-dir>/replay.sh list --limit 30
  ```

  Pass the session id (or a unique part of it), or a path to a `.jsonl` file.

## Build the replay

```sh
<skill-dir>/replay.sh <session> -o "$TMPDIR/replay-<slug>.html"
```

Options:

- `--mp4` also renders an MP4 next to the HTML. `-o file.mp4` renders only the video.
  If Chrome Headless Shell is not installed yet, the first MP4 render downloads it.
- `--turns 2-4` keeps only those user turns. Use this for long sessions, or when
  the user wants one part.
- `--speed 2` plays faster.

Write output under `$TMPDIR` or wherever the user asks, never inside the
project the session came from.

## Secrets

The CLI masks API keys, tokens, passwords, private keys, and credentials in
URLs, and shows the home directory as `~`. Masking is pattern-based. Before the
user publishes a replay, tell them to skim it, and if they mention a secret that
survived, add a pattern and a test to `src/redact.ts` in this skill's repository.

## Report

Give the output path or paths, the video length the CLI printed, and one line
on how to use the file: open the HTML in a browser to play it, and press Export
MP4 there for a video without the CLI. If the user wants a public link and a
file-upload skill is available, upload the file with it.
