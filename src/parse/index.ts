import type { Session } from "../session.ts";
import { parseClaude } from "./claude.ts";
import { parseCodex } from "./codex.ts";

export function parseSession(text: string): Session {
  // Codex rollouts open with a session_meta record; Claude transcripts never do.
  const head = text.slice(0, 4096);
  return /"type"\s*:\s*"session_meta"/.test(head) ? parseCodex(text) : parseClaude(text);
}
