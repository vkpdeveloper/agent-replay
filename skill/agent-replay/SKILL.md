---
name: agent-replay
description: Turn a Claude Code or Codex session into an MP4 that looks like the real terminal UI, or a self-contained replay.html video player on request. Use when the user asks to replay, record, share, export, or make a video of an agent session, "this session", or a session by id.
---

# Agent Replay

Run everything through `replay.sh` next to this file. On first use it downloads
the latest `agent-replay` release for this OS and CPU from GitHub into
`~/.local/share/agent-replay` (a 40 to 60 MB download), and it checks for a newer release
at most once a day, so never install anything by hand. The first MP4 on a
machine also downloads Chrome Headless Shell, so allow a few minutes for it.

## Pick the session

- "This session" is the newest session of the agent you are running as:
  `latest:claude` from Claude Code, `latest:codex` from Codex. T3 Code threads
  are stored as ordinary Claude Code or Codex sessions, so this works there too.
- For anything else, list the local sessions and match on title, project, or time:

  ```sh
  <skill-dir>/replay.sh list --limit 30
  ```

  Pass the session id (or a unique part of it), or a path to a `.jsonl` file.

## Make the replay

Render an MP4 unless the user asks for HTML:

```sh
<skill-dir>/replay.sh <session> -o ~/Desktop/replay-<slug>.mp4
```

Use `~/Desktop` when it exists, otherwise the current directory, unless the user
names a place. Never write into the project the session came from.

- HTML on request: `-o <dir>/replay-<slug>.html` writes one self-contained file
  that plays like a video and has an Export MP4 button. Add `--mp4` for both.
- `--turns 2-4` keeps only those user turns. Use this for long sessions, or when
  the user wants one part.
- `--speed 2` plays faster.

## Secrets

The CLI masks API keys, tokens, passwords, private keys, and credentials in
URLs, and shows the home directory as `~`. Masking is pattern-based, so before
the user publishes a replay, tell them to skim it.

## Report

Give the output path, the video length the CLI printed, and how long the render
took. If the user wants a public link and a file-upload skill is available,
upload the file with it.
