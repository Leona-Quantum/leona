/**
 * Follow a `text/event-stream` response the way the Run page already does
 * (`app/(app)/run/[taskId]/live-run.tsx`): retry with capped exponential
 * backoff, forever, until the caller recognizes a terminal event or `signal`
 * aborts the read. Extracted so the notebook and course progress readers
 * (`use-run-progress.ts`) reconnect the same way instead of a second copy of
 * the same loop — before this module existed, `use-run-progress.ts` gave up
 * and reported the stream "lost" after a single dropped connection, while the
 * Run page's own reader just reconnected and kept going.
 *
 * Block parsing is `lib/sse-events.ts` (`parseSseBlock`/`splitSseBuffer`);
 * this module owns only the fetch/retry/backoff shell around it, same
 * division as that module already documents for its other two callers.
 */
import { parseSseBlock, splitSseBuffer } from "./sse-events.ts";

/** One parsed block, as `lib/sse-events.ts`'s `parseSseBlock` returns it. */
export interface SseBlock {
  id: number | null;
  data: string;
}

export interface ReconnectBackoffOptions {
  /** Delay before the first retry. Default 1000ms, the Run page's own value. */
  baseMs?: number;
  /** Ceiling the doubling never exceeds. Default 10000ms, the Run page's own value. */
  maxMs?: number;
}

/**
 * The Run page's own formula, unchanged: 1s, 2s, 4s, 8s, then capped at 10s.
 * `attempt` is 0 for the first retry after the first drop.
 */
export function reconnectDelayMs(attempt: number, { baseMs = 1000, maxMs = 10000 }: ReconnectBackoffOptions = {}): number {
  return Math.min(baseMs * 2 ** attempt, maxMs);
}

export interface FollowReconnectingSseStreamOptions {
  /**
   * Recomputed on every (re)connect attempt, so a caller can add a
   * `Last-Event-ID` header once one is known — the Run page does this so a
   * reconnect does not replay events already delivered.
   */
  request: () => { url: string; headers?: Record<string, string> };
  signal: AbortSignal;
  /**
   * Called for each complete block off the wire, in order. Return `true` once
   * the caller has recognized a terminal event (e.g. `run.finished`) — the
   * loop stops reading and does not reconnect. Returning `false` keeps the
   * stream open for more blocks.
   */
  onBlock: (block: SseBlock) => boolean;
  /**
   * `null` on every successful connect (including the first); an `Error` each
   * time an attempt drops, called before the backoff wait begins. Optional —
   * a caller with no "reconnecting…" UI can omit it.
   */
  onConnectionChange?: (error: Error | null) => void;
  backoff?: ReconnectBackoffOptions;
  /** Injectable for tests; defaults to a real timer that also resolves early
   * if `signal` aborts mid-wait. */
  wait?: (ms: number) => Promise<void>;
}

function defaultWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Statuses that retrying cannot fix: signed out, not allowed, or the run is
 * not there. Retrying them would poll the API every 10 seconds for as long as
 * the tab stays open, with nothing on screen saying so. Everything else — a
 * 5xx, a 429, a network error, a body-less response, a stream that ends early
 * — is treated as a drop and retried.
 */
export const PERMANENT_STREAM_STATUSES: ReadonlySet<number> = new Set([401, 403, 404, 410]);

/**
 * Resolves `"terminal"` once `onBlock` returns `true`; `"gone"` when the
 * server answers with one of `PERMANENT_STREAM_STATUSES`, which no retry can
 * change; or `"aborted"` if `signal` fires first — a stream the caller closed
 * on purpose (unmount, or following a different id), which is not an outcome
 * to react to. It never rejects: every other connection failure is retried
 * rather than surfaced, like the Run page's own reader.
 */
export async function followReconnectingSseStream(
  options: FollowReconnectingSseStreamOptions,
): Promise<"terminal" | "gone" | "aborted"> {
  const { request, signal, onBlock, onConnectionChange, backoff } = options;
  const wait = options.wait ?? ((ms: number) => defaultWait(ms, signal));
  let attempt = 0;

  while (!signal.aborted) {
    try {
      const { url, headers } = request();
      const response = await fetch(url, { headers, cache: "no-store", signal });
      if (PERMANENT_STREAM_STATUSES.has(response.status)) return "gone";
      if (!response.ok) throw new Error(`Response stream failed (${response.status})`);
      if (!response.body) throw new Error("Response stream returned no body");
      onConnectionChange?.(null);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let terminal = false;
      while (!terminal) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { blocks, remainder } = splitSseBuffer(buffer);
        buffer = remainder;
        for (const raw of blocks) {
          const parsed = parseSseBlock(raw);
          if (!parsed) continue;
          attempt = 0;
          if (onBlock(parsed)) {
            terminal = true;
            break;
          }
        }
      }
      await reader.cancel().catch(() => {});
      if (terminal) return "terminal";
      throw new Error("Response stream ended before the response finished");
    } catch (cause) {
      if (signal.aborted) return "aborted";
      onConnectionChange?.(cause instanceof Error ? cause : new Error(String(cause)));
      await wait(reconnectDelayMs(attempt++, backoff));
    }
  }
  return "aborted";
}
