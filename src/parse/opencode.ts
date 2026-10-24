import { addedFile, clip, parseUnifiedDiff, type Session, type SessionEvent, type TodoItem, type Tool } from "../session.ts";
import { shortArgs } from "./util.ts";

// OpenCode keeps sessions in SQLite (~/.local/share/opencode/opencode.db):
// one `session_v2` row per session and one `session_message` row per user
// message, assistant step or idle marker, with the parts as JSON in `data`.

export interface OpencodeMeta {
  title: string | null;
  directory: string;
  version: string;
}

export interface OpencodeRow {
  type: string;
  data: string;
}

interface Time {
  created?: number;
  completed?: number;
}

type Part =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string; time?: Time }
  | {
      type: "tool";
      name: string;
      time?: Time;
      state: {
        status: string;
        input?: Record<string, unknown>;
        content?: { type: string; text?: string }[];
        error?: unknown;
        metadata?: {
          exit?: number;
          files?: { file: string; patch?: string; status?: string }[];
        };
      };
    };

interface Message {
  time?: Time;
  text?: string;
  model?: { id?: string };
  content?: Part[];
  outcome?: string;
}

export function parseOpencode(meta: OpencodeMeta, rows: OpencodeRow[]): Session {
  const session: Session = { agent: "opencode", title: meta.title ?? "", cwd: meta.directory, model: "", version: meta.version, events: [] };
  const events = session.events;

  for (const row of rows) {
    let message: Message;
    try {
      message = JSON.parse(row.data) as Message;
    } catch {
      continue;
    }
    const at = message.time?.created ?? 0;
    if (row.type === "user") {
      if (message.text?.trim()) events.push({ type: "user", at, text: message.text });
      continue;
    }
    if (row.type === "idle") {
      if (message.outcome && message.outcome !== "succeeded") events.push({ type: "notice", at, text: capitalise(message.outcome) });
      continue;
    }
    if (row.type !== "assistant") continue;
    if (message.model?.id) session.model = message.model.id;
    for (const part of message.content ?? []) {
      if (part.type === "text") {
        if (part.text.trim()) events.push({ type: "assistant", at, text: part.text.trim() });
      } else if (part.type === "reasoning") {
        if (part.text.trim()) events.push({ type: "thinking", at: part.time?.created ?? at, text: part.text });
      } else if (part.type === "tool") {
        events.push(...toolEvents(part, at));
      }
    }
  }
  return session;
}

function toolEvents(part: Extract<Part, { type: "tool" }>, fallback: number): SessionEvent[] {
  const { state } = part;
  const input = state.input ?? {};
  const at = part.time?.created ?? fallback;
  const ms = Math.max(0, (part.time?.completed ?? at) - at);
  const failed = state.status === "error" || (state.metadata?.exit ?? 0) !== 0;
  const text = failed && typeof state.error === "string" ? state.error : (state.content ?? []).map((c) => c.text ?? "").join("\n");
  const event = (tool: Tool): SessionEvent => ({ type: "tool", at, ms, ok: !failed, tool });
  const str = (key: string) => (typeof input[key] === "string" ? input[key] : "");

  // File tools report a unified diff per touched file, which is what the TUI shows.
  const files = state.metadata?.files ?? [];
  if (files.length && ["edit", "write", "patch", "apply_patch", "multiedit"].includes(part.name)) {
    return files.map((file) => {
      const mode = file.status === "added" ? "create" : file.status === "deleted" ? "delete" : "update";
      return event({ kind: "edit", path: file.file, mode, ...parseUnifiedDiff(file.patch ?? "") });
    });
  }

  switch (part.name) {
    case "shell":
    case "bash":
      return [event({ kind: "shell", command: str("command"), output: clip(text) })];
    case "read": {
      const range = /lines (\d+)-(\d+)/.exec(text);
      const lines = range ? Number(range[2]) - Number(range[1]) + 1 : Math.max(0, text.split("\n").length - 1);
      return [event({ kind: "read", path: str("path") || str("filePath"), lines })];
    }
    case "write":
      return [event({ kind: "edit", path: str("path") || str("filePath"), mode: "create", ...addedFile(str("content")) })];
    case "glob":
    case "grep":
      return [event({ kind: "search", query: str("pattern"), path: str("path"), output: clip(text) })];
    case "list":
      return [event({ kind: "list", path: str("path") || "." })];
    case "todowrite":
      return [event({ kind: "todo", items: todos(input.todos) })];
    default:
      return [event({ kind: "generic", name: part.name, args: shortArgs(input), output: clip(text) })];
  }
}

function todos(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: { content?: string; status?: string }) => ({
    text: item.content ?? "",
    status: item.status === "completed" || item.status === "cancelled" ? "completed" : item.status === "in_progress" ? "in_progress" : "pending",
  }));
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
