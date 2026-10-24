import type { Agent } from "./session.ts";

// The data the video component plays. Everything is pre-wrapped to a fixed
// terminal grid and stamped with the frame it appears on, so rendering a frame
// is two binary searches and a few dozen rows of text.

export type Tone =
  | "fg"
  | "dim"
  | "b"
  | "i"
  | "acc"
  | "ok"
  | "err"
  | "warn"
  | "add"
  | "del"
  | "code"
  | "num";

export type Span = [text: string, tone?: Tone];

export interface Line {
  /** Frame on which the line appears. Non-decreasing across `Replay.lines`. */
  at: number;
  s: Span[];
  bg?: "user" | "add" | "del";
  /** Tool header: the first span is a status dot that blinks until `done`, then turns green or red. */
  dot?: [done: number, ok: 0 | 1];
}

/** Text typed into the input box from `from` until `typed`, then submitted (cleared) at `to`. */
export interface Prompt {
  from: number;
  typed: number;
  to: number;
  text: string;
  /** Long prompts are shown as a paste placeholder instead of typed out. */
  paste?: string;
}

/** The "working" indicator above the input box. */
export interface Status {
  from: number;
  to: number;
  label: string;
  /** Real seconds since the turn started, at `from` and at `to`. The counter interpolates between them. */
  s0: number;
  s1: number;
}

/** A highlight cut's caption, shown over the transcript while its steps play. */
export interface Caption {
  from: number;
  to: number;
  text: string;
  /** 1-based position among the cuts, shown as "2/4". */
  index: number;
  count: number;
}

export interface Replay {
  agent: Agent;
  title: string;
  cwd: string;
  model: string;
  version: string;
  fps: number;
  width: number;
  height: number;
  cols: number;
  rows: number;
  durationInFrames: number;
  lines: Line[];
  prompts: Prompt[];
  status: Status[];
  captions: Caption[];
  /** Title card shown over the opening frames, fading out at `to`. */
  card?: { text: string; to: number };
}

export const COMPOSITION_ID = "Replay";
export const FPS = 30;
/** Rows under the transcript: status, gap, input box (3) and footer. */
export const CHROME_ROWS = 6;

export type Format = "landscape" | "vertical" | "square";

/**
 * Frame size and terminal grid per format. Narrower grids mean a bigger font,
 * so vertical and square stay readable on a phone. Rows fill the window at the
 * font size the renderer derives from `cols`.
 */
export const FORMATS: Record<Format, { width: number; height: number; cols: number; rows: number }> = {
  landscape: { width: 1920, height: 1080, cols: 120, rows: 32 },
  vertical: { width: 1080, height: 1920, cols: 50, rows: 50 },
  square: { width: 1080, height: 1080, cols: 60, rows: 31 },
};
