#!/usr/bin/env bun
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { version } from "../package.json";
import { buildHtml } from "./html.ts";
import { layout } from "./layout/index.ts";
import { parseSession } from "./parse/index.ts";
import { redactDeep } from "./redact.ts";
import { describe, findSessions, resolveSession } from "./sessions.ts";

const HELP = `agent-replay: turn a Claude Code or Codex session into a terminal replay

Usage
  agent-replay [session] [options]     Write replay.html (and optionally an MP4)
  agent-replay list [--limit 20]       List local sessions, newest first

Session
  A .jsonl path, a session id (or part of one), latest, latest:claude, latest:codex.
  Defaults to latest.

Options
  -o, --out <file>     Output path. Ending in .mp4 renders only the video.
      --mp4            Also render an MP4 next to the HTML.
      --speed <n>      Playback speed multiplier (default 1).
      --turns <a-b>    Keep only user turns a through b, e.g. 2-4 or 3.
      --json           Write the replay data as JSON instead.
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
    const id = basename(file.path, ".jsonl").replace(/^rollout-[\dT-]+?-(?=[0-9a-f]{8}-)/, "");
    console.log(`${file.agent.padEnd(6)} ${when.padEnd(16)} ${size}  ${id}  ${title || cwd}`);
  }
  process.exit(0);
}

const started = performance.now();
const path = await resolveSession(positionals[0] ?? "latest");
const session = redactDeep(parseSession(await Bun.file(path).text()), homedir());
const replay = layout(session, { speed: Number(values.speed ?? 1), turns: parseTurns(values.turns) });

const id = basename(path, ".jsonl").slice(-8);
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
