import { expect, test } from "bun:test";
import { parseSession } from "../parse/index.ts";
import { parseOpencode } from "../parse/opencode.ts";
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
    expect(cellWidth(text(line))).toBeLessThanOrEqual(replay.cols);
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

const opencodeRows = [
  { type: "user", data: { time: { created: 1000 }, text: "add discount codes" } },
  {
    type: "assistant",
    data: {
      time: { created: 1100 },
      model: { id: "glm-5.3-flash" },
      content: [
        { type: "reasoning", text: "Explore repo structure.", time: { created: 1200 } },
        { type: "tool", name: "read", time: { created: 1300, completed: 1310 }, state: { status: "completed", input: { path: "src/price.ts" }, content: [{ type: "text", text: "Read file src/price.ts, lines 1-16\n1: export" }] } },
        {
          type: "tool",
          name: "edit",
          time: { created: 1400, completed: 1500 },
          state: {
            status: "completed",
            input: { path: "src/price.ts" },
            metadata: { files: [{ file: "src/price.ts", status: "modified", patch: "--- src/price.ts\n+++ src/price.ts\n@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;\n keep" }] },
          },
        },
        { type: "tool", name: "shell", time: { created: 1600, completed: 3600 }, state: { status: "completed", input: { command: "bun test" }, content: [{ type: "text", text: "2 fail" }], metadata: { exit: 1 } } },
        { type: "text", text: "Tests fail on rounding, fixing it." },
      ],
    },
  },
  { type: "idle", data: { time: { created: 9000 }, outcome: "succeeded" } },
].map((row) => ({ type: row.type, data: JSON.stringify(row.data) }));

const opencodeSession = () => parseOpencode({ title: "Discount codes", directory: "/repo", version: "2.1.2" }, opencodeRows);

test("opencode: parts become events, file patches become diffs, a non-zero exit fails the tool", () => {
  const session = opencodeSession();
  expect(session.model).toBe("glm-5.3-flash");
  expect(session.events.map((event) => event.type)).toEqual(["user", "thinking", "tool", "tool", "tool", "assistant"]);
  const [read, edit, shell] = session.events.filter((event) => event.type === "tool");
  expect(read?.tool).toEqual({ kind: "read", path: "src/price.ts", lines: 16 });
  expect(edit?.tool).toMatchObject({ kind: "edit", mode: "update", added: 1, removed: 1 });
  expect(shell?.ok).toBe(false);

  const rows = layout(session).lines.map(text);
  expect(rows).toContain("   → Read src/price.ts");
  expect(rows).toContain("   $ bun test");
  expect(rows.some((row) => row.startsWith("   ▣  Build · glm-5.3-flash · "))).toBe(true);
});

test("cuts keep their steps and the prompt, mark the gap, and caption each highlight", () => {
  const replay = layout(opencodeSession(), { cuts: [{ from: 3, to: 3, caption: "Reads the code" }, { from: 6, to: 6, caption: "Finds the bug" }], title: "GLM adds discount codes" });
  const rows = replay.lines.map(text);
  expect(rows.some((row) => row.startsWith("┃  add discount codes"))).toBe(true);
  expect(rows).toContain("   → Read src/price.ts");
  expect(rows).not.toContain("   $ bun test");
  expect(rows.filter((row) => row.includes("later"))).toEqual(["  ⋯ 1 step later", "  ⋯ 2 steps later"]);
  expect(replay.captions.map(({ text, index, count }) => [text, index, count])).toEqual([
    ["Reads the code", 1, 2],
    ["Finds the bug", 2, 2],
  ]);
  expect(replay.captions[0]!.to).toBe(replay.captions[1]!.from);
  expect(replay.card?.to).toBeLessThanOrEqual(replay.captions[0]!.from);
});

test("vertical and square formats wrap to their own grid", () => {
  for (const format of ["vertical", "square"] as const) {
    const replay = layout(parseSession(claudeSession), { format });
    expect(replay.height).toBeGreaterThanOrEqual(replay.width);
    for (const line of replay.lines) expect(cellWidth(text(line))).toBeLessThanOrEqual(replay.cols);
  }
});
