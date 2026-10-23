import { addedFile, clip, parseUnifiedDiff, type Session, type Tool } from "../session.ts";
import { jsonLines, shortArgs, time } from "./util.ts";

// Codex writes ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl. The
// `event_msg/item_completed` records carry the structured thread items the TUI
// itself renders, so we read those and ignore the raw model I/O.

interface CodexRecord {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    cwd?: string;
    cli_version?: string;
    model?: string;
    effort?: string;
    item?: CodexItem;
  };
}

type CodexItem =
  | { type: "UserMessage"; content: { type: string; text?: string }[] }
  | { type: "AgentMessage"; content: { type: string; text?: string }[] }
  | { type: "Reasoning"; summary_text?: string[] }
  | {
      type: "CommandExecution";
      command: string[] | string;
      parsed_cmd?: { type: string; cmd?: string; query?: string | null; path?: string | null; name?: string }[];
      aggregated_output?: string;
      exit_code?: number | null;
      duration?: { secs: number; nanos: number } | null;
    }
  | { type: "FileChange"; changes: Record<string, { type: string; content?: string; unified_diff?: string }> }
  | {
      type: "McpToolCall";
      server: string;
      tool: string;
      arguments?: unknown;
      result?: { content?: { type: string; text?: string }[]; isError?: boolean } | null;
      error?: { message?: string } | null;
      duration?: { secs: number; nanos: number } | null;
    }
  | { type: "ContextCompaction" }
  | { type: "ImageView"; path?: string };

// Instructions Codex injects as user messages. They are not things the user typed.
const INJECTED = /^(# AGENTS\.md instructions|<environment_context>|<user_instructions>|<INSTRUCTIONS>|<turn_aborted>|<skill>)/;

export function parseCodex(text: string): Session {
  const session: Session = { agent: "codex", title: "", cwd: "", model: "", version: "", events: [] };
  const events = session.events;

  for (const record of jsonLines<CodexRecord>(text)) {
    const payload = record.payload;
    if (!payload) continue;
    if (record.type === "session_meta") {
      session.cwd = payload.cwd ?? session.cwd;
      session.version = payload.cli_version ?? session.version;
      continue;
    }
    if (record.type === "turn_context") {
      if (payload.model) session.model = [payload.model, payload.effort].filter(Boolean).join(" ");
      continue;
    }
    const item = payload.type === "item_completed" ? payload.item : undefined;
    if (!item) continue;
    const at = time(record.timestamp);

    switch (item.type) {
      case "UserMessage": {
        const text = joinText(item.content);
        if (!text || INJECTED.test(text)) break;
        session.title ||= text.split("\n")[0]?.slice(0, 80) ?? "";
        events.push({ type: "user", at, text });
        break;
      }
      case "AgentMessage": {
        const text = joinText(item.content);
        if (text) events.push({ type: "assistant", at, text });
        break;
      }
      case "Reasoning": {
        const text = (item.summary_text ?? []).join("\n\n").trim();
        if (text) events.push({ type: "thinking", at, text });
        break;
      }
      case "CommandExecution": {
        const ms = durationMs(item.duration);
        const ok = item.exit_code === 0 || item.exit_code === undefined;
        for (const tool of commandTools(item)) events.push({ type: "tool", at: at - ms, ms, ok, tool });
        break;
      }
      case "FileChange":
        for (const [path, change] of Object.entries(item.changes)) {
          const mode = change.type === "add" ? "create" : change.type === "delete" ? "delete" : "update";
          const diff =
            mode === "create" ? addedFile(change.content ?? "") : parseUnifiedDiff(change.unified_diff ?? "");
          events.push({ type: "tool", at, ms: 0, ok: true, tool: { kind: "edit", path, mode, ...diff } });
        }
        break;
      case "McpToolCall": {
        const ms = durationMs(item.duration);
        const output = item.error?.message ?? joinText(item.result?.content ?? []);
        events.push({
          type: "tool",
          at: at - ms,
          ms,
          ok: !item.error && !item.result?.isError,
          tool: { kind: "generic", name: `${item.server}.${item.tool}`, args: shortArgs(item.arguments), output: clip(output) },
        });
        break;
      }
      case "ContextCompaction":
        events.push({ type: "notice", at, text: "Context compacted" });
        break;
      case "ImageView":
        events.push({
          type: "tool",
          at,
          ms: 0,
          ok: true,
          tool: { kind: "generic", name: "view_image", args: item.path ?? "", output: clip("") },
        });
        break;
    }
  }
  return session;
}

function joinText(content: { type: string; text?: string }[]): string {
  return content
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
}

function durationMs(duration: { secs: number; nanos: number } | null | undefined): number {
  return duration ? duration.secs * 1000 + Math.round(duration.nanos / 1e6) : 0;
}

/** Codex shows read-only commands as "Explored" steps and everything else as "Ran". */
function commandTools(item: Extract<CodexItem, { type: "CommandExecution" }>): Tool[] {
  const parsed = item.parsed_cmd ?? [];
  const exploring = parsed.length > 0 && parsed.every((cmd) => ["read", "search", "list_files"].includes(cmd.type));
  if (exploring) {
    return parsed.map((cmd): Tool => {
      if (cmd.type === "read") return { kind: "read", path: cmd.name ?? cmd.path ?? cmd.cmd ?? "", lines: 0 };
      if (cmd.type === "search") return { kind: "search", query: cmd.query ?? "", path: cmd.path ?? "", output: clip("") };
      return { kind: "list", path: cmd.path ?? "." };
    });
  }
  const argv = Array.isArray(item.command) ? item.command : [item.command];
  // ["/bin/zsh", "-lc", "<script>"] -> "<script>"
  const command = argv.length === 3 && /sh$/.test(argv[0] ?? "") && argv[1]?.startsWith("-") ? argv[2]! : argv.join(" ");
  return [{ kind: "shell", command, output: clip(item.aggregated_output ?? "") }];
}
