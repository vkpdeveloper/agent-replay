import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Agent } from "./session.ts";

export interface SessionFile {
  path: string;
  agent: Agent;
  mtime: number;
  size: number;
}

const ROOTS: { agent: Agent; dir: string; pattern: string }[] = [
  { agent: "claude", dir: join(homedir(), ".claude", "projects"), pattern: "*/*.jsonl" },
  { agent: "codex", dir: join(homedir(), ".codex", "sessions"), pattern: "**/rollout-*.jsonl" },
];

/** Every local Claude Code and Codex session, newest first. */
export async function findSessions(agent?: Agent): Promise<SessionFile[]> {
  const found: SessionFile[] = [];
  for (const root of ROOTS) {
    if (agent && root.agent !== agent) continue;
    try {
      for await (const path of new Bun.Glob(root.pattern).scan({ cwd: root.dir, absolute: true })) {
        const info = await stat(path);
        found.push({ path, agent: root.agent, mtime: info.mtimeMs, size: info.size });
      }
    } catch {
      // Agent not installed.
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime);
}

/** Accepts a path, a session id (or prefix), `latest`, `latest:claude` or `latest:codex`. */
export async function resolveSession(query: string): Promise<string> {
  if (await Bun.file(query).exists()) return query;
  const latest = /^latest(?::(claude|codex))?$/.exec(query);
  const sessions = await findSessions(latest?.[1] as Agent | undefined);
  const match = latest ? sessions[0] : sessions.find((session) => session.path.includes(query));
  if (!match) throw new Error(`No session matches "${query}". Run \`agent-replay list\` to see local sessions.`);
  return match.path;
}

/** Cheap summary for `list`: reads only the first and last 64 KB of each file. */
export async function describe(file: SessionFile): Promise<{ cwd: string; title: string }> {
  const blob = Bun.file(file.path);
  const head = await blob.slice(0, 65536).text();
  const tail = file.size > 65536 ? await blob.slice(file.size - 65536).text() : head;
  const cwd = /"cwd":"([^"]+)"/.exec(head)?.[1] ?? "";
  const titles = [...tail.matchAll(/"aiTitle":"([^"]+)"/g)];
  const title = titles[titles.length - 1]?.[1] ?? "";
  return { cwd: cwd.replace(homedir(), "~"), title };
}
