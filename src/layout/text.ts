import type { Span, Tone } from "../replay.ts";

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u;

export function cellWidth(text: string): number {
  let width = 0;
  for (const char of text) width += char.length > 1 || WIDE.test(char) ? 2 : 1;
  return width;
}

function sliceCells(text: string, cells: number): [string, string] {
  let width = 0;
  let index = 0;
  for (const char of text) {
    const w = char.length > 1 || WIDE.test(char) ? 2 : 1;
    if (width + w > cells) break;
    width += w;
    index += char.length;
  }
  return [text.slice(0, index), text.slice(index)];
}

export function truncate(text: string, cells: number): string {
  if (cellWidth(text) <= cells) return text;
  return `${sliceCells(text, cells - 1)[0]}…`;
}

/**
 * Word-wraps one logical line of spans to `width` cells. `first` prefixes the
 * first row and `rest` every continuation row, like a terminal hanging indent.
 */
export function wrap(spans: Span[], width: number, first: Span[] = [], rest: Span[] = first): Span[][] {
  const rows: Span[][] = [];
  // Prefix tuples are copied because `append` extends the last span in place.
  const copy = (prefix: Span[]) => prefix.map((span): Span => [...span]);
  let row = copy(first);
  let used = cellWidth(first.map((span) => span[0]).join(""));
  const restWidth = cellWidth(rest.map((span) => span[0]).join(""));

  const pushRow = () => {
    rows.push(row);
    row = copy(rest);
    used = restWidth;
  };
  const append = (text: string, tone: Tone | undefined) => {
    const last = row[row.length - 1];
    if (last && last[1] === tone) last[0] += text;
    else row.push(tone ? [text, tone] : [text]);
    used += cellWidth(text);
  };

  for (const [text, tone] of spans) {
    for (const piece of text.split(/(\s+)/)) {
      if (!piece) continue;
      const w = cellWidth(piece);
      if (/^\s+$/.test(piece)) {
        // Drop whitespace that would start a continuation row.
        if (used === restWidth && rows.length > 0) continue;
        if (used + w > width) pushRow();
        else append(piece, tone);
        continue;
      }
      if (used + w > width && used > restWidth) pushRow();
      let word = piece;
      while (used + cellWidth(word) > width) {
        const [head, tail] = sliceCells(word, Math.max(1, width - used));
        append(head, tone);
        pushRow();
        word = tail;
      }
      if (word) append(word, tone);
    }
  }
  if (row.length > 0 || rows.length === 0) rows.push(row);
  return rows;
}

/** Wraps multi-line plain text, one tone for every row. */
export function wrapText(text: string, width: number, tone: Tone | undefined, first: Span[] = [], rest: Span[] = first): Span[][] {
  return text.split("\n").flatMap((line, i) => wrap([[expandTabs(line), ...(tone ? [tone] : [])] as Span], width, i === 0 ? first : rest, rest));
}

export function expandTabs(text: string): string {
  return text.replace(/\t/g, "    ");
}

export interface MarkdownLine {
  spans: Span[];
  /** Cells continuation rows indent by, so wrapped list items hang under their text. */
  hang: number;
}

/**
 * Just enough Markdown for agent replies: headings, lists, bold, inline code,
 * links and fenced code. Returns logical lines; wrapping happens afterwards.
 */
export function markdown(text: string): MarkdownLine[] {
  const out: MarkdownLine[] = [];
  let fenced = false;
  for (const raw of text.split("\n")) {
    const line = expandTabs(raw);
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      out.push({ spans: [[line, "code"]], hang: 0 });
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      out.push({ spans: inline(heading[1] ?? "").map(([t, tone]): Span => [t, tone === "code" ? "code" : "b"]), hang: 0 });
      continue;
    }
    const marker = /^\s*(?:[-*+]|\d+[.)])\s+/.exec(line)?.[0] ?? /^\s*/.exec(line)?.[0] ?? "";
    out.push({ spans: inline(line), hang: marker.length });
  }
  return out;
}

/** Wraps Markdown under a first-row prefix such as "● ", indenting continuation rows by `indent` cells. */
export function wrapMarkdown(text: string, width: number, prefix: Span, indent: number): Span[][] {
  return markdown(text).flatMap(({ spans, hang }, i) =>
    wrap(spans, width, i === 0 ? [prefix] : [[" ".repeat(indent)]], [[" ".repeat(indent + hang)]]),
  );
}

function inline(line: string): Span[] {
  const spans: Span[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    if (match.index > last) spans.push([line.slice(last, match.index)]);
    if (match[1] !== undefined) spans.push([match[1], "code"]);
    else if (match[2] !== undefined) spans.push([match[2], "b"]);
    else if (match[3] !== undefined) spans.push([match[3], "acc"]);
    last = match.index + match[0].length;
  }
  if (last < line.length) spans.push([line.slice(last)]);
  return spans.length ? spans : [[""]];
}
