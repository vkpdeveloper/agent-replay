import type { Span } from "../replay.ts";
import type { Tool } from "../session.ts";
import { wrapMarkdown, wrapText } from "./text.ts";
import { box, cap, capHead, diffRows, oneLine, outputRows, rowsOf, toolName, type Theme } from "./theme.ts";

const DOT: Span = ["● "];
const RESULT: Span[] = [["  ⎿  ", "dim"]];
const INDENT: Span[] = [["     "]];
const more = (hidden: number): Span[] => [[`     … +${hidden} lines `, "dim"], ["(ctrl+o to expand)", "dim"]];

const DISPLAY_NAMES: Record<string, string> = { Agent: "Task", Task: "Task", WebFetch: "Fetch", WebSearch: "Web Search" };

const VERBS = ["Pondering", "Cogitating", "Noodling", "Brewing", "Percolating", "Conjuring", "Synthesizing", "Musing", "Crafting", "Simmering"];

export const claude: Theme = {
  header(session, width) {
    const boxWidth = Math.min(width, 72);
    return [
      ...box(
        [
          [],
          [["✻ ", "acc"], ["Welcome to Claude Code!", "b"]],
          [],
          [["  /help for help, /status for your current setup", "dim"]],
          [],
          [[`  cwd: ${session.cwd}`, "dim"]],
          ...(session.model ? [[[`  model: ${session.model}`, "dim"]] as Span[]] : []),
        ],
        boxWidth,
        "acc",
        session.version ? `Claude Code v${session.version}` : undefined,
      ),
      [],
    ];
  },

  user(text, width) {
    return cap(wrapText(text, width, "fg", [["> ", "dim"]], [["  "]]), 12, (hidden) => [[`  … +${hidden} lines`, "dim"]]);
  },

  assistant(text, width) {
    return wrapMarkdown(text, width, DOT, 2);
  },

  thinking(text, width) {
    const rows = wrapText(oneLine(text).replace(/\*\*/g, ""), width, "i", [["  "]]);
    return { rows: [[["✻ Thinking…", "i"]], ...capHead(rows, 2)] };
  },

  group: () => undefined,

  tool(tool, ok, _continuing, width) {
    const head = (name: string, args: string) => capHead(rowsOf([[name, "b"], [`(${args})`]], width, [DOT], [["  "]]), 3);
    const output = (text: string, lines: number, tone: Span[1] = "dim"): Span[][] => {
      if (!lines) return [[...RESULT, ["(No content)", "dim"]]];
      const rows = outputRows(text, width, RESULT, INDENT, tone);
      const shown = rows.slice(0, 4);
      const hidden = Math.max(0, lines - text.split("\n").length) + rows.length - shown.length;
      return hidden > 0 ? [...shown, more(hidden)] : shown;
    };
    return render(tool, ok, head, output, width);
  },

  notice(text) {
    if (text === "Interrupted by user") return [[...RESULT, ["Interrupted by user", "err"]]];
    return [[["※ ", "dim"], [text, "dim"], [" (ctrl+o for history)", "dim"]]];
  },

  verb: (turn) => VERBS[turn % VERBS.length]!,
};

function render(
  tool: Tool,
  ok: boolean,
  head: (name: string, args: string) => Span[][],
  output: (text: string, lines: number, tone?: Span[1]) => Span[][],
  width: number,
): { head: Span[][]; body: Span[][] } {
  switch (tool.kind) {
    case "shell":
      return { head: head("Bash", oneLine(tool.command)), body: output(tool.output.text, tool.output.lines, ok ? "dim" : "err") };
    case "read":
      return { head: head("Read", tool.path), body: [[...RESULT, ["Read ", "dim"], [String(tool.lines), "b"], [" lines", "dim"]]] };
    case "search": {
      const args = [`pattern: "${tool.query}"`, tool.path && `path: "${tool.path}"`].filter(Boolean).join(", ");
      const count = tool.output.lines;
      return { head: head("Search", args), body: [[...RESULT, ["Found ", "dim"], [String(count), "b"], [count === 1 ? " file" : " files", "dim"]]] };
    }
    case "list":
      return { head: head("List", tool.path), body: [[...RESULT, ["Listed directory", "dim"]]] };
    case "edit": {
      if (tool.mode === "delete") return { head: head("Delete", tool.path), body: [[...RESULT, ["Deleted", "dim"]]] };
      if (tool.mode === "create") {
        const preview = tool.hunks[0]?.lines.slice(0, 8) ?? [];
        const rows = preview.map((line, i): Span[] => [[`${String(i + 1).padStart(10)} `, "num"], [line.slice(1).slice(0, width - 11)]]);
        const hidden = tool.added - preview.length;
        return {
          head: head("Write", tool.path),
          body: [
            [...RESULT, ["Wrote ", "dim"], [String(tool.added), "b"], [` lines to `, "dim"], [tool.path, "b"]],
            ...rows,
            ...(hidden > 0 ? [more(hidden)] : []),
          ],
        };
      }
      const summary: Span[] = [
        ...RESULT,
        ["Updated ", "dim"],
        [tool.path, "b"],
        [" with ", "dim"],
        [String(tool.added), "b"],
        [tool.added === 1 ? " addition" : " additions", "dim"],
        [" and ", "dim"],
        [String(tool.removed), "b"],
        [tool.removed === 1 ? " removal" : " removals", "dim"],
      ];
      return { head: head("Update", tool.path), body: [summary, ...cap(diffRows(tool.hunks, width, "  "), 14, more)] };
    }
    case "todo":
      return {
        head: [[DOT, ["Update Todos", "b"]]],
        body: tool.items.map((item, i): Span[] => [
          ...(i === 0 ? RESULT : INDENT),
          item.status === "completed"
            ? ["☒ " + item.text, "dim"]
            : item.status === "in_progress"
              ? ["☐ " + item.text, "b"]
              : ["☐ " + item.text],
        ]),
      };
    case "generic": {
      const name = DISPLAY_NAMES[tool.name] ?? toolName(tool.name);
      const body: Span[][] = tool.output.lines ? output(tool.output.text, tool.output.lines, ok ? "dim" : "err") : [[...RESULT, ["Done", "dim"]]];
      return { head: head(name, tool.args), body };
    }
  }
}
