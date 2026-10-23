import { COLS, FPS, ROWS, type Line, type Prompt, type Replay, type Span, type Status } from "../replay.ts";
import type { Session } from "../session.ts";
import { claude } from "./claude.ts";
import { codex } from "./codex.ts";
import type { Theme } from "./theme.ts";

export interface LayoutOptions {
  /** Playback speed multiplier. 2 plays twice as fast. */
  speed?: number;
  /** Inclusive 1-based range of user turns to keep. */
  turns?: [number, number];
}

const themes: Record<Session["agent"], Theme> = { claude, codex };

// Pacing, in frames at 30 fps before `speed` is applied. Real sessions run for
// hours; a replay keeps the rhythm (typing, waiting on tools, streaming text)
// and drops the dead time.
const PACE = {
  typePerChar: 0.45,
  typeMax: 75,
  pasteHold: 18,
  submit: 6,
  firstToken: 14,
  streamLine: 2,
  blockMax: 75,
  afterBlock: 8,
  toolMin: 6,
  toolMax: 36,
  afterTool: 4,
  betweenTurns: 24,
  intro: 20,
  outro: 75,
};

const PASTE_CHARS = 220;

export function layout(session: Session, options: LayoutOptions = {}): Replay {
  const theme = themes[session.agent];
  const speed = options.speed ?? 1;
  const width = COLS - 2;
  const lines: Line[] = [];
  const prompts: Prompt[] = [];
  const status: Status[] = [];

  let t = 0;
  const wait = (frames: number) => {
    t += frames / speed;
  };
  const frame = () => Math.round(t);
  const emit = (rows: Span[][], perRow: number, extra?: Omit<Line, "at" | "s">) => {
    const step = rows.length * perRow > PACE.blockMax ? PACE.blockMax / rows.length : perRow;
    for (const s of rows) {
      lines.push({ at: frame(), s, ...extra });
      wait(step);
    }
  };

  // Working indicator: open while the agent works on a turn, relabelled as it goes.
  let open: { from: number; label: string; s0: number } | undefined;
  let turnStart = 0;
  let turnVerb = "";
  const elapsed = (at: number) => Math.max(0, (at - turnStart) / 1000);
  const closeStatus = (at: number) => {
    if (!open) return;
    status.push({ ...open, to: frame(), s1: Math.max(open.s0, elapsed(at)) });
    open = undefined;
  };
  const setStatus = (label: string, at: number) => {
    if (open?.label === label) return;
    const s0 = open ? elapsed(at) : 0;
    closeStatus(at);
    open = { from: frame(), label, s0 };
  };

  for (const s of theme.header(session, width)) lines.push({ at: 0, s });
  wait(PACE.intro);

  let turn = 0;
  let group: string | undefined;
  const [firstTurn, lastTurn] = options.turns ?? [1, Infinity];

  for (const event of session.events) {
    if (event.type === "user") turn++;
    if (turn < firstTurn || turn > lastTurn) continue;
    if (event.type !== "tool") group = undefined;

    switch (event.type) {
      case "user": {
        closeStatus(event.at);
        if (prompts.length > 0) wait(PACE.betweenTurns);
        const text = event.text;
        const lineCount = text.split("\n").length;
        const paste = text.length > PASTE_CHARS || lineCount > 3;
        const from = frame();
        if (paste) wait(PACE.pasteHold);
        else wait(Math.min(PACE.typeMax, text.length * PACE.typePerChar));
        const typed = frame();
        wait(PACE.submit);
        prompts.push({
          from,
          typed,
          to: frame(),
          text,
          ...(paste ? { paste: session.agent === "claude" ? `[Pasted text #1 +${lineCount} lines]` : `[Pasted Content ${text.length} chars]` } : {}),
        });
        emit(theme.user(text, width), 0, { bg: "user" });
        lines.push({ at: frame(), s: [] });
        turnStart = event.at;
        turnVerb = theme.verb(turn);
        setStatus(turnVerb, event.at);
        wait(PACE.firstToken);
        break;
      }
      case "assistant":
        emit(theme.assistant(event.text, width), PACE.streamLine);
        lines.push({ at: frame(), s: [] });
        wait(PACE.afterBlock);
        break;
      case "thinking": {
        const { rows, label } = theme.thinking(event.text, width);
        if (label) setStatus(label, event.at);
        if (rows.length) {
          emit(rows, PACE.streamLine);
          lines.push({ at: frame(), s: [] });
        }
        wait(PACE.afterBlock / 2);
        break;
      }
      case "notice":
        emit(theme.notice(event.text, width), 1);
        lines.push({ at: frame(), s: [] });
        wait(PACE.afterBlock);
        break;
      case "tool": {
        const next = theme.group(event.tool);
        const continuing = next !== undefined && next === group;
        group = next;
        const { head, body } = theme.tool(event.tool, event.ok, continuing, width);
        if (continuing) {
          // Drop the blank row that closed the previous step so the group stays contiguous.
          const last = lines[lines.length - 1];
          if (last && last.s.length === 0) lines.pop();
        }
        if (open === undefined && turnVerb) setStatus(turnVerb, event.at);
        const pending = toolFrames(event.ms) / speed;
        const headAt = frame();
        head.forEach((s, i) => lines.push({ at: headAt, s, ...(i === 0 ? { dot: [Math.round(headAt + pending), event.ok ? 1 : 0] } : {}) }));
        wait(continuing ? pending / 2 : pending);
        emit(body, 1);
        lines.push({ at: frame(), s: [] });
        wait(PACE.afterTool);
        break;
      }
    }
  }

  const last = session.events[session.events.length - 1];
  closeStatus(last?.at ?? 0);
  wait(PACE.outro);
  // Trailing blank rows would scroll content away during the outro.
  while (lines.length && lines[lines.length - 1]!.s.length === 0) lines.pop();

  return {
    agent: session.agent,
    title: session.title,
    cwd: session.cwd,
    model: session.model,
    version: session.version,
    fps: FPS,
    cols: COLS,
    rows: ROWS,
    durationInFrames: Math.max(1, frame()),
    lines,
    prompts,
    status,
  };
}

/** A tool's spinner time grows with the log of its real duration. */
function toolFrames(ms: number): number {
  const frames = PACE.toolMin + 5 * Math.log2(1 + ms / 250);
  return Math.min(PACE.toolMax, Math.max(PACE.toolMin, frames));
}

