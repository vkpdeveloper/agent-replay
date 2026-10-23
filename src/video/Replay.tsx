import { memo, type CSSProperties } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { CHROME_ROWS, HEIGHT, WIDTH, type Line, type Prompt, type Replay as ReplayData, type Span, type Status } from "../replay.ts";
import { MONO, SANS, palettes, type Palette } from "./palette.ts";

export interface ReplayProps extends Record<string, unknown> {
  replay: ReplayData;
}

const WINDOW = { left: 48, top: 36, width: WIDTH - 96, height: HEIGHT - 84 };
const TITLEBAR = 40;
const PAD_X = 28;
const PAD_Y = 18;
// Matches the font's ascent + descent so box-drawing glyphs join up like in a real terminal.
const LINE = 28;
/** Frames a new row takes to slide in; also how far the scroll position lags behind. */
const SLIDE = 5;
const SPINNER = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];

export const Replay = ({ replay }: ReplayProps) => {
  const frame = useCurrentFrame();
  const colors = palettes[replay.agent];
  const fontSize = (WINDOW.width - PAD_X * 2) / (replay.cols * 0.605);
  const transcriptRows = replay.rows - CHROME_ROWS;

  return (
    <AbsoluteFill style={{ backgroundImage: colors.backdrop, fontFamily: MONO }}>
      <div
        style={{
          position: "absolute",
          ...WINDOW,
          borderRadius: 14,
          overflow: "hidden",
          backgroundColor: colors.window,
          border: `1px solid ${colors.border}`,
        }}
      >
        <TitleBar replay={replay} colors={colors} />
        <div
          style={{
            position: "absolute",
            top: TITLEBAR + PAD_Y,
            left: PAD_X,
            right: PAD_X,
            bottom: PAD_Y,
            fontSize,
            lineHeight: `${LINE}px`,
            color: colors.fg,
            fontVariantLigatures: "none",
          }}
        >
          <Transcript lines={replay.lines} frame={frame} rows={transcriptRows} colors={colors} />
          <div style={{ position: "absolute", left: 0, right: 0, top: transcriptRows * LINE }}>
            {replay.agent === "claude" ? (
              <ClaudeInput replay={replay} frame={frame} colors={colors} />
            ) : (
              <CodexInput replay={replay} frame={frame} colors={colors} />
            )}
          </div>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          right: WINDOW.left,
          bottom: 14,
          fontFamily: SANS,
          fontSize: 15,
          color: "rgba(255,255,255,0.32)",
        }}
      >
        agent-replay
      </div>
    </AbsoluteFill>
  );
};

const TitleBar = ({ replay, colors }: { replay: ReplayData; colors: Palette }) => {
  const folder = replay.cwd.split("/").filter(Boolean).pop() ?? "~";
  const title = replay.agent === "claude" ? `✳ ${replay.title || "Claude Code"}` : `codex — ${folder}`;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        height: TITLEBAR,
        backgroundColor: colors.titlebar,
        borderBottom: `1px solid ${colors.border}`,
        fontFamily: SANS,
        fontSize: 15,
        color: colors.dim,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ position: "absolute", left: 18, top: 13, display: "flex", gap: 8 }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((color) => (
          <div key={color} style={{ width: 13, height: 13, borderRadius: 7, backgroundColor: color }} />
        ))}
      </div>
      <span style={{ maxWidth: "70%", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{title}</span>
    </div>
  );
};

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

const Transcript = ({ lines, frame, rows, colors }: { lines: Line[]; frame: number; rows: number; colors: Palette }) => {
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

  const visible = [];
  for (let i = first; i < last; i++) {
    const line = lines[i]!;
    const dot = line.dot ? dotTone(line.dot, frame) : undefined;
    const fresh = Math.min(1, (frame - line.at + 1) / SLIDE);
    visible.push(<Row key={i} line={line} y={(i - first) * LINE - offset} dot={dot} opacity={fresh} colors={colors} />);
  }
  return <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: rows * LINE, overflow: "hidden" }}>{visible}</div>;
};

function dotTone([done, ok]: [number, 0 | 1], frame: number): Span[1] {
  if (frame >= done) return ok ? "ok" : "err";
  return Math.floor(frame / 9) % 2 === 0 ? "fg" : "dim";
}

const Row = memo(
  ({ line, y, dot, opacity, colors }: { line: Line; y: number; dot: Span[1] | undefined; opacity: number; colors: Palette }) => (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        height: LINE,
        translate: `0 ${y}px`,
        opacity,
        whiteSpace: "pre",
        overflow: "hidden",
        backgroundColor: line.bg === "user" ? colors.userBg : undefined,
      }}
    >
      {line.s.map((span, i) => (
        <span key={i} style={colors.tones[i === 0 && dot ? dot : (span[1] ?? "fg")]}>
          {span[0]}
        </span>
      ))}
    </div>
  ),
);

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
const Shimmer = ({ text, frame, base, glow }: { text: string; frame: number; base: string; glow: string }) => {
  const head = ((frame * 0.7) % (text.length + 14)) - 7;
  return (
    <>
      {Array.from(text, (char, i) => (
        <span key={i} style={{ color: Math.abs(i - head) < 2.5 ? glow : base }}>
          {char}
        </span>
      ))}
    </>
  );
};

const Cursor = ({ frame, typing, colors }: { frame: number; typing: boolean; colors: Palette }) => (
  <span style={{ backgroundColor: typing || Math.floor(frame / 16) % 2 === 0 ? colors.fg : "transparent", color: colors.window }}> </span>
);

function fit(text: string, cells: number): string {
  return text.length > cells ? text.slice(text.length - cells) : text;
}

const rowStyle: CSSProperties = { height: LINE, whiteSpace: "pre", overflow: "hidden" };

const ClaudeInput = ({ replay, frame, colors }: { replay: ReplayData; frame: number; colors: Palette }) => {
  const status = activeAt(replay.status, frame);
  const { text, typing } = draft(activeAt(replay.prompts, frame), frame);
  const inner = replay.cols - 4;
  const shown = fit(text, inner - 3);
  const glyph = SPINNER[Math.floor(frame / 4) % SPINNER.length];
  const border = { color: colors.dim };
  return (
    <>
      <div style={rowStyle}>
        {status && (
          <>
            <span style={{ color: colors.acc }}>{glyph} </span>
            <Shimmer text={`${status.label}…`} frame={frame} base={colors.acc} glow={colors.shimmer} />
            <span style={{ color: colors.dim }}> ({elapsed(status, frame)} · </span>
            <span style={{ color: colors.dim, fontWeight: 700 }}>esc</span>
            <span style={{ color: colors.dim }}> to interrupt)</span>
          </>
        )}
      </div>
      <div style={rowStyle} />
      <div style={{ ...rowStyle, ...border }}>{`╭${"─".repeat(replay.cols - 2)}╮`}</div>
      <div style={rowStyle}>
        <span style={border}>│ </span>
        <span style={{ color: colors.dim }}>{"> "}</span>
        <span>{shown}</span>
        <Cursor frame={frame} typing={typing} colors={colors} />
        <span>{" ".repeat(Math.max(0, inner - 3 - shown.length))}</span>
        <span style={border}> │</span>
      </div>
      <div style={{ ...rowStyle, ...border }}>{`╰${"─".repeat(replay.cols - 2)}╯`}</div>
      <div style={{ ...rowStyle, color: colors.dim, display: "flex", justifyContent: "space-between" }}>
        <span>{"  ? for shortcuts"}</span>
        <span>{replay.model}</span>
      </div>
    </>
  );
};

const CodexInput = ({ replay, frame, colors }: { replay: ReplayData; frame: number; colors: Palette }) => {
  const status = activeAt(replay.status, frame);
  const { text, typing } = draft(activeAt(replay.prompts, frame), frame);
  const shown = fit(text, replay.cols - 6);
  const block: CSSProperties = { ...rowStyle, backgroundColor: colors.inputBg };
  return (
    <>
      <div style={rowStyle}>
        {status && (
          <>
            <span style={{ color: colors.dim }}>• </span>
            <Shimmer text={status.label} frame={frame} base={colors.dim} glow={colors.shimmer} />
            <span style={{ color: colors.dim }}> ({elapsed(status, frame)} • esc to interrupt)</span>
          </>
        )}
      </div>
      <div style={block} />
      <div style={block}>
        <span style={{ fontWeight: 700 }}>{"› "}</span>
        {shown ? <span>{shown}</span> : null}
        <Cursor frame={frame} typing={typing} colors={colors} />
        {!shown && <span style={{ color: colors.dim }}>Ask Codex to do anything</span>}
      </div>
      <div style={block} />
      <div style={rowStyle} />
      <div style={{ ...rowStyle, color: colors.dim, display: "flex", justifyContent: "space-between" }}>
        <span>{"  ? for shortcuts"}</span>
        <span>{replay.model}</span>
      </div>
    </>
  );
};
