import type { Session, SessionEvent } from "./session.ts";
import { AGENT_NAMES } from "./session.ts";

// `agent-replay outline` prints every step of a session on one numbered line,
// so an agent can pick highlights and pass them back as `--cut` ranges.

const WIDTH = 110;

export function outline(session: Session): string {
  const failed = session.events.filter((event) => event.type === "tool" && !event.ok).length;
  const out = [
    [AGENT_NAMES[session.agent], session.model, session.title && `"${session.title}"`, `${session.events.length} steps`, failed && `${failed} failed`]
      .filter(Boolean)
      .join(" · "),
  ];
  let turn = 0;
  for (const [i, event] of session.events.entries()) {
    if (event.type === "user") out.push("", `turn ${++turn}`);
    const [kind, text] = describeStep(event);
    const mark = event.type === "tool" && !event.ok ? "✗" : " ";
    out.push(clip(`${String(i + 1).padStart(5)} ${mark} ${kind.padEnd(6)} ${text}`));
  }
  return out.join("\n");
}

function describeStep(event: SessionEvent): [string, string] {
  switch (event.type) {
    case "user":
      return ["user", firstLine(event.text)];
    case "assistant":
      return ["say", firstLine(event.text)];
    case "thinking":
      return ["think", firstLine(event.text).replace(/\*\*/g, "")];
    case "notice":
      return ["notice", event.text];
  }
  const { tool } = event;
  switch (tool.kind) {
    case "shell": {
      const last = tool.output.text.split("\n").filter((line) => line.trim()).pop()?.trim();
      return ["shell", `${firstLine(tool.command)}${last ? `  → ${last}` : ""}`];
    }
    case "read":
      return ["read", tool.path];
    case "search":
      return ["search", `${tool.query}${tool.path ? ` in ${tool.path}` : ""}  → ${tool.output.lines} matches`];
    case "list":
      return ["list", tool.path];
    case "edit":
      return ["edit", `${tool.path} ${tool.mode === "update" ? "" : `(${tool.mode}) `}+${tool.added} -${tool.removed}`];
    case "todo": {
      const done = tool.items.filter((item) => item.status === "completed").length;
      return ["todo", `${done}/${tool.items.length} done`];
    }
    case "generic":
      return ["tool", `${tool.name} ${tool.args}`.trim()];
  }
}

function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim())?.trim() ?? "";
}

function clip(line: string): string {
  return line.length > WIDTH ? `${line.slice(0, WIDTH - 1)}…` : line;
}
