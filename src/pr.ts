import type { Cut } from "./layout/index.ts";
import { outline } from "./outline.ts";
import { AGENT_NAMES, type Session } from "./session.ts";

// `agent-replay pr` adds a "How this was made" section to a GitHub pull request.
// The GIF and MP4 are committed to an orphan `agent-replay` branch through the
// GitHub API, so the local checkout is never touched. Links point at the commit,
// not the branch, so a re-run never shows a stale cached GIF.

const BRANCH = "agent-replay";
const START = "<!-- agent-replay -->";
const END = "<!-- /agent-replay -->";
// PR bodies are capped at 65,536 characters; leave room for the author's text.
const STEPS_BUDGET = 20_000;

export interface PullRequest {
  url: string;
  number: number;
  body: string;
  /** owner/name of the repository the PR's branch lives in. */
  repo: string;
}

/** The PR for `query` (a number, URL or branch), or for the current branch. */
export async function findPr(query?: string): Promise<PullRequest> {
  const fields = "url,number,body,headRepository,headRepositoryOwner";
  const pr = JSON.parse(await gh(["pr", "view", ...(query ? [query] : []), "--json", fields])) as {
    url: string;
    number: number;
    body: string;
    headRepository: { name: string };
    headRepositoryOwner: { login: string };
  };
  return { url: pr.url, number: pr.number, body: pr.body, repo: `${pr.headRepositoryOwner.login}/${pr.headRepository.name}` };
}

/** Commits `files` (repo path to local path) to the replay branch and returns the commit sha. */
export async function publish(repo: string, files: Record<string, string>, message: string): Promise<string> {
  const parent = await branchHead(repo);
  const tree = await Promise.all(
    Object.entries(files).map(async ([path, local]) => {
      const content = Buffer.from(await Bun.file(local).arrayBuffer()).toString("base64");
      const blob = await api<{ sha: string }>(`repos/${repo}/git/blobs`, { content, encoding: "base64" });
      return { path, mode: "100644", type: "blob", sha: blob.sha };
    }),
  );
  const base = parent ? (await api<{ tree: { sha: string } }>(`repos/${repo}/git/commits/${parent}`)).tree.sha : undefined;
  const { sha: treeSha } = await api<{ sha: string }>(`repos/${repo}/git/trees`, { tree, ...(base ? { base_tree: base } : {}) });
  const commit = await api<{ sha: string }>(`repos/${repo}/git/commits`, { message, tree: treeSha, parents: parent ? [parent] : [] });
  if (parent) await api(`repos/${repo}/git/refs/heads/${BRANCH}`, { sha: commit.sha }, "PATCH");
  else await api(`repos/${repo}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: commit.sha });
  return commit.sha;
}

/**
 * The markdown section linking the replay, with the steps in a collapsed list.
 * With cuts, only the cut steps are listed, so the PR shows no more than the video.
 */
export function section(session: Session, gif: string, mp4: string, cuts?: Cut[]): string {
  const inCuts = (step: number) => !cuts?.length || cuts.some((cut) => step >= cut.from && step <= cut.to);
  const events = session.events.filter((_, i) => inCuts(i + 1));
  const failed = events.filter((event) => event.type === "tool" && !event.ok).length;
  const first = events[0]?.at ?? 0;
  const last = events[events.length - 1]?.at ?? first;
  const facts = [
    AGENT_NAMES[session.agent],
    session.model,
    `${events.length} steps`,
    failed && `${failed} failed`,
    last > first && duration((last - first) / 1000),
  ].filter(Boolean);

  // Drop the outline's own header line; the facts line above replaces it.
  // Turn headings and blank lines go too when only some steps are listed.
  const lines = outline(session)
    .split("\n")
    .slice(2)
    .filter((line) => !cuts?.length || inCuts(Number(/^\s*(\d+)/.exec(line)?.[1])));
  const steps: string[] = [];
  let used = 0;
  for (const [i, line] of lines.entries()) {
    used += line.length + 1;
    if (used > STEPS_BUDGET) {
      steps.push(`… ${lines.length - i} more lines`);
      break;
    }
    steps.push(line);
  }

  return [
    START,
    "### How this was made",
    "",
    `![Replay of the ${AGENT_NAMES[session.agent]} session that made this PR](${gif})`,
    "",
    `${facts.join(" · ")} · [download MP4](${mp4})`,
    "",
    "<details><summary>Steps</summary>",
    "",
    "````text",
    ...steps,
    "````",
    "",
    "</details>",
    END,
  ].join("\n");
}

/** Replaces the replay section in `body`, or appends one, so re-runs never stack. */
export function withSection(body: string, replay: string): string {
  const start = body.indexOf(START);
  const end = body.indexOf(END, start);
  if (start !== -1 && end !== -1) return body.slice(0, start) + replay + body.slice(end + END.length);
  return body.trim() ? `${body.trimEnd()}\n\n${replay}\n` : `${replay}\n`;
}

export async function setBody(pr: PullRequest, body: string): Promise<void> {
  await gh(["pr", "edit", pr.url, "--body-file", "-"], body);
}

async function branchHead(repo: string): Promise<string | undefined> {
  try {
    return (await api<{ object: { sha: string } }>(`repos/${repo}/git/ref/heads/${BRANCH}`)).object.sha;
  } catch (error) {
    if (error instanceof Error && /HTTP 404/.test(error.message)) return undefined;
    throw error;
  }
}

async function api<T>(path: string, body?: object, method = body ? "POST" : "GET"): Promise<T> {
  const args = ["api", path, "--method", method, ...(body ? ["--input", "-"] : [])];
  return JSON.parse(await gh(args, body && JSON.stringify(body))) as T;
}

async function gh(args: string[], input?: string): Promise<string> {
  let proc;
  try {
    proc = Bun.spawn(["gh", ...args], { stdin: input === undefined ? "ignore" : new Blob([input]), stdout: "pipe", stderr: "pipe" });
  } catch {
    throw new Error("`agent-replay pr` needs the GitHub CLI (https://cli.github.com), signed in with `gh auth login`.");
  }
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")}: ${err.trim()}`);
  return out;
}

function duration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
