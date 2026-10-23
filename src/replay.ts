import type { Agent } from "./session.ts";

// The data the video component plays. Everything is pre-wrapped to a fixed
// terminal grid and stamped with the frame it appears on, so rendering a frame
// is two binary searches and ~30 rows of DOM.

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

export interface Replay {
  agent: Agent;
  title: string;
  cwd: string;
  model: string;
  version: string;
  fps: number;
  cols: number;
  rows: number;
  durationInFrames: number;
  lines: Line[];
  prompts: Prompt[];
  status: Status[];
}

export const COMPOSITION_ID = "Replay";
export const FPS = 30;
export const COLS = 120;
export const ROWS = 32;
/** Rows under the transcript: status, gap, input box (3) and footer. */
export const CHROME_ROWS = 6;
export const WIDTH = 1920;
export const HEIGHT = 1080;
