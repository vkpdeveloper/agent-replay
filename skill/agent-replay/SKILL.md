---
name: agent-replay
description: Turn a Claude Code, Codex or OpenCode session into an MP4 that looks like the real terminal UI, in landscape, vertical or square, optionally cut down to captioned highlights, or a self-contained replay.html video player on request. Use when the user asks to replay, record, share, export, clip, highlight, or make a video of an agent session, "this session", or a session by id.
---

# Agent Replay

Run everything through `replay.sh` next to this file. On first use it downloads
the latest `agent-replay` release for this OS and CPU from GitHub into
`~/.local/share/agent-replay` (a 40 to 60 MB download), and it checks for a newer release
at most once a day, so never install anything by hand. The first MP4 on a
machine also downloads Chrome Headless Shell, so allow a few minutes for it.

## Pick the session

- "This session" is the newest session of the agent you are running as:
  `latest:claude` from Claude Code, `latest:codex` from Codex, `latest:opencode`
  from OpenCode. T3 Code threads are stored as ordinary Claude Code or Codex
  sessions, so this works there too.
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

- `--format vertical` (1080x1920) for Reels, TikTok, Shorts and stories.
  `--format square` (1080x1080) for the X, LinkedIn or Instagram feed. The
  default is landscape (1920x1080).
- HTML on request: `-o <dir>/replay-<slug>.html` writes one self-contained file
  that plays like a video and has an Export MP4 button. Add `--mp4` for both.
- `--turns 2-4` keeps only those user turns.
- `--speed 2` plays faster.
- `--title "..."` opens with a title card.

## Highlights

When the user wants a highlight, a short clip, something to post, or the
session is long, cut it down to the moments worth watching. You pick them.

1. Print the numbered steps. `✗` marks a failed tool call.

   ```sh
   <skill-dir>/replay.sh outline <session>
   ```

2. Pick 3 to 5 moments that tell the story: the ask, a discovery or a failure,
   the fix, the proof (tests going green, the command that works), the result.
   Failures followed by a fix make the best clips. Skip routine reads and
   searches unless they are the story. Each cut is a step range, and each
   turn's prompt is kept automatically.
3. Write a caption per cut: 2 to 5 words, present tense, concrete, like a
   narrator ("Tests fail on rounding", "Finds the real bug", "All 8 green").
   Write a title of at most 7 words that says what happened, and name the
   agent or model when it is part of the story.
4. Render:

   ```sh
   <skill-dir>/replay.sh <session> --format vertical \
     --title 'GLM ships discount codes' \
     --cut '4-8: Writes the feature' --cut '15: Tests fail on the $5 fee' \
     --cut '18-19: Rethinks the design' --cut '26-27: All 8 green' \
     -o ~/Desktop/replay-<slug>-highlight.mp4
   ```

   Use single quotes, so the shell leaves `$` and `!` in captions alone.

Steps between cuts are dropped and shown as "⋯ N steps later". Aim for 20 to
45 seconds. If the CLI prints a longer video, tighten the cuts or add
`--speed 1.5`.

## Secrets

The CLI masks API keys, tokens, passwords, private keys, and credentials in
URLs, and shows the home directory as `~`. Masking is pattern-based, so before
the user publishes a replay, tell them to skim it.

## Report

Give the output path, the video length and render time the CLI printed, and
for highlights the cuts you picked. If the user wants a public link and a
file-upload skill is available, upload the file with it.
