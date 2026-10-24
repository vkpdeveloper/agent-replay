import { FORMATS, FPS, type Caption, type Format, type Line, type Prompt, type Replay, type Span, type Status } from "../replay.ts";
import type { Session, SessionEvent } from "../session.ts";
import { claude } from "./claude.ts";
import { codex } from "./codex.ts";
import { opencode } from "./opencode.ts";
import { fitRow } from "./text.ts";
import type { Theme } from "./theme.ts";

/** A highlight: steps `from` through `to` (1-based, inclusive, as printed by `outline`). */
export interface Cut {
  from: number;
  to: number;
  caption?: string;
}

export interface LayoutOptions {
  /** Playback speed multiplier. 2 plays twice as fast. */
  speed?: number;
  /** Inclusive 1-based range of user turns to keep. */
  turns?: [number, number];
  format?: Format;
  /** Only these steps play, plus the prompt of every turn they touch. */
  cuts?: Cut[];
  /** Text for an opening title card. */
  title?: string;
}

const themes: Record<Session["agent"], Theme> = { claude, codex, opencode };

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
  skip: 12,
};
/** Title card length. Not scaled by `speed`, so the title stays readable. */
const CARD_FRAMES = 60;

const PASTE_CHARS = 220;

export function layout(session: Session, options: LayoutOptions = {}): Replay {
  const theme = themes[session.agent];
  const speed = options.speed ?? 1;
  const format = FORMATS[options.format ?? "landscape"];
  const width = format.cols - 2;
  const cuts = options.cuts ?? [];
  const events = session.events;
  const turnOf = turnNumbers(events);
  const kept = keptSteps(events, turnOf, options);
  const turnEndAt = lastTimes(events, turnOf);
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
  // Some agents print a summary row when a turn finishes.
  let shownTurn = 0;
  const endTurn = () => {
    if (!shownTurn || !theme.turnEnd) return;
    emit(theme.turnEnd(elapsed(turnEndAt[shownTurn] ?? turnStart), session.model, width), 1);
    lines.push({ at: frame(), s: [] });
    shownTurn = 0;
  };

  for (const s of theme.header(session, width)) lines.push({ at: 0, s: fitRow(s, format.cols) });
  const card = options.title ? { text: options.title, to: CARD_FRAMES } : undefined;
  if (card) t += CARD_FRAMES;
  wait(PACE.intro);

  /** First and last frame each cut is on screen. */
  const cutFrames: { from: number; to: number }[] = [];
  let skipped = 0;
  let group: string | undefined;

  for (const [index, event] of events.entries()) {
    const turn = turnOf[index]!;
    if (!kept[index]) {
      if (prompts.length > 0) skipped++;
      continue;
    }
    if (skipped > 0 && cuts.length > 0) {
      // Mark the gap so a highlight never pretends steps happened back to back.
      emit([[["  ⋯ ", "dim"], [`${skipped} ${skipped === 1 ? "step" : "steps"} later`, "i"]]], 1);
      lines.push({ at: frame(), s: [] });
      wait(PACE.skip);
      group = undefined;
    }
    skipped = 0;
    if (event.type !== "tool") group = undefined;
    const cut = cuts.findIndex((c) => index + 1 >= c.from && index + 1 <= c.to);
    const startFrame = frame();

    step(event, turn);

    if (cut >= 0) {
      const span = cutFrames[cut];
      cutFrames[cut] = { from: span?.from ?? startFrame, to: frame() };
    }
  }

  function step(event: SessionEvent, turn: number) {
    switch (event.type) {
      case "user": {
        endTurn();
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
        prompts.push({ from, typed, to: frame(), text, ...(paste ? { paste: theme.paste(text) } : {}) });
        emit(theme.user(text, width), 0, { bg: "user" });
        lines.push({ at: frame(), s: [] });
        turnStart = event.at;
        turnVerb = theme.verb(turn);
        shownTurn = turn;
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

  endTurn();
  closeStatus(turnEndAt[shownTurn] ?? events[events.length - 1]?.at ?? 0);
  wait(PACE.outro);
  // Trailing blank rows would scroll content away during the outro.
  while (lines.length && lines[lines.length - 1]!.s.length === 0) lines.pop();
  const durationInFrames = Math.max(1, frame());

  return {
    agent: session.agent,
    title: session.title,
    cwd: session.cwd,
    model: session.model,
    version: session.version,
    fps: FPS,
    ...format,
    durationInFrames,
    lines,
    prompts,
    status,
    captions: captions(cuts, cutFrames, durationInFrames),
    ...(card ? { card } : {}),
  };
}

/** The user turn each event belongs to; 0 before the first prompt. */
function turnNumbers(events: SessionEvent[]): number[] {
  let turn = 0;
  return events.map((event) => (event.type === "user" ? ++turn : turn));
}

/** When each turn's last event finished, for the turn summary and the working timer. */
function lastTimes(events: SessionEvent[], turnOf: number[]): number[] {
  const last: number[] = [];
  events.forEach((event, i) => {
    const end = event.type === "tool" ? event.at + event.ms : event.at;
    last[turnOf[i]!] = Math.max(last[turnOf[i]!] ?? 0, end);
  });
  return last;
}

function keptSteps(events: SessionEvent[], turnOf: number[], options: LayoutOptions): boolean[] {
  const [first, last] = options.turns ?? [1, Infinity];
  const inTurns = events.map((_, i) => turnOf[i]! >= first && turnOf[i]! <= last);
  const cuts = options.cuts ?? [];
  if (cuts.length === 0) return inTurns;
  const inCut = events.map((_, i) => inTurns[i]! && cuts.some((cut) => i + 1 >= cut.from && i + 1 <= cut.to));
  // Every highlight keeps the prompt it answers.
  const touched = new Set(turnOf.filter((_, i) => inCut[i]));
  return events.map((event, i) => inCut[i]! || (event.type === "user" && inTurns[i]! && touched.has(turnOf[i]!)));
}

/** Each caption stays up until the next cut starts, the last one until the end. */
function captions(cuts: Cut[], frames: { from: number; to: number }[], duration: number): Caption[] {
  const shown = cuts
    .flatMap((cut, i) => (cut.caption?.trim() && frames[i] ? [{ text: cut.caption.trim(), from: frames[i].from }] : []))
    .sort((a, b) => a.from - b.from);
  return shown.map((caption, i) => ({ ...caption, to: shown[i + 1]?.from ?? duration, index: i + 1, count: shown.length }));
}

/** A tool's spinner time grows with the log of its real duration. */
function toolFrames(ms: number): number {
  const frames = PACE.toolMin + 5 * Math.log2(1 + ms / 250);
  return Math.min(PACE.toolMax, Math.max(PACE.toolMin, frames));
}
