/**
 * How a comment body becomes something on screen: plain text, line breaks,
 * http(s) links, and highlighted @-mentions. Nothing else.
 *
 * ## Why this is a segmenter and not markdown
 *
 * A comment is text one person typed for another, and the reader must see
 * exactly what was typed. Markdown would turn `*` and `_` in a formula into
 * formatting, and HTML is out of the question: a comment is the one string on
 * the product that any member of a workspace can put in front of every other
 * member, which makes it the natural place to try to run script in a
 * colleague's session. So the renderer never interprets markup at all. It cuts
 * the body into segments, and `comment-body.ts` turns each segment into a React
 * text node, a `<br>`, a `<span>` or an `<a>`. React escapes every text node,
 * and there is no path from a body to a raw-HTML sink (the complete list of
 * those is `html-injection-surface.test.ts`, and this file is not on it).
 *
 * ## Links
 *
 * Only `http://` and `https://` become links, and only when `URL` parses them
 * with one of those two protocols. That is what keeps `javascript:`,
 * `data:` and `vbscript:` URLs inert text: they are never matched in the first
 * place, rather than matched and then filtered.
 *
 * ## Mentions
 *
 * The token rule mirrors `services/api/src/majorana_api/mentions.py` so the
 * highlight lands on the same words the server resolved. Only a token that
 * matches a handle the SERVER returned for this comment is highlighted; a
 * token that resolved to nobody stays plain text, so the page never suggests
 * that a message reached someone it did not.
 */

export type CommentSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "mention"; text: string; handle: string }
  | { kind: "break" };

/** Everything up to whitespace or a character that cannot appear unescaped in a URL. */
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;

/** Same shape as `MENTION_TOKEN` in services/api/src/majorana_api/mentions.py. */
const MENTION_PATTERN = /(?<![A-Za-z0-9._+\-@/])@([A-Za-z0-9._+-]+(?:@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)?)/g;

/** Punctuation that ends a sentence, not a URL: `see https://example.org.` */
const TRAILING_URL_PUNCTUATION = /[.,;:!?]+$/;

/**
 * The URL a matched run of characters should link to, or null.
 *
 * A closing bracket is kept only when the URL also contains the opening one,
 * which is the Wikipedia case, `https://en.wikipedia.org/wiki/Qubit_(physics)`;
 * otherwise `(see https://example.org)` would link a stray `)`.
 */
export function linkTarget(raw: string): { text: string; href: string } | null {
  let text = raw.replace(TRAILING_URL_PUNCTUATION, "");
  while (text.endsWith(")") && (text.match(/\(/g)?.length ?? 0) < (text.match(/\)/g)?.length ?? 0)) {
    text = text.slice(0, -1).replace(TRAILING_URL_PUNCTUATION, "");
  }
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;
  return { text, href: parsed.href };
}

function mentionSegments(text: string, handles: ReadonlySet<string>): CommentSegment[] {
  const out: CommentSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const token = match[1].replace(/\.+$/, "");
    const handle = token.toLowerCase();
    if (!token || !handles.has(handle)) continue;
    const start = match.index ?? 0;
    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    out.push({ kind: "mention", text: `@${token}`, handle });
    last = start + 1 + token.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

function lineSegments(line: string, handles: ReadonlySet<string>): CommentSegment[] {
  const out: CommentSegment[] = [];
  let last = 0;
  for (const match of line.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const target = linkTarget(match[0]);
    if (!target) continue;
    if (start > last) out.push(...mentionSegments(line.slice(last, start), handles));
    out.push({ kind: "link", text: target.text, href: target.href });
    last = start + target.text.length;
  }
  if (last < line.length) out.push(...mentionSegments(line.slice(last), handles));
  return out;
}

/**
 * Cut `body` into segments. `mentionHandles` is the list of handles the server
 * resolved for this comment; only those are highlighted.
 */
export function commentSegments(body: string, mentionHandles: readonly string[] = []): CommentSegment[] {
  const handles = new Set(mentionHandles.map((handle) => handle.toLowerCase()));
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const out: CommentSegment[] = [];
  lines.forEach((line, index) => {
    if (index > 0) out.push({ kind: "break" });
    out.push(...lineSegments(line, handles));
  });
  // Adjacent text segments are merged so the renderer emits one text node per run.
  return out.reduce<CommentSegment[]>((merged, segment) => {
    const previous = merged[merged.length - 1];
    if (segment.kind === "text" && previous?.kind === "text") {
      merged[merged.length - 1] = { kind: "text", text: previous.text + segment.text };
    } else if (segment.kind !== "text" || segment.text) {
      merged.push(segment);
    }
    return merged;
  }, []);
}
