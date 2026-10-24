import { useLayoutEffect, useRef } from "react";
import { useCurrentFrame } from "remotion";
import { CHROME_ROWS, type Caption, type Line, type Prompt, type Replay as ReplayData, type Span, type Status } from "../replay.ts";
import { AGENT_NAMES } from "../session.ts";
import { MONO, SANS, palettes, type Palette, type ToneStyle } from "./palette.ts";

export interface ReplayProps extends Record<string, unknown> {
  replay: ReplayData;
}

// The whole frame is drawn on one canvas. The web renderer copies a canvas
// as a single image instead of rasterising every DOM node, which makes
// in-browser MP4 export about 9x faster, and playback costs a few draw calls.

const RADIUS = 14;
const TITLEBAR = 40;
const PAD_X = 28;
const PAD_Y = 18;
// Row height per pixel of font size. Matches the font's ascent + descent, so
// box-drawing glyphs join up like in a real terminal.
const LINE_HEIGHT = 1.152;
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
  return <canvas ref={canvas} width={replay.width} height={replay.height} style={{ display: "block" }} />;
};

type Ctx = CanvasRenderingContext2D;

/** Draws text runs left to right on one terminal row. */
interface Pen {
  ctx: Ctx;
  colors: Palette;
  size: number;
  /** Row height in pixels. */
  line: number;
  /** Baseline offset from the top of a row. */
  baseline: number;
  x: number;
  top: number;
}

/** Inside of the 1px window border. */
function windowRect(replay: ReplayData) {
  return { left: 49, top: 37, width: replay.width - 98, height: replay.height - 86 };
}

function draw(ctx: Ctx, replay: ReplayData, frame: number) {
  const colors = palettes[replay.agent];
  const win = windowRect(replay);
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = 1;

  backdrop(ctx, replay, colors);
  ctx.save();
  roundRect(ctx, win.left - 1, win.top - 1, win.width + 2, win.height + 2, RADIUS, colors.border);
  roundRect(ctx, win.left, win.top, win.width, win.height, RADIUS - 1, colors.window);
  ctx.clip();
  ctx.translate(win.left, win.top);
  titleBar(ctx, replay, colors, win.width);

  ctx.translate(PAD_X, TITLEBAR + PAD_Y);
  const size = (win.width + 2 - PAD_X * 2) / (replay.cols * 0.605);
  const line = Math.round(size * LINE_HEIGHT);
  ctx.font = font(size);
  const metrics = ctx.measureText("M");
  const pen: Pen = {
    ctx,
    colors,
    size,
    line,
    baseline: (line - metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2 + metrics.fontBoundingBoxAscent,
    x: 0,
    top: 0,
  };
  const width = win.width - PAD_X * 2;
  const transcriptRows = replay.rows - CHROME_ROWS;
  transcript(pen, replay.lines, frame, transcriptRows, width);
  pen.top = transcriptRows * line;
  if (replay.agent === "claude") claudeInput(pen, replay, frame, width);
  else if (replay.agent === "codex") codexInput(pen, replay, frame, width);
  else opencodeInput(pen, replay, frame, width);
  ctx.restore();

  const caption = activeAt(replay.captions, frame);
  if (caption) drawCaption(ctx, caption, frame, colors, replay, win.top + TITLEBAR + PAD_Y + transcriptRows * line);

  ctx.font = `15px ${SANS}`;
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,0.32)";
  ctx.fillText("agent-replay", replay.width - 48, replay.height - 14 - ctx.measureText("a").fontBoundingBoxDescent);
  ctx.textAlign = "left";

  if (replay.card && frame < replay.card.to) drawCard(ctx, replay, replay.card, frame, colors);
}

/** The CSS `linear-gradient(135deg, a 0%, b 55%, c 100%)` the DOM version used. */
function backdrop(ctx: Ctx, { width, height }: ReplayData, colors: Palette) {
  const half = ((width + height) * Math.SQRT1_2) / 2;
  const d = half * Math.SQRT1_2;
  const gradient = ctx.createLinearGradient(width / 2 - d, height / 2 - d, width / 2 + d, height / 2 + d);
  const [a, b, c] = colors.backdrop;
  gradient.addColorStop(0, a);
  gradient.addColorStop(0.55, b);
  gradient.addColorStop(1, c);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

function titleBar(ctx: Ctx, replay: ReplayData, colors: Palette, width: number) {
  ctx.fillStyle = colors.titlebar;
  ctx.fillRect(0, 0, width, TITLEBAR);
  ctx.fillStyle = colors.border;
  ctx.fillRect(0, TITLEBAR, width, 1);
  LIGHTS.forEach((color, i) => {
    ctx.beginPath();
    ctx.arc(18 + 6.5 + i * 21, 13 + 6.5, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });

  const folder = replay.cwd.split("/").filter(Boolean).pop() ?? "~";
  const title =
    replay.agent === "claude"
      ? `✳ ${replay.title || "Claude Code"}`
      : replay.agent === "codex"
        ? `codex — ${folder}`
        : `OC | ${replay.title || folder}`;
  ctx.font = `15px ${SANS}`;
  const metrics = ctx.measureText(title);
  const ascent = metrics.fontBoundingBoxAscent;
  ctx.textAlign = "center";
  ctx.fillStyle = colors.dim;
  ctx.fillText(ellipsis(ctx, title, width * 0.7), width / 2, (TITLEBAR - ascent - metrics.fontBoundingBoxDescent) / 2 + ascent);
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
    ctx.fillRect(pen.x, pen.top, width, pen.line);
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
    pen.ctx.fillRect(0, top, width, pen.line);
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
  const { ctx, colors, line: height } = pen;
  const count = visibleCount(lines, frame);
  // Rows that appeared in the last SLIDE frames count fractionally, so the
  // transcript glides up instead of jumping a row at a time.
  let settled = count;
  for (let i = count - 1; i >= 0 && frame - lines[i]!.at < SLIDE; i--) {
    settled -= 1 - (frame - lines[i]!.at) / SLIDE;
  }
  const top = Math.max(0, settled - rows);
  const first = Math.floor(top);
  const offset = (top - first) * height;
  const last = Math.min(count, first + rows + 1);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, rows * height);
  ctx.clip();
  for (let i = first; i < last; i++) {
    const line = lines[i]!;
    const dot = line.dot ? dotTone(line.dot, frame) : undefined;
    ctx.globalAlpha = Math.min(1, (frame - line.at + 1) / SLIDE);
    row(pen, (i - first) * height - offset, line.bg === "user" ? colors.userBg : undefined, width);
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
    pen.ctx.fillRect(pen.x, pen.top, width, pen.line);
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
  row(pen, top + pen.line * 2);
  run(pen, `╭${"─".repeat(replay.cols - 2)}╮`, dim);
  row(pen, top + pen.line * 3);
  run(pen, "│ ", dim);
  run(pen, "> ", dim);
  run(pen, shown, { color: colors.fg });
  cursor(pen, frame, typing);
  run(pen, " ".repeat(Math.max(0, inner - 3 - shown.length)), { color: colors.fg });
  run(pen, " │", dim);
  row(pen, top + pen.line * 4);
  run(pen, `╰${"─".repeat(replay.cols - 2)}╯`, dim);
  row(pen, top + pen.line * 5);
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
  row(pen, top + pen.line, colors.inputBg, width);
  row(pen, top + pen.line * 2, colors.inputBg, width);
  run(pen, "› ", { color: colors.fg, bold: true });
  if (shown) run(pen, shown, { color: colors.fg });
  cursor(pen, frame, typing);
  if (!shown) run(pen, "Ask Codex to do anything", dim);
  row(pen, top + pen.line * 3, colors.inputBg, width);
  row(pen, top + pen.line * 5);
  footer(pen, replay.model, width);
}

/** OpenCode's prompt: a panel behind the agent-coloured bar, then the working scanner and key hints. */
function opencodeInput(pen: Pen, replay: ReplayData, frame: number, width: number) {
  const { colors } = pen;
  const top = pen.top;
  const status = activeAt(replay.status, frame);
  const { text, typing } = draft(activeAt(replay.prompts, frame), frame);
  const shown = fit(text, replay.cols - 6);
  const dim = { color: colors.dim };
  const bar = { color: colors.acc };

  for (let i = 0; i < 4; i++) {
    row(pen, top + pen.line * i, colors.inputBg, width);
    run(pen, "┃  ", bar);
  }
  row(pen, top + pen.line);
  run(pen, "┃  ", bar);
  if (shown) run(pen, shown, { color: colors.fg });
  cursor(pen, frame, typing);
  if (!shown) run(pen, 'Ask anything... "Fix a TODO in the codebase"', dim);
  row(pen, top + pen.line * 3);
  run(pen, "┃  ", bar);
  run(pen, "Build", bar);
  run(pen, `  ${replay.model}`, { color: colors.fg });
  row(pen, top + pen.line * 4);
  run(pen, "╹", bar);
  run(pen, "▀".repeat(replay.cols - 1), { color: colors.inputBg });

  row(pen, top + pen.line * 5);
  if (status) {
    // The scanner sweeps a lit block with a fading tail back and forth across eight cells.
    const cells = 8;
    const cell = pen.ctx.measureText(" ").width;
    const position = Math.floor(frame / 2) % ((cells - 1) * 2);
    const head = position < cells ? position : (cells - 1) * 2 - position;
    const back = position >= cells;
    for (let i = 0; i < cells; i++) {
      const trail = back ? i - head : head - i;
      const lit = trail >= 0 && trail < 3;
      pen.ctx.globalAlpha = lit ? 1 - trail * 0.3 : 0.35;
      pen.ctx.fillStyle = lit ? colors.acc : colors.dim;
      const h = lit ? pen.line * 0.42 : pen.line * 0.14;
      pen.ctx.fillRect(pen.x + i * cell + cell * 0.12, pen.top + (pen.line - h) / 2, cell * 0.76, h);
    }
    pen.ctx.globalAlpha = 1;
    pen.x += cells * cell;
    run(pen, "  esc ", { color: colors.fg });
    run(pen, "interrupt", dim);
  }
  const hint = "ctrl+p commands";
  pen.ctx.font = font(pen.size);
  pen.x = width - pen.ctx.measureText(hint).width;
  run(pen, "ctrl+p ", { color: colors.fg });
  run(pen, "commands", dim);
}

/** Splits `text` into lines no wider than `max` pixels at the current font. */
function wrapWords(ctx: Ctx, text: string, max: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    const next = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(next).width > max) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** A highlight caption: a pill above the input box that slides in when its cut starts. */
function drawCaption(ctx: Ctx, caption: Caption, frame: number, colors: Palette, replay: ReplayData, bottom: number) {
  // Bigger on vertical video, which is watched on a phone.
  const size = Math.round(Math.min(replay.width, replay.height) * (replay.height > replay.width ? 0.052 : 0.04));
  const enter = Math.min(1, (frame - caption.from) / 8);
  const leave = caption.to >= replay.durationInFrames ? 1 : Math.min(1, (caption.to - frame) / 6);
  const alpha = Math.min(enter, leave);
  const counter = `${caption.index}/${caption.count}`;

  ctx.font = `700 ${size}px ${SANS}`;
  const counterWidth = ctx.measureText(`${counter}  `).width;
  const max = (replay.width - 98) * 0.84 - counterWidth;
  const lines = wrapWords(ctx, caption.text, max).slice(0, 2);
  const textWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
  const lineHeight = Math.round(size * 1.25);
  const padX = Math.round(size * 0.6);
  const padY = Math.round(size * 0.38);
  const w = counterWidth + textWidth + padX * 2;
  const h = lines.length * lineHeight + padY * 2;
  const x = (replay.width - w) / 2;
  const y = bottom - h - 24 + (1 - enter) * 16;

  ctx.save();
  ctx.globalAlpha = alpha;
  roundRect(ctx, x - 2, y - 2, w + 4, h + 4, 18, colors.acc);
  roundRect(ctx, x, y, w, h, 16, "#0c0c0c");
  const ascent = ctx.measureText("M").fontBoundingBoxAscent;
  const offset = (lineHeight - ascent - ctx.measureText("M").fontBoundingBoxDescent) / 2 + ascent;
  ctx.fillStyle = colors.acc;
  ctx.fillText(counter, x + padX, y + padY + offset);
  ctx.fillStyle = "#ffffff";
  lines.forEach((line, i) => ctx.fillText(line, x + padX + counterWidth, y + padY + i * lineHeight + offset));
  ctx.restore();
}

/** Opening title card over the backdrop, fading out into the terminal. */
function drawCard(ctx: Ctx, replay: ReplayData, card: { text: string; to: number }, frame: number, colors: Palette) {
  const { width, height } = replay;
  const fade = 12;
  ctx.save();
  ctx.globalAlpha = Math.min(1, (card.to - frame) / fade);
  backdrop(ctx, replay, colors);

  const size = Math.round(Math.min(width, height) * 0.075);
  ctx.font = `800 ${size}px ${SANS}`;
  const lines = wrapWords(ctx, card.text, width * 0.8).slice(0, 4);
  const lineHeight = Math.round(size * 1.15);
  const label = [AGENT_NAMES[replay.agent], replay.model].filter(Boolean).join(" · ");
  const labelSize = Math.round(size * 0.42);
  const total = lines.length * lineHeight + labelSize * 2.2;
  const rise = (1 - Math.min(1, frame / 10)) * 20;
  let y = (height - total) / 2 + rise;

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  for (const line of lines) {
    ctx.fillText(line, width / 2, y);
    y += lineHeight;
  }
  ctx.font = `600 ${labelSize}px ${SANS}`;
  ctx.fillStyle = colors.acc;
  ctx.fillText(label, width / 2, y + labelSize * 1.2);
  ctx.restore();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}
