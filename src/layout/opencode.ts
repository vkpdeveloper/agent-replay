import type { Span } from "../replay.ts";
import { wrapMarkdown, wrapText } from "./text.ts";
import { cap, capHead, diffRows, oneLine, outputRows, rowsOf, toolName, type Theme } from "./theme.ts";

// OpenCode's TUI: user messages on a panel behind a coloured bar, tools as
// one-line "→ Read" rows or blocks with a body, and a "▣ Build · model · time"
// row when a turn finishes.

const PAD: Span = ["   "];
const BAR: Span[] = [["┃  ", "acc"]];
const OUT: Span[] = [["     "]];
const more = (hidden: number): Span[] => [[`     … +${hidden} lines`, "dim"]];

const LOGO = [
  ["█▀▀█ █▀▀█ █▀▀ █▀▀▄", "█▀▀ █▀▀█ █▀▀▄ █▀▀"],
  ["█  █ █  █ █▀▀ █  █", "█   █  █ █  █ █▀▀"],
  ["▀▀▀▀ █▀▀▀ ▀▀▀ ▀  ▀", "▀▀▀ ▀▀▀▀ ▀▀▀  ▀▀▀"],
];

export const opencode: Theme = {
  header(session) {
    return [
      [],
      ...LOGO.map(([open, code]): Span[] => [PAD, [open!, "dim"], [" "], [code!, "b"]]),
      ...(session.version ? [[PAD, [`v${session.version}`.padStart(36), "dim"]] as Span[]] : []),
      [],
      [PAD, [session.cwd, "dim"]],
      [],
    ];
  },

  user(text, width) {
    const rows = cap(wrapText(text, width, "fg", BAR, BAR), 12, (hidden) => [...BAR, [`… +${hidden} lines`, "dim"]]);
    return [[["┃", "acc"]], ...rows, [["┃", "acc"]]];
  },

  assistant(text, width) {
    return wrapMarkdown(text, width, PAD, 3);
  },

  thinking(text, width) {
    const rows = rowsOf([["Thinking: ", "i"], [oneLine(text).replace(/\*\*/g, ""), "i"]], width, [PAD], [PAD]);
    return { rows: capHead(rows, 2) };
  },

  // One-line tools stack without blank rows between them.
  group: (tool) => (tool.kind === "read" || tool.kind === "search" || tool.kind === "list" ? "inline" : undefined),

  tool(tool, ok, _continuing, width) {
    const line = (spans: Span[]) => capHead(rowsOf(spans, width, [PAD], OUT), 2);
    const output = (text: string, lines: number): Span[][] => {
      if (!lines) return [];
      const rows = outputRows(text, width, OUT, OUT, ok ? "dim" : "err");
      const shown = rows.slice(0, 5);
      const hidden = Math.max(0, lines - text.split("\n").length) + rows.length - shown.length;
      return hidden > 0 ? [...shown, more(hidden)] : shown;
    };

    switch (tool.kind) {
      case "read":
        return { head: line([["→ Read ", "dim"], [tool.path]]), body: [] };
      case "list":
        return { head: line([["→ List ", "dim"], [tool.path]]), body: [] };
      case "search": {
        const count = tool.output.lines;
        const where: Span[] = tool.path ? [[" in ", "dim"], [tool.path]] : [];
        return {
          head: line([["✱ Search ", "dim"], [`"${tool.query}"`], ...where, [` (${count} ${count === 1 ? "match" : "matches"})`, "dim"]]),
          body: [],
        };
      }
      case "shell": {
        const head = capHead(rowsOf([["$ ", "dim"], [oneLine(tool.command)]], width, [PAD], OUT), 3);
        return { head, body: output(tool.output.text, tool.output.lines) };
      }
      case "edit": {
        if (tool.mode === "delete") return { head: line([["← Delete ", "dim"], [tool.path]]), body: [] };
        if (tool.mode === "create") {
          const preview = tool.hunks[0]?.lines.slice(0, 8) ?? [];
          const rows = preview.map((text, i): Span[] => [[`${String(i + 1).padStart(6)}  `, "num"], [text.slice(1).slice(0, width - 8)]]);
          const hidden = tool.added - preview.length;
          return { head: line([["← Write ", "dim"], [tool.path]]), body: [...rows, ...(hidden > 0 ? [more(hidden)] : [])] };
        }
        return {
          head: line([["← Edit ", "dim"], [tool.path], [` +${tool.added}`, "ok"], [` -${tool.removed}`, "err"]]),
          body: cap(diffRows(tool.hunks, width, " "), 14, more),
        };
      }
      case "todo":
        return {
          head: [[PAD, ["# ", "dim"], ["Todos", "b"]]],
          body: tool.items.map((item): Span[] =>
            item.status === "completed"
              ? [PAD, ["[✓] " + item.text, "dim"]]
              : item.status === "in_progress"
                ? [PAD, ["[•] " + item.text, "warn"]]
                : [PAD, ["[ ] " + item.text]],
          ),
        };
      case "generic":
        return {
          head: line([["⚙ ", "dim"], [toolName(tool.name)], ...(tool.args ? ([[` ${tool.args}`, "dim"]] as Span[]) : [])]),
          body: output(tool.output.text, tool.output.lines),
        };
    }
  },

  notice(text) {
    return [[PAD, ["■ ", "err"], [text, "dim"]]];
  },

  verb: () => "Working",

  paste: (text) => `[Pasted ~${text.split("\n").length} lines]`,

  turnEnd(seconds, model) {
    const time = seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    return [[PAD, ["▣  ", "acc"], ["Build", "fg"], [` · ${model} · ${time}`, "dim"]]];
  },
};
