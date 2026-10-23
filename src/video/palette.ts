import type { CSSProperties } from "react";
import type { Tone } from "../replay.ts";
import type { Agent } from "../session.ts";

export interface Palette {
  backdrop: string;
  window: string;
  titlebar: string;
  border: string;
  fg: string;
  dim: string;
  acc: string;
  shimmer: string;
  userBg: string;
  inputBg: string;
  tones: Record<Tone, CSSProperties>;
}

function palette(base: {
  backdrop: string;
  fg: string;
  dim: string;
  acc: string;
  shimmer: string;
  code: string;
  userBg: string;
  inputBg: string;
}): Palette {
  return {
    window: "#131313",
    titlebar: "#1c1c1c",
    border: "#2c2c2c",
    ...base,
    tones: {
      fg: { color: base.fg },
      dim: { color: base.dim },
      b: { color: base.fg, fontWeight: 700 },
      i: { color: base.dim, fontStyle: "italic" },
      acc: { color: base.acc },
      ok: { color: "#4eba65" },
      err: { color: "#ff6b80" },
      warn: { color: "#e5c07b" },
      add: { color: "#e6f4e8", backgroundColor: "#1f4a2a" },
      del: { color: "#f7e4e6", backgroundColor: "#5c2229" },
      code: { color: base.code },
      num: { color: "#5f5f5f" },
    },
  };
}

export const palettes: Record<Agent, Palette> = {
  claude: palette({
    backdrop: "linear-gradient(135deg, #3a2219 0%, #120d0b 55%, #0a0a0a 100%)",
    fg: "#ebe9e6",
    dim: "#8f8b87",
    acc: "#d97757",
    shimmer: "#ffb59a",
    code: "#b1b9f9",
    userBg: "#262626",
    inputBg: "#131313",
  }),
  codex: palette({
    backdrop: "linear-gradient(135deg, #10263a 0%, #0b1017 55%, #0a0a0a 100%)",
    fg: "#e6e8eb",
    dim: "#8b9097",
    acc: "#5fc7f0",
    shimmer: "#ffffff",
    code: "#8fd3f7",
    userBg: "#24272d",
    inputBg: "#24272d",
  }),
};

export const MONO = '"SF Mono", Menlo, Monaco, "JetBrains Mono", "Cascadia Mono", Consolas, monospace';
export const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif';
