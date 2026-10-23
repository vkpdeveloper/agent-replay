// Agent-neutral model of a coding session. Parsers produce it, the layout
// turns it into terminal lines. Outputs are already clipped (see `clip`) so a
// 60 MB transcript never turns into a 60 MB replay.

export type Agent = "claude" | "codex";

export interface Session {
  agent: Agent;
  title: string;
  cwd: string;
  model: string;
  version: string;
  events: SessionEvent[];
}

export type SessionEvent =
  | { type: "user"; at: number; text: string }
  | { type: "assistant"; at: number; text: string }
  | { type: "thinking"; at: number; text: string }
  | { type: "notice"; at: number; text: string }
  | { type: "tool"; at: number; ms: number; ok: boolean; tool: Tool };

export type Tool =
  | { kind: "shell"; command: string; output: Clip }
  | { kind: "read"; path: string; lines: number }
  | { kind: "search"; query: string; path: string; output: Clip }
  | { kind: "list"; path: string }
  | ({ kind: "edit"; path: string; mode: "create" | "update" | "delete" } & Diff)
  | { kind: "todo"; items: TodoItem[] }
  | { kind: "generic"; name: string; args: string; output: Clip };

export interface Clip {
  text: string;
  /** Line count of the original, unclipped output. */
  lines: number;
}

export interface Hunk {
  oldStart: number;
  newStart: number;
  /** Unified diff body lines, each prefixed with " ", "-" or "+". */
  lines: string[];
}

export interface Diff {
  hunks: Hunk[];
  added: number;
  removed: number;
}

export interface TodoItem {
  text: string;
  status: "pending" | "in_progress" | "completed";
}

const CLIP_LINES = 40;
const CLIP_WIDTH = 400;

export function clip(raw: string): Clip {
  const all = stripAnsi(raw).replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  const lines = all.length === 1 && all[0] === "" ? 0 : all.length;
  const text = all
    .slice(0, CLIP_LINES)
    .map((line) => (line.length > CLIP_WIDTH ? line.slice(0, CLIP_WIDTH) : line))
    .join("\n");
  return { text, lines };
}

export function clipLines(lines: string[]): string[] {
  return lines.slice(0, CLIP_LINES * 2).map((line) => stripAnsi(line).slice(0, CLIP_WIDTH));
}

export function stripAnsi(text: string): string {
  // CSI/OSC sequences, then any remaining C0 control except tab and newline.
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

export function parseUnifiedDiff(diff: string): Diff {
  const hunks: Hunk[] = [];
  let current: Hunk | undefined;
  for (const line of diff.split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      current = { oldStart: Number(header[1]), newStart: Number(header[2]), lines: [] };
      hunks.push(current);
    } else if (current && /^[ +-]/.test(line) && !/^(---|\+\+\+) /.test(line)) {
      current.lines.push(line);
    }
  }
  return clipDiff(hunks);
}

export function addedFile(content: string): Diff {
  const lines = content.replace(/\n$/, "").split("\n");
  return clipDiff([{ oldStart: 0, newStart: 1, lines: lines.map((line) => `+${line}`) }]);
}

/** Counts additions and removals on the full diff, then clips each hunk. */
export function clipDiff(hunks: Hunk[]): Diff {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line[0] === "+") added++;
      else if (line[0] === "-") removed++;
    }
  }
  return { hunks: hunks.slice(0, 8).map((hunk) => ({ ...hunk, lines: clipLines(hunk.lines) })), added, removed };
}
