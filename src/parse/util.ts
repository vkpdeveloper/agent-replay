/** Parses JSONL, skipping blank and malformed lines (sessions are often still being written). */
export function* jsonLines<T>(text: string): Generator<T> {
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    if (end > start) {
      try {
        yield JSON.parse(text.slice(start, end)) as T;
      } catch {
        // Partial trailing line.
      }
    }
    start = end + 1;
  }
}

export function time(timestamp: string | undefined): number {
  return timestamp ? Date.parse(timestamp) : 0;
}

/** One-line summary of tool arguments, the way agent TUIs print them. */
export function shortArgs(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const values = Object.values(input);
  const first = values.find((value) => typeof value === "string");
  if (values.length === 1 && typeof first === "string") return first.split("\n")[0] ?? "";
  const json = JSON.stringify(input);
  return json === "{}" ? "" : json;
}
