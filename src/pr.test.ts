import { expect, test } from "bun:test";
import { section, withSection } from "./pr.ts";
import type { Session } from "./session.ts";

const session: Session = {
  agent: "claude",
  title: "",
  cwd: "~/shop",
  model: "claude-opus-5-5",
  version: "",
  events: [
    { type: "user", at: 0, text: "ship free over $50" },
    { type: "tool", at: 2_000, ms: 900, ok: false, tool: { kind: "shell", command: "bun test", output: { text: "1 fail", lines: 1 } } },
    { type: "assistant", at: 75_000, text: "Done, 4 pass." },
  ],
};

test("section links the GIF and MP4 and sums up the session", () => {
  const md = section(session, "https://x/replay.gif", "https://x/replay.mp4");
  expect(md).toContain("![Replay of the Claude Code session that made this PR](https://x/replay.gif)");
  expect(md).toContain("Claude Code · claude-opus-5-5 · 3 steps · 1 failed · 1m 15s · [download MP4](https://x/replay.mp4)");
  expect(md).toContain("    2 ✗ shell  bun test  → 1 fail");
});

test("with cuts, section lists only the cut steps", () => {
  const md = section(session, "a.gif", "a.mp4", [{ from: 2, to: 2 }]);
  expect(md).toContain("bun test");
  expect(md).not.toContain("ship free over $50");
  expect(md).not.toContain("turn 1");
});

test("withSection replaces an earlier replay instead of stacking a second one", () => {
  const first = withSection("Adds free shipping.", section(session, "a.gif", "a.mp4"));
  expect(first.startsWith("Adds free shipping.\n\n<!-- agent-replay -->")).toBe(true);

  const again = withSection(`${first}\nReviewed.`, section(session, "b.gif", "b.mp4"));
  expect(again).toContain("b.gif");
  expect(again).not.toContain("a.gif");
  expect(again.match(/<!-- agent-replay -->/g)).toHaveLength(1);
  expect(again.endsWith("Reviewed.")).toBe(true);
  expect(withSection("", "X")).toBe("X\n");
});
