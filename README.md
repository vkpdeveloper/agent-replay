# agent-replay

Turn a Claude Code or Codex session into a replay that looks like the real
terminal: the prompt being typed, the spinner, tool calls going up, results
streaming in, diffs, todos. You get one self-contained `replay.html` that plays
like a video, or an MP4.

```sh
bun install
bun run install:bin                     # -> ~/.local/bin/agent-replay

agent-replay list                       # local sessions, newest first
agent-replay latest:claude              # -> replay-<id>.html
agent-replay <session-id> --mp4         # -> replay-<id>.html + replay-<id>.mp4
agent-replay <session-id> -o demo.mp4 --turns 2-3 --speed 1.5
```

`install:bin` compiles a standalone binary with `bun build --compile` and
installs it to `~/.local/share/agent-replay` with the prebuilt Remotion site
and compositor it needs for MP4s, so it runs without the repository. Set
`AGENT_REPLAY_HOME` to install somewhere else. Rerun it after changing the code.

Sessions are read from `~/.claude/projects` (Claude Code, including T3 Code's
Claude threads) and `~/.codex/sessions` (Codex). A session can be a path, an id
or part of one, `latest`, `latest:claude` or `latest:codex`.

## What you get

- **replay.html**: a single file with no network requests, about 1 MB. It has a
  Remotion player with scrubbing, playback speed and fullscreen, plus an
  **Export MP4** button that encodes the video in your browser with WebCodecs.
- **MP4**: `--mp4` renders 1920x1080 H.264 with headless Chrome through
  `@remotion/renderer`. The first render downloads Chrome Headless Shell.

Each agent gets its own theme. Claude Code has the welcome box, `●` tool calls
with `⎿` results, the orange spinner with an elapsed timer, and the rounded input
box. Codex has `• Ran` and `• Explored` blocks, `└` output, reasoning titles in the
working indicator, and the shaded composer.

## Secrets are masked

Before anything is written, every string in the session goes through
`src/redact.ts`:

- Known key formats: Anthropic, OpenAI, GitHub, GitLab, Slack, AWS, Google,
  Stripe, npm, Hugging Face, Groq, xAI, SendGrid, Resend and others.
- JWTs, `Authorization` headers and bearer tokens, PEM private keys, and
  `user:password@` in URLs.
- Values assigned to names like `*_SECRET`, `*_TOKEN`, `password`, `api_key`,
  in env files, JSON, YAML and CLI flags.
- Long random-looking strings, except hex digests and UUIDs.

Your home directory is shown as `~`. Masking is pattern-based, so skim a replay
before you publish it. If something slips through, add a case to
`src/redact.test.ts`.

## How it works

```text
session.jsonl ─ parse ─▶ Session ─ redact ─▶ layout ─▶ Replay ─┬─▶ replay.html (Player + web export)
 (Claude/Codex)          (events)            (theme)  (lines   └─▶ MP4 (@remotion/renderer)
                                                       × frames)
```

1. `src/parse/` turns Claude Code and Codex JSONL into one event model. Tool
   output is clipped while parsing, so a 65 MB transcript parses in about 70 ms.
2. `src/layout/` pre-wraps everything to a fixed 120×32 terminal grid in the
   agent's own style and stamps each row with the frame it appears on. Pacing
   keeps the rhythm of the session (typing, waiting on tools, streaming) and
   drops the dead time. The spinner's timer still shows real elapsed time.
3. `src/video/Replay.tsx` is the Remotion composition. A frame is two binary
   searches plus about 30 absolutely positioned rows, and every animation is
   driven by the frame number, so a paused replay costs nothing.

## Skill

`skill/agent-replay` is an agent skill for Claude Code and Codex. It runs the
installed binary. Symlink it into your skills directory:

```sh
ln -s "$PWD/skill/agent-replay" ~/.claude/skills/agent-replay
ln -s "$PWD/skill/agent-replay" ~/.codex/skills/agent-replay
```

Then ask your agent to "make a replay of this session".

## Development

```sh
bun run build --player   # dist/player.js.txt, embedded into replay.html
bun src/cli.ts <session> # run from source
bun run typecheck        # TypeScript 7 (tsgo)
bun test
```

Remotion has its own [license](https://www.remotion.dev/license). It is free
for individuals and small teams. Larger companies need a company license to
render with it.
