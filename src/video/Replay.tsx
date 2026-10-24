import { useLayoutEffect, useRef } from "react";
import { useCurrentFrame } from "remotion";
import { CHROME_ROWS, HEIGHT, WIDTH, type Line, type Prompt, type Replay as ReplayData, type Span, type Status } from "../replay.ts";
import { MONO, SANS, palettes, type Palette, type ToneStyle } from "./palette.ts";

export interface ReplayProps extends Record<string, unknown> {
  replay: ReplayData;
}

// The whole frame is drawn on one canvas. The web renderer copies a canvas
// as a single image instead of rasterising every DOM node, which makes
// in-browser MP4 export about 9x faster, and playback costs a few draw calls.

/** Inside of the 1px window border. */
const WINDOW = { left: 49, top: 37, width: WIDTH - 98, height: HEIGHT - 86 };
const RADIUS = 14;
const TITLEBAR = 40;
const PAD_X = 28;
const PAD_Y = 18;
// Matches the font's ascent + descent so box-drawing glyphs join up like in a real terminal.
const LINE = 28;
/** Frames a new row takes to slide in; also how far the scroll position lags behind. */
const SLIDE = 5;
const SPINNER = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
const LIGHTS = ["#ff5f57", "#febc2e", "#28c840"];

export const Replay = ({ replay }: ReplayProps) => {
  const frame = useCurrentFrame();
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (ctx) draw(ctx, replay, frame);
  }, [replay, frame]);
  return <canvas ref={canvas} width={WIDTH} height={HEIGHT} style={{ display: "block" }} />;
};

type Ctx = CanvasRenderingContext2D;

/** Draws text runs left to right on one terminal row. */
interface Pen {
  ctx: Ctx;
  colors: Palette;
  size: number;
  /** Baseline offset from the top of a row. */
  baseline: number;
  x: number;
  top: number;
}

function draw(ctx: Ctx, replay: ReplayData, frame: number) {
  const colors = palettes[replay.agent];
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = 1;

  backdrop(ctx, colors);
  ctx.save();
  roundRect(ctx, WINDOW.left - 1, WINDOW.top - 1, WINDOW.width + 2, WINDOW.height + 2, RADIUS, colors.border);
  roundRect(ctx, WINDOW.left, WINDOW.top, WINDOW.width, WINDOW.height, RADIUS - 1, colors.window);
  ctx.clip();
  ctx.translate(WINDOW.left, WINDOW.top);
  titleBar(ctx, replay, colors);

  ctx.translate(PAD_X, TITLEBAR + PAD_Y);
  const size = (WINDOW.width + 2 - PAD_X * 2) / (replay.cols * 0.605);
  ctx.font = font(size);
  const metrics = ctx.measureText("M");
  const pen: Pen = {
    ctx,
    colors,
    size,
    baseline: (LINE - metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2 + metrics.fontBoundingBoxAscent,
    x: 0,
    top: 0,
  };
  const width = WINDOW.width - PAD_X * 2;
  const transcriptRows = replay.rows - CHROME_ROWS;
  transcript(pen, replay.lines, frame, transcriptRows, width);
  pen.top = transcriptRows * LINE;
  if (replay.agent === "claude") claudeInput(pen, replay, frame, width);
  else codexInput(pen, replay, frame, width);
  ctx.restore();

  ctx.font = `15px ${SANS}`;
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,0.32)";
  ctx.fillText("agent-replay", WIDTH - 48, HEIGHT - 14 - ctx.measureText("a").fontBoundingBoxDescent);
  ctx.textAlign = "left";
}

/** The CSS `linear-gradient(135deg, a 0%, b 55%, c 100%)` the DOM version used. */
function backdrop(ctx: Ctx, colors: Palette) {
  const half = ((WIDTH + HEIGHT) * Math.SQRT1_2) / 2;
  const d = half * Math.SQRT1_2;
  const gradient = ctx.createLinearGradient(WIDTH / 2 - d, HEIGHT / 2 - d, WIDTH / 2 + d, HEIGHT / 2 + d);
  const [a, b, c] = colors.backdrop;
  gradient.addColorStop(0, a);
  gradient.addColorStop(0.55, b);
  gradient.addColorStop(1, c);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

function titleBar(ctx: Ctx, replay: ReplayData, colors: Palette) {
  ctx.fillStyle = colors.titlebar;
  ctx.fillRect(0, 0, WINDOW.width, TITLEBAR);
  ctx.fillStyle = colors.border;
  ctx.fillRect(0, TITLEBAR, WINDOW.width, 1);
  LIGHTS.forEach((color, i) => {
    ctx.beginPath();
    ctx.arc(18 + 6.5 + i * 21, 13 + 6.5, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });

  const folder = replay.cwd.split("/").filter(Boolean).pop() ?? "~";
  const title = replay.agent === "claude" ? `✳ ${replay.title || "Claude Code"}` : `codex — ${folder}`;
  ctx.font = `15px ${SANS}`;
  const metrics = ctx.measureText(title);
  const ascent = metrics.fontBoundingBoxAscent;
  ctx.textAlign = "center";
  ctx.fillStyle = colors.dim;
  ctx.fillText(ellipsis(ctx, title, WINDOW.width * 0.7), WINDOW.width / 2, (TITLEBAR - ascent - metrics.fontBoundingBoxDescent) / 2 + ascent);
  ctx.textAlign = "left";
}

function ellipsis(ctx: Ctx, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let end = text.length;
  while (end > 0 && ctx.measureText(`${text.slice(0, end)}…`).width > max) end--;
  return `${text.slice(0, end)}…`;
}

function font(size: number, style?: ToneStyle): string {
  return `${style?.italic ? "italic " : ""}${style?.bold ? "700 " : ""}${size}px ${MONO}`;
}

/** Draws `text` at the pen and advances it. */
function run(pen: Pen, text: string, style: ToneStyle) {
  const { ctx } = pen;
  ctx.font = font(pen.size, style);
  const width = ctx.measureText(text).width;
  if (style.bg) {
    ctx.fillStyle = style.bg;
    ctx.fillRect(pen.x, pen.top, width, LINE);
  }
  ctx.fillStyle = style.color;
  ctx.fillText(text, pen.x, pen.top + pen.baseline);
  pen.x += width;
}

function row(pen: Pen, top: number, bg?: string, width = 0) {
  pen.x = 0;
  pen.top = top;
  if (bg) {
    pen.ctx.fillStyle = bg;
    pen.ctx.fillRect(0, top, width, LINE);
  }
}

/** Index of the first line whose `at` is greater than `frame`, i.e. how many lines are visible. */
function visibleCount(lines: Line[], frame: number): number {
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.at <= frame) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function transcript(pen: Pen, lines: Line[], frame: number, rows: number, width: number) {
  const { ctx, colors } = pen;
  const count = visibleCount(lines, frame);
  // Rows that appeared in the last SLIDE frames count fractionally, so the
  // transcript glides up instead of jumping a row at a time.
  let settled = count;
  for (let i = count - 1; i >= 0 && frame - lines[i]!.at < SLIDE; i--) {
    settled -= 1 - (frame - lines[i]!.at) / SLIDE;
  }
  const top = Math.max(0, settled - rows);
  const first = Math.floor(top);
  const offset = (top - first) * LINE;
  const last = Math.min(count, first + rows + 1);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, rows * LINE);
  ctx.clip();
  for (let i = first; i < last; i++) {
    const line = lines[i]!;
    const dot = line.dot ? dotTone(line.dot, frame) : undefined;
    ctx.globalAlpha = Math.min(1, (frame - line.at + 1) / SLIDE);
    row(pen, (i - first) * LINE - offset, line.bg === "user" ? colors.userBg : undefined, width);
    line.s.forEach((span, j) => run(pen, span[0], colors.tones[j === 0 && dot ? dot : (span[1] ?? "fg")]));
  }
  ctx.restore();
}

function dotTone([done, ok]: [number, 0 | 1], frame: number): Span[1] {
  if (frame >= done) return ok ? "ok" : "err";
  return Math.floor(frame / 9) % 2 === 0 ? "fg" : "dim";
}

function activeAt<T extends { from: number; to: number }>(items: T[], frame: number): T | undefined {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid]!.from <= frame) lo = mid + 1;
    else hi = mid;
  }
  const item = items[lo - 1];
  return item && frame < item.to ? item : undefined;
}

/** Text visible in the input box on this frame. */
function draft(prompt: Prompt | undefined, frame: number): { text: string; typing: boolean } {
  if (!prompt) return { text: "", typing: false };
  if (prompt.paste) return { text: frame >= prompt.from + 4 ? prompt.paste : "", typing: false };
  const progress = Math.min(1, (frame - prompt.from) / Math.max(1, prompt.typed - prompt.from));
  const text = prompt.text.slice(0, Math.round(prompt.text.length * progress));
  return { text: text.split("\n").pop() ?? "", typing: progress < 1 };
}

function elapsed(status: Status, frame: number): string {
  const progress = (frame - status.from) / Math.max(1, status.to - status.from);
  const seconds = Math.round(status.s0 + (status.s1 - status.s0) * progress);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Label with a highlight sweeping across it, like the agents' own working indicators. */
function shimmer(pen: Pen, text: string, frame: number, base: string, glow: string) {
  const head = ((frame * 0.7) % (text.length + 14)) - 7;
  Array.from(text).forEach((char, i) => run(pen, char, { color: Math.abs(i - head) < 2.5 ? glow : base }));
}

function cursor(pen: Pen, frame: number, typing: boolean) {
  const width = pen.ctx.measureText(" ").width;
  if (typing || Math.floor(frame / 16) % 2 === 0) {
    pen.ctx.fillStyle = pen.colors.fg;
    pen.ctx.fillRect(pen.x, pen.top, width, LINE);
  }
  pen.x += width;
}

function fit(text: string, cells: number): string {
  return text.length > cells ? text.slice(text.length - cells) : text;
}

/** The "? for shortcuts" row with the model name on the right. */
function footer(pen: Pen, model: string, width: number) {
  const dim = { color: pen.colors.dim };
  run(pen, "  ? for shortcuts", dim);
  pen.ctx.font = font(pen.size);
  pen.x = width - pen.ctx.measureText(model).width;
  run(pen, model, dim);
}

function claudeInput(pen: Pen, replay: ReplayData, frame: number, width: number) {
  const { colors } = pen;
  const top = pen.top;
  const status = activeAt(replay.status, frame);
  const { text, typing } = draft(activeAt(replay.prompts, frame), frame);
  const inner = replay.cols - 4;
  const shown = fit(text, inner - 3);
  const dim = { color: colors.dim };

  row(pen, top);
  if (status) {
    run(pen, `${SPINNER[Math.floor(frame / 4) % SPINNER.length]} `, { color: colors.acc });
    shimmer(pen, `${status.label}…`, frame, colors.acc, colors.shimmer);
    run(pen, ` (${elapsed(status, frame)} · `, dim);
    run(pen, "esc", { ...dim, bold: true });
    run(pen, " to interrupt)", dim);
  }
  row(pen, top + LINE * 2);
  run(pen, `╭${"─".repeat(replay.cols - 2)}╮`, dim);
  row(pen, top + LINE * 3);
  run(pen, "│ ", dim);
  run(pen, "> ", dim);
  run(pen, shown, { color: colors.fg });
  cursor(pen, frame, typing);
  run(pen, " ".repeat(Math.max(0, inner - 3 - shown.length)), { color: colors.fg });
  run(pen, " │", dim);
  row(pen, top + LINE * 4);
  run(pen, `╰${"─".repeat(replay.cols - 2)}╯`, dim);
  row(pen, top + LINE * 5);
  footer(pen, replay.model, width);
}

function codexInput(pen: Pen, replay: ReplayData, frame: number, width: number) {
  const { colors } = pen;
  const top = pen.top;
  const status = activeAt(replay.status, frame);
  const { text, typing } = draft(activeAt(replay.prompts, frame), frame);
  const shown = fit(text, replay.cols - 6);
  const dim = { color: colors.dim };

  row(pen, top);
  if (status) {
    run(pen, "• ", dim);
    shimmer(pen, status.label, frame, colors.dim, colors.shimmer);
    run(pen, ` (${elapsed(status, frame)} • esc to interrupt)`, dim);
  }
  row(pen, top + LINE, colors.inputBg, width);
  row(pen, top + LINE * 2, colors.inputBg, width);
  run(pen, "› ", { color: colors.fg, bold: true });
  if (shown) run(pen, shown, { color: colors.fg });
  cursor(pen, frame, typing);
  if (!shown) run(pen, "Ask Codex to do anything", dim);
  row(pen, top + LINE * 3, colors.inputBg, width);
  row(pen, top + LINE * 5);
  footer(pen, replay.model, width);
}
