#!/usr/bin/env bun
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { version } from "../package.json";
import { buildHtml } from "./html.ts";
import { layout, type Cut } from "./layout/index.ts";
import { outline } from "./outline.ts";
import { redactDeep } from "./redact.ts";
import { FORMATS, type Format } from "./replay.ts";
import { describe, findSessions, readSession, resolveSession } from "./sessions.ts";

const HELP = `agent-replay: turn a Claude Code, Codex or OpenCode session into a terminal replay

Usage
  agent-replay [session] [options]     Write replay.html (and optionally an MP4)
  agent-replay list [--limit 20]       List local sessions, newest first
  agent-replay outline [session]       Print every step, numbered, to pick --cut ranges

Session
  A .jsonl path, a session id (or part of one), latest, latest:claude,
  latest:codex or latest:opencode. Defaults to latest.

Options
  -o, --out <file>       Output path. Ending in .mp4 renders only the video.
      --mp4              Also render an MP4 next to the HTML.
      --format <name>    landscape (1920x1080, default), vertical (1080x1920) or square (1080x1080).
      --speed <n>        Playback speed multiplier (default 1).
      --turns <a-b>      Keep only user turns a through b, e.g. 2-4 or 3.
      --cut <a-b: text>  Highlight: keep only steps a through b from \`outline\`, with an
                         optional caption. Repeat for each highlight.
      --title <text>     Open with a title card.
      --json             Write the replay data as JSON instead.
  -v, --version
  -h, --help

Secrets (API keys, tokens, passwords, private keys, credentials in URLs) are
masked and your home directory is shown as ~ before anything is written.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", short: "o" },
    mp4: { type: "boolean" },
    speed: { type: "string" },
    turns: { type: "string" },
    format: { type: "string" },
    cut: { type: "string", multiple: true },
    title: { type: "string" },
    json: { type: "boolean" },
    limit: { type: "string" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
});

if (values.version) {
  console.log(version);
  process.exit(0);
}

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

if (positionals[0] === "list") {
  const limit = Number(values.limit ?? 20);
  for (const file of (await findSessions()).slice(0, limit)) {
    const { cwd, title } = await describe(file);
    const when = new Date(file.mtime).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
    const size = `${(file.size / 1e6).toFixed(1)}MB`.padStart(7);
    const id = file.id ?? basename(file.path, ".jsonl").replace(/^rollout-[\dT-]+?-(?=[0-9a-f]{8}-)/, "");
    console.log(`${file.agent.padEnd(6)} ${when.padEnd(16)} ${size}  ${id}  ${title || cwd}`);
  }
  process.exit(0);
}

const outlining = positionals[0] === "outline";
const started = performance.now();
const file = await resolveSession(positionals[outlining ? 1 : 0] ?? "latest");
const session = redactDeep(await readSession(file), homedir());

if (outlining) {
  console.log(outline(session));
  process.exit(0);
}

const replay = layout(session, {
  speed: Number(values.speed ?? 1),
  turns: parseTurns(values.turns),
  format: parseFormat(values.format),
  cuts: values.cut?.map(parseCut),
  ...(values.title ? { title: values.title } : {}),
});

const id = (file.id ?? basename(file.path, ".jsonl")).slice(-8);
const out = resolve(values.out ?? `replay-${id}.${values.json ? "json" : "html"}`);
const mp4Only = out.endsWith(".mp4");
const seconds = (replay.durationInFrames / replay.fps).toFixed(1);

if (values.json) {
  await Bun.write(out, JSON.stringify(replay));
} else if (!mp4Only) {
  await Bun.write(out, buildHtml(replay));
}
if (!mp4Only) {
  const ms = Math.round(performance.now() - started);
  console.log(`${out}  (${replay.lines.length} lines, ${seconds}s of video, built in ${ms}ms)`);
}

if (mp4Only || values.mp4) {
  const { renderMp4 } = await import("./mp4.ts");
  const video = mp4Only ? out : out.replace(/\.(html|json)$/, "") + ".mp4";
  const rendering = performance.now();
  // The \r progress line only makes sense in a terminal. Agents capture stderr.
  const tty = process.stderr.isTTY;
  let shown = -1;
  await renderMp4(replay, video, (progress) => {
    const percent = Math.floor(progress * 100);
    if (tty && percent !== shown && percent % 5 === 0) {
      shown = percent;
      process.stderr.write(`\rRendering MP4 ${percent}%`);
    }
  });
  if (tty) process.stderr.write("\n");
  const took = ((performance.now() - rendering) / 1000).toFixed(1);
  console.log(`${video}  (${seconds}s of video, rendered in ${took}s)`);
}

function parseTurns(value: string | undefined): [number, number] | undefined {
  if (!value) return undefined;
  const [from, to] = value.split("-").map(Number);
  if (!from) throw new Error(`--turns expects a range like 2-4, got "${value}"`);
  return [from, to || (value.includes("-") ? Infinity : from)];
}

function parseFormat(value: string | undefined): Format | undefined {
  if (value === undefined) return undefined;
  if (!(value in FORMATS)) throw new Error(`--format expects ${Object.keys(FORMATS).join(", ")}, got "${value}"`);
  return value as Format;
}

/** "4-9: Finds the bug", "12" or "12: Tests pass". */
function parseCut(value: string): Cut {
  const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*(?::\s*(.*))?$/s.exec(value);
  if (!match) throw new Error(`--cut expects steps and an optional caption, like "4-9: Finds the bug", got "${value}"`);
  const from = Number(match[1]);
  const to = Number(match[2] ?? from);
  if (to < from) throw new Error(`--cut range ${from}-${to} ends before it starts`);
  return { from, to, ...(match[3]?.trim() ? { caption: match[3].trim() } : {}) };
}
