import type { Span } from "../replay.ts";
import type { Hunk, Session, Tool } from "../session.ts";
import { cellWidth, truncate, wrap, wrapText } from "./text.ts";

/** How one agent's TUI prints each kind of session event. */
export interface Theme {
  header(session: Session, width: number): Span[][];
  user(text: string, width: number): Span[][];
  assistant(text: string, width: number): Span[][];
  /** Rows to print, and/or a new label for the working indicator. */
  thinking(text: string, width: number): { rows: Span[][]; label?: string };
  /** Consecutive tools in the same group share one header (Codex folds reads and searches into "Explored"). */
  group(tool: Tool): string | undefined;
  /** `head` starts with the status dot and is empty when the tool continues the previous group. */
  tool(tool: Tool, ok: boolean, continuing: boolean, width: number): { head: Span[][]; body: Span[][] };
  notice(text: string, width: number): Span[][];
  verb(turn: number): string;
}

export function box(rows: Span[][], width: number, tone: Span[1], title?: string): Span[][] {
  const inner = width - 2;
  const top = title ? `─── ${title} ${"─".repeat(Math.max(0, inner - cellWidth(title) - 5))}` : "─".repeat(inner);
  return [
    [[`╭${top}╮`, tone]],
    ...rows.map((row): Span[] => {
      const used = cellWidth(row.map((span) => span[0]).join(""));
      return [["│ ", tone], ...row, [" ".repeat(Math.max(0, inner - 2 - used))], [" │", tone]];
    }),
    [[`╰${"─".repeat(inner)}╯`, tone]],
  ];
}

/** Keeps the first `max` rows and turns the rest into a "… +N lines" row. */
export function cap(rows: Span[][], max: number, more: (hidden: number) => Span[]): Span[][] {
  if (rows.length <= max) return rows;
  return [...rows.slice(0, max), more(rows.length - max)];
}

export function capHead(rows: Span[][], max: number): Span[][] {
  if (rows.length <= max) return rows;
  const kept = rows.slice(0, max);
  kept[max - 1] = [...kept[max - 1]!, ["…", "dim"]];
  return kept;
}

/** Output lines under a tool call. Each row gets `first`/`rest` prefixes. */
export function outputRows(text: string, width: number, first: Span[], rest: Span[], tone: Span[1] = "dim"): Span[][] {
  const lines = text.split("\n");
  return lines.flatMap((line, i) => wrapText(truncate(line, width * 2), width, tone, i === 0 ? first : rest, rest).slice(0, 2));
}

export function diffRows(hunks: Hunk[], width: number, indent: string): Span[][] {
  const rows: Span[][] = [];
  for (const [index, hunk] of hunks.entries()) {
    if (index > 0) rows.push([[`${indent}  ⋮`, "dim"]]);
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    for (const line of hunk.lines) {
      const sign = line[0] ?? " ";
      const number = sign === "-" ? oldLine++ : newLine++;
      if (sign === " ") oldLine++;
      const gutter = `${indent}${String(number).padStart(5)} ${sign === " " ? " " : sign} `;
      const tone = sign === "+" ? "add" : sign === "-" ? "del" : undefined;
      const room = width - cellWidth(gutter);
      const text = truncate(line.slice(1), room);
      // Changed lines are padded so their background spans the full row.
      rows.push(tone ? [[gutter, tone], [text + " ".repeat(Math.max(0, room - cellWidth(text))), tone]] : [[gutter, "num"], [text]]);
    }
  }
  return rows;
}

export function oneLine(text: string): string {
  return text.split("\n").find((line) => line.trim()) ?? "";
}

export function rowsOf(spans: Span[], width: number, first: Span[] = [], rest: Span[] = first): Span[][] {
  return wrap(spans, width, first, rest);
}

export function toolName(name: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return `${mcp[1]} - ${mcp[2]} (MCP)`;
  return name;
}
