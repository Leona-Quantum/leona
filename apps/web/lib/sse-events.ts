/**
 * Parsing a text/event-stream response body read via `fetch` + a raw
 * `ReadableStream` reader — the shape every SSE follower in this app uses
 * (the run page follows a chat this way; `studio-revise-follow.ts` follows a
 * circuit revision the same way). Extracted from the run page's own
 * `parseEvent`/buffer-splitting so both call the same parser instead of two
 * copies drifting apart; the run page's behavior is unchanged; it now
 * imports these instead of defining them locally.
 */

/** One parsed `data:` field (already joined across multi-line `data:`),
 * and the `id:` field if the block had a numeric one — or null for a
 * comment-only block (every line starts with `:`) or one with no `data:`
 * line at all. */
export function parseSseBlock(block: string): { id: number | null; data: string } | null {
  const lines = block.split("\n");
  if (lines.some((line) => line.startsWith(":"))) return null;
  const idLine = lines.find((line) => line.startsWith("id:"));
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  if (!data) return null;
  const parsedId = idLine ? Number(idLine.slice("id:".length).trim()) : NaN;
  return { id: Number.isFinite(parsedId) ? parsedId : null, data };
}

/** Split a growing decoded-text buffer on the blank line that terminates an
 * SSE event, returning every COMPLETE block and the leftover tail to keep
 * accumulating. Normalizes `\r\n` first, matching how a server actually
 * separates fields — `fetch` gives raw bytes, not framed events. */
export function splitSseBuffer(buffer: string): { blocks: string[]; remainder: string } {
  const normalized = buffer.replaceAll("\r\n", "\n");
  const blocks = normalized.split("\n\n");
  const remainder = blocks.pop() ?? "";
  return { blocks, remainder };
}
