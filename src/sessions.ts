import { Database } from "bun:sqlite";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseSession } from "./parse/index.ts";
import { parseOpencode, type OpencodeMeta, type OpencodeRow } from "./parse/opencode.ts";
import type { Agent, Session } from "./session.ts";

export interface SessionFile {
  agent: Agent;
  /** A .jsonl transcript, or OpenCode's SQLite database. */
  path: string;
  /** The session id inside OpenCode's database. */
  id?: string;
  mtime: number;
  size: number;
}

const ROOTS: { agent: Agent; dir: string; pattern: string }[] = [
  { agent: "claude", dir: join(homedir(), ".claude", "projects"), pattern: "*/*.jsonl" },
  { agent: "codex", dir: join(homedir(), ".codex", "sessions"), pattern: "**/rollout-*.jsonl" },
];

const OPENCODE_DB = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode", "opencode.db");

/** Every local Claude Code, Codex and OpenCode session, newest first. */
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
  if (!agent || agent === "opencode") found.push(...opencodeSessions());
  return found.sort((a, b) => b.mtime - a.mtime);
}

/** Accepts a path, a session id (or part of one), `latest`, or `latest:<agent>`. */
export async function resolveSession(query: string): Promise<SessionFile> {
  // `readSession` detects the agent of a transcript from its content.
  if (await Bun.file(query).exists()) return { agent: "claude", path: query, mtime: 0, size: 0 };
  const latest = /^latest(?::(claude|codex|opencode))?$/.exec(query);
  const sessions = await findSessions(latest?.[1] as Agent | undefined);
  const match = latest ? sessions[0] : sessions.find((session) => (session.id ?? session.path).includes(query));
  if (!match) throw new Error(`No session matches "${query}". Run \`agent-replay list\` to see local sessions.`);
  return match;
}

export async function readSession(file: SessionFile): Promise<Session> {
  if (!file.id) return parseSession(await Bun.file(file.path).text());
  return withOpencode(file.path, (db) => {
    const meta = db.query<OpencodeMeta, [string]>("select title, directory, version from session_v2 where id = ?").get(file.id!);
    if (!meta) throw new Error(`OpenCode session ${file.id} not found`);
    const rows = db.query<OpencodeRow, [string]>("select type, data from session_message where session_id = ? order by seq").all(file.id!);
    return parseOpencode(meta, rows);
  });
}

/** Cheap summary for `list`: reads only the first and last 64 KB of each transcript. */
export async function describe(file: SessionFile): Promise<{ cwd: string; title: string }> {
  if (file.id) {
    const row = withOpencode(file.path, (db) =>
      db.query<{ title: string | null; directory: string }, [string]>("select title, directory from session_v2 where id = ?").get(file.id!),
    );
    return { cwd: (row?.directory ?? "").replace(homedir(), "~"), title: row?.title ?? "" };
  }
  const blob = Bun.file(file.path);
  const head = await blob.slice(0, 65536).text();
  const tail = file.size > 65536 ? await blob.slice(file.size - 65536).text() : head;
  const cwd = /"cwd":"([^"]+)"/.exec(head)?.[1] ?? "";
  const titles = [...tail.matchAll(/"aiTitle":"([^"]+)"/g)];
  const title = titles[titles.length - 1]?.[1] ?? "";
  return { cwd: cwd.replace(homedir(), "~"), title };
}

/** Top-level OpenCode sessions. Subagent sessions are left out, like in OpenCode's own list. */
function opencodeSessions(): SessionFile[] {
  try {
    return withOpencode(OPENCODE_DB, (db) =>
      db
        .query<{ id: string; time_updated: number; size: number }, []>(
          `select s.id, s.time_updated, coalesce(sum(length(m.data)), 0) as size
           from session_v2 s left join session_message m on m.session_id = s.id
           where s.parent_id is null group by s.id`,
        )
        .all()
        .map((row) => ({ agent: "opencode" as const, path: OPENCODE_DB, id: row.id, mtime: row.time_updated, size: row.size })),
    );
  } catch {
    // OpenCode not installed, or an older version without this schema.
    return [];
  }
}

function withOpencode<T>(path: string, read: (db: Database) => T): T {
  const db = new Database(path, { readonly: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
}
