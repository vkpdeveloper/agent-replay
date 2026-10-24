import type { Span } from "../replay.ts";
import { wrapMarkdown, wrapText } from "./text.ts";
import { box, cap, capHead, diffRows, oneLine, outputRows, rowsOf, type Theme } from "./theme.ts";

const BULLET: Span = ["• ", "dim"];
const TREE: Span[] = [["  └ ", "dim"]];
const INDENT: Span[] = [["    "]];
const more = (hidden: number): Span[] => [[`    … +${hidden} lines`, "dim"]];

export const codex: Theme = {
  header(session, width) {
    return [
      ...box(
        [
          [[">_ ", "dim"], ["OpenAI Codex", "b"], [session.version ? ` (v${session.version})` : "", "dim"]],
          [],
          [["model:     ", "dim"], [session.model || "gpt"], ["   /model to change", "acc"]],
          [["directory: ", "dim"], [session.cwd]],
        ],
        Math.min(width, 64),
        "dim",
      ),
      [],
      [["  To get started, describe a task or try one of these commands:", "dim"]],
      [],
      [["  /init", "b"], [" - create an AGENTS.md file with instructions for Codex", "dim"]],
      [["  /status", "b"], [" - show current session configuration", "dim"]],
      [["  /model", "b"], [" - choose what model and reasoning effort to use", "dim"]],
      [],
    ];
  },

  user(text, width) {
    return cap(wrapText(text, width, "fg", [["› ", "b"]], [["  "]]), 12, (hidden) => [[`  … +${hidden} lines`, "dim"]]);
  },

  assistant(text, width) {
    return wrapMarkdown(text, width, BULLET, 2);
  },

  thinking(text) {
    // Codex shows the reasoning summary's bold title in the working indicator, not the transcript.
    const title = /\*\*(.+?)\*\*/.exec(text)?.[1] ?? oneLine(text).slice(0, 60);
    return { rows: [], label: title };
  },

  group: (tool) => (tool.kind === "read" || tool.kind === "search" || tool.kind === "list" ? "explore" : undefined),

  tool(tool, ok, continuing, width) {
    const dot: Span = ["• ", ok ? "ok" : "err"];
    const output = (text: string, lines: number): Span[][] => {
      if (!lines) return [[...TREE, ["(no output)", "dim"]]];
      const rows = outputRows(text, width, TREE, INDENT, ok ? "dim" : "err");
      const shown = rows.slice(0, 4);
      const hidden = Math.max(0, lines - text.split("\n").length) + rows.length - shown.length;
      return hidden > 0 ? [...shown, more(hidden)] : shown;
    };

    switch (tool.kind) {
      case "read":
      case "search":
      case "list": {
        const step: Span[] =
          tool.kind === "read"
            ? [["Read ", "acc"], [tool.path.split("/").pop() ?? tool.path]]
            : tool.kind === "search"
              ? [["Search ", "acc"], [tool.query], ...(tool.path ? ([[" in ", "dim"], [tool.path]] as Span[]) : [])]
              : [["List ", "acc"], [tool.path]];
        return {
          head: continuing ? [] : [[dot, ["Explored", "b"]]],
          body: rowsOf(step, width, continuing ? INDENT : TREE, INDENT).slice(0, 2),
        };
      }
      case "shell": {
        const lines = tool.command.split("\n");
        const head = capHead(rowsOf([["Ran ", "b"], [lines[0] ?? ""]], width, [dot], [["  │ ", "dim"]]), 2);
        const cont = lines.slice(1, 3).map((line): Span[] => [["  │ ", "dim"], [line.slice(0, width - 4)]]);
        return { head: [...head, ...cont], body: output(tool.output.text, tool.output.lines) };
      }
      case "edit": {
        const verb = tool.mode === "create" ? "Added" : tool.mode === "delete" ? "Deleted" : "Edited";
        const head: Span[] = [dot, [`${verb} `, "b"], [tool.path], [" ("], [`+${tool.added}`, "ok"], [" "], [`-${tool.removed}`, "err"], [")"]];
        return { head: [head], body: cap(diffRows(tool.hunks, width, "  "), 14, more) };
      }
      case "todo":
        return {
          head: [[dot, ["Updated Plan", "b"]]],
          body: tool.items.map((item, i): Span[] => [
            ...(i === 0 ? TREE : INDENT),
            item.status === "completed" ? ["✔ " + item.text, "dim"] : item.status === "in_progress" ? ["□ " + item.text, "acc"] : ["□ " + item.text],
          ]),
        };
      case "generic": {
        const head = capHead(rowsOf([["Called ", "b"], [tool.name, "acc"], [`(${tool.args})`, "dim"]], width, [dot], INDENT), 2);
        return { head, body: tool.output.lines ? output(tool.output.text, tool.output.lines) : [] };
      }
    }
  },

  notice(text) {
    return [[["■ ", "err"], [text, "dim"]]];
  },

  verb: () => "Working",

  paste: (text) => `[Pasted Content ${text.length} chars]`,
};
