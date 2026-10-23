import { expect, test } from "bun:test";
import { parseSession } from "../parse/index.ts";
import { COLS } from "../replay.ts";
import { layout } from "./index.ts";
import { cellWidth } from "./text.ts";

const claudeSession = [
  { type: "user", timestamp: "2026-10-01T10:00:00Z", cwd: "/repo", version: "2.1.0", message: { content: "fix the failing test" } },
  {
    type: "assistant",
    timestamp: "2026-10-01T10:00:02Z",
    message: { model: "claude-opus-5-5", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "bun test" } }] },
  },
  {
    type: "user",
    timestamp: "2026-10-01T10:00:09Z",
    message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "1 fail", is_error: true }] },
    toolUseResult: { stdout: "1 fail\nexpected 2, got 3", stderr: "" },
  },
  {
    type: "assistant",
    timestamp: "2026-10-01T10:00:12Z",
    message: { content: [{ type: "text", text: `Fixed. ${"The off-by-one was in the reducer. ".repeat(8)}` }] },
  },
]
  .map((record) => JSON.stringify(record))
  .join("\n");

const codexSession = [
  { type: "session_meta", payload: { cwd: "/repo", cli_version: "0.160.0" } },
  { type: "turn_context", payload: { model: "gpt-6.1-sol", effort: "high" } },
  { type: "event_msg", timestamp: "2026-10-01T10:00:00Z", payload: { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text: "where is auth?" }] } } },
  ...["src/auth.ts", "src/db.ts"].map((path) => ({
    type: "event_msg",
    timestamp: "2026-10-01T10:00:01Z",
    payload: { type: "item_completed", item: { type: "CommandExecution", command: ["/bin/zsh", "-lc", `cat ${path}`], parsed_cmd: [{ type: "read", name: path }], exit_code: 0 } },
  })),
]
  .map((record) => JSON.stringify(record))
  .join("\n");

const text = (row: { s: [string, string?][] }) => row.s.map((span) => span[0]).join("");

test("claude: tool results attach to their call and every row fits the grid in frame order", () => {
  const replay = layout(parseSession(claudeSession));
  const rows = replay.lines.map(text);

  expect(rows.some((row) => row.startsWith("● Bash(bun test)"))).toBe(true);
  expect(rows.some((row) => row.includes("⎿  1 fail"))).toBe(true);
  expect(replay.lines.find((line) => line.dot)?.dot?.[1]).toBe(0);

  for (const [i, line] of replay.lines.entries()) {
    expect(cellWidth(text(line))).toBeLessThanOrEqual(COLS);
    if (i > 0) expect(line.at).toBeGreaterThanOrEqual(replay.lines[i - 1]!.at);
  }
  expect(replay.prompts[0]?.text).toBe("fix the failing test");
  expect(replay.durationInFrames).toBeGreaterThan(replay.lines.at(-1)!.at);
});

test("codex: consecutive reads fold into one Explored block", () => {
  const rows = layout(parseSession(codexSession)).lines.map(text);
  expect(rows.filter((row) => row.includes("Explored"))).toHaveLength(1);
  expect(rows.filter((row) => /Read (auth|db)\.ts/.test(row))).toHaveLength(2);
});
