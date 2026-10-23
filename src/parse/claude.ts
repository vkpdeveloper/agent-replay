import { addedFile, clip, clipDiff, type Session, type SessionEvent, type Tool } from "../session.ts";
import { jsonLines, shortArgs, time } from "./util.ts";

// Claude Code writes one JSON record per line to
// ~/.claude/projects/<cwd>/<session>.jsonl. T3 Code's Claude threads use the
// same format. Only the fields we read are typed.

interface ClaudeRecord {
  type?: string;
  timestamp?: string;
  cwd?: string;
  version?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  aiTitle?: string;
  message?: { model?: string; content?: string | Block[] };
  toolUseResult?: ToolUseResult | string;
}

type Block =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content?: string | Block[]; is_error?: boolean }
  | { type: "image" };

interface ToolUseResult {
  type?: string;
  stdout?: string;
  stderr?: string;
  content?: string;
  file?: { numLines?: number; totalLines?: number };
  structuredPatch?: { oldStart: number; newStart: number; lines: string[] }[];
  numFiles?: number;
  filenames?: string[];
}

interface Pending {
  event: Extract<SessionEvent, { type: "tool" }>;
  name: string;
  input: Record<string, unknown>;
}

export function parseClaude(text: string): Session {
  const session: Session = { agent: "claude", title: "", cwd: "", model: "", version: "", events: [] };
  const pending = new Map<string, Pending>();
  const events = session.events;

  for (const record of jsonLines<ClaudeRecord>(text)) {
    if (record.aiTitle) session.title = record.aiTitle;
    if (record.isSidechain) continue;
    if (!session.cwd && record.cwd) session.cwd = record.cwd;
    if (!session.version && record.version) session.version = record.version;
    const at = time(record.timestamp);
    const content = record.message?.content;

    if (record.type === "user" && content !== undefined) {
      if (record.isCompactSummary) {
        events.push({ type: "notice", at, text: "Conversation compacted" });
        continue;
      }
      if (record.isMeta) continue;
      const blocks = typeof content === "string" ? [{ type: "text" as const, text: content }] : content;
      const prompt: string[] = [];
      for (const block of blocks) {
        if (block.type === "text") prompt.push(block.text);
        else if (block.type === "image") prompt.push("[Image]");
        else if (block.type === "tool_result") {
          const call = pending.get(block.tool_use_id);
          if (!call) continue;
          pending.delete(block.tool_use_id);
          const result = typeof record.toolUseResult === "object" ? record.toolUseResult : undefined;
          call.event.ok = !block.is_error;
          call.event.ms = Math.max(0, at - call.event.at);
          call.event.tool = toTool(call.name, call.input, resultText(block.content), result);
        }
      }
      const cleaned = cleanPrompt(prompt.join("\n"));
      if (cleaned === "Interrupted by user") events.push({ type: "notice", at, text: cleaned });
      else if (cleaned) events.push({ type: "user", at, text: cleaned });
      continue;
    }

    if (record.type !== "assistant" || !Array.isArray(content)) continue;
    const model = record.message?.model;
    if (model && model !== "<synthetic>") session.model = model;
    for (const block of content) {
      if (block.type === "text" && block.text.trim()) events.push({ type: "assistant", at, text: block.text.trim() });
      else if (block.type === "thinking" && block.thinking.trim()) {
        events.push({ type: "thinking", at, text: block.thinking.trim() });
      } else if (block.type === "tool_use") {
        const event: Pending["event"] = {
          type: "tool",
          at,
          ms: 0,
          ok: true,
          tool: toTool(block.name, block.input, "", undefined),
        };
        events.push(event);
        pending.set(block.id, { event, name: block.name, input: block.input });
      }
    }
  }
  return session;
}

function resultText(content: string | Block[] | undefined): string {
  if (typeof content === "string") return content;
  if (!content) return "";
  return content.map((block) => (block.type === "text" ? block.text : block.type === "image" ? "[Image]" : "")).join("\n");
}

function cleanPrompt(raw: string): string {
  let text = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
  const command = /<command-name>([\s\S]*?)<\/command-name>/.exec(text);
  if (command) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim();
    return [command[1]?.trim(), args].filter(Boolean).join(" ");
  }
  if (/<local-command-(stdout|stderr)>|^Caveat: /.test(text)) return "";
  if (/^\[Request interrupted by user/.test(text.trim())) return "Interrupted by user";
  text = text.replace(/<\/?[a-z-]+>/g, "");
  return text.trim();
}

const string = (value: unknown) => (typeof value === "string" ? value : "");

function toTool(name: string, input: Record<string, unknown>, output: string, result: ToolUseResult | undefined): Tool {
  switch (name) {
    case "Bash": {
      const out = result?.stdout !== undefined ? [result.stdout, result.stderr].filter(Boolean).join("\n") : output;
      return { kind: "shell", command: string(input.command), output: clip(out) };
    }
    case "Read":
      return {
        kind: "read",
        path: string(input.file_path),
        lines: result?.file?.numLines ?? clip(output).lines,
      };
    case "Edit":
    case "MultiEdit":
    case "Write": {
      const path = string(input.file_path);
      if (result?.structuredPatch?.length) return { kind: "edit", path, mode: "update", ...clipDiff(result.structuredPatch) };
      if (name === "Write") return { kind: "edit", path, mode: "create", ...addedFile(string(input.content)) };
      const edits = name === "MultiEdit" && Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : [input];
      const lines = edits.flatMap((edit) => [
        ...string(edit.old_string).split("\n").map((line) => `-${line}`),
        ...string(edit.new_string).split("\n").map((line) => `+${line}`),
      ]);
      return { kind: "edit", path, mode: "update", ...clipDiff([{ oldStart: 1, newStart: 1, lines }]) };
    }
    case "Grep":
    case "Glob":
      return {
        kind: "search",
        query: string(input.pattern),
        path: string(input.path),
        output: clip(result?.filenames?.join("\n") ?? output),
      };
    case "TodoWrite": {
      const todos = Array.isArray(input.todos) ? (input.todos as Record<string, unknown>[]) : [];
      return {
        kind: "todo",
        items: todos.map((todo) => ({
          text: string(todo.content),
          status: todo.status === "completed" || todo.status === "in_progress" ? todo.status : "pending",
        })),
      };
    }
    default:
      return { kind: "generic", name, args: shortArgs(input), output: clip(output) };
  }
}
