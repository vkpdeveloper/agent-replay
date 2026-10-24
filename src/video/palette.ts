import type { Tone } from "../replay.ts";
import type { Agent } from "../session.ts";

export interface ToneStyle {
  color: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
}

export interface Palette {
  /** Colours of the 135deg backdrop gradient, at 0%, 55% and 100%. */
  backdrop: [string, string, string];
  window: string;
  titlebar: string;
  border: string;
  fg: string;
  dim: string;
  acc: string;
  shimmer: string;
  userBg: string;
  inputBg: string;
  tones: Record<Tone, ToneStyle>;
}

function palette(base: {
  backdrop: [string, string, string];
  fg: string;
  dim: string;
  acc: string;
  shimmer: string;
  code: string;
  userBg: string;
  inputBg: string;
  window?: string;
  titlebar?: string;
  add?: ToneStyle;
  del?: ToneStyle;
}): Palette {
  return {
    window: "#131313",
    titlebar: "#1c1c1c",
    border: "#2c2c2c",
    ...base,
    tones: {
      fg: { color: base.fg },
      dim: { color: base.dim },
      b: { color: base.fg, bold: true },
      i: { color: base.dim, italic: true },
      acc: { color: base.acc },
      ok: { color: "#4eba65" },
      err: { color: "#ff6b80" },
      warn: { color: "#e5c07b" },
      add: base.add ?? { color: "#e6f4e8", bg: "#1f4a2a" },
      del: base.del ?? { color: "#f7e4e6", bg: "#5c2229" },
      code: { color: base.code },
      num: { color: "#5f5f5f" },
    },
  };
}

export const palettes: Record<Agent, Palette> = {
  claude: palette({
    backdrop: ["#3a2219", "#120d0b", "#0a0a0a"],
    fg: "#ebe9e6",
    dim: "#8f8b87",
    acc: "#d97757",
    shimmer: "#ffb59a",
    code: "#b1b9f9",
    userBg: "#262626",
    inputBg: "#131313",
  }),
  codex: palette({
    backdrop: ["#10263a", "#0b1017", "#0a0a0a"],
    fg: "#e6e8eb",
    dim: "#8b9097",
    acc: "#5fc7f0",
    shimmer: "#ffffff",
    code: "#8fd3f7",
    userBg: "#24272d",
    inputBg: "#24272d",
  }),
  // OpenCode's default dark theme. `acc` is the Build agent's colour.
  opencode: palette({
    backdrop: ["#1b2436", "#0d0f14", "#0a0a0a"],
    fg: "#eeeeee",
    dim: "#808080",
    acc: "#5c9cf5",
    shimmer: "#fab283",
    code: "#fab283",
    userBg: "#141414",
    inputBg: "#141414",
    window: "#0a0a0a",
    titlebar: "#161616",
    add: { color: "#4fd6be", bg: "#20303b" },
    del: { color: "#e06c75", bg: "#37222c" },
  }),
};

export const MONO = '"SF Mono", Menlo, Monaco, "JetBrains Mono", "Cascadia Mono", Consolas, monospace';
export const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif';
