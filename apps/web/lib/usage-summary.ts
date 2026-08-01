/**
 * Reading GET /v1/usage into something the profile menu can say out loud.
 *
 * The whole risk in this file is one direction of wrongness. `limit: null`
 * means unlimited, and a payload that has simply lost the field — an older API
 * revision, a truncated response, a proxy that returned an error body with a
 * 200 — parses into the *same* `undefined` unless something checks. Reading
 * that as unlimited tells a metered user they have no cap, which is the one
 * sentence this feature exists to stop being wrong.
 *
 * So the parser demands the key be present, and returns null for the whole
 * summary when it is not. The menu then shows what it showed before this
 * feature existed: a link, and no numbers. Silence is a fine answer here;
 * a confident wrong number is not.
 */

export type Allowance = {
  used: number;
  /** null means unlimited — never "unknown". Unknown fails the parse. */
  limit: number | null;
  remaining: number | null;
  exhausted: boolean;
};

export type RunAllowance = Allowance & {
  windowDays: number;
  /** ISO-8601, or null when nothing is spent or the tier is unlimited. */
  nextSlotAt: string | null;
};

export type UsageSummary = {
  tier: string;
  runs: RunAllowance;
  artifacts: Allowance;
  workspaces: Allowance;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCount(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** `number | null` where the key MUST exist. Absence is a parse failure. */
function readOptionalCount(
  source: Record<string, unknown>,
  key: string,
): { ok: true; value: number | null } | { ok: false } {
  if (!(key in source)) return { ok: false };
  const value = source[key];
  if (value === null) return { ok: true, value: null };
  if (typeof value === "number" && Number.isFinite(value)) return { ok: true, value };
  return { ok: false };
}

function parseAllowance(value: unknown): Allowance | null {
  if (!isRecord(value)) return null;
  const used = readCount(value, "used");
  const limit = readOptionalCount(value, "limit");
  const remaining = readOptionalCount(value, "remaining");
  if (used === null || !limit.ok || !remaining.ok) return null;
  if (typeof value.exhausted !== "boolean") return null;
  return { used, limit: limit.value, remaining: remaining.value, exhausted: value.exhausted };
}

export function parseUsage(payload: unknown): UsageSummary | null {
  if (!isRecord(payload)) return null;
  const runs = parseAllowance(payload.runs);
  const artifacts = parseAllowance(payload.artifacts);
  const workspaces = parseAllowance(payload.workspaces);
  if (!runs || !artifacts || !workspaces || typeof payload.tier !== "string") return null;

  const runsRecord = payload.runs as Record<string, unknown>;
  const windowDays = readCount(runsRecord, "window_days");
  if (windowDays === null) return null;
  const rawNext = runsRecord.next_slot_at;
  if (rawNext !== null && typeof rawNext !== "string") return null;
  // A string that isn't a date is worse than no date: it would render
  // "Invalid Date" beside a real number and make both look broken.
  if (typeof rawNext === "string" && Number.isNaN(Date.parse(rawNext))) return null;

  return {
    tier: payload.tier,
    runs: { ...runs, windowDays, nextSlotAt: rawNext ?? null },
    artifacts,
    workspaces,
  };
}

/** A named day ("today") reads differently in a sentence than a dated one. */
export type NextSlot = { relative: boolean; text: string };

/**
 * The day a run comes back, in the viewer's own locale.
 *
 * Deliberately a date and not a countdown. "In 4 days" has to be recomputed to
 * stay true and reads as an estimate; "Aug 3" is a fact that survives the menu
 * being left open. Today and tomorrow are named instead, because a date the
 * reader has to compare against today's is a date they have to think about.
 *
 * `relative` exists because the two forms take different grammar around them —
 * "frees up **on** Aug 5" but "frees up today", and in Japanese 「8月5日**に**」
 * but 「今日」. Returning the word and letting the copy layer choose the frame
 * keeps that decision in the file where both languages live.
 */
export function describeNextSlot(
  iso: string,
  locale: "en" | "ja",
  now: Date = new Date(),
  timeZone?: string,
): NextSlot | null {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;

  const dayKey = (value: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    }).format(value);

  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (dayKey(when) === dayKey(now)) {
    return { relative: true, text: locale === "ja" ? "今日" : "today" };
  }
  if (dayKey(when) === dayKey(tomorrow)) {
    return { relative: true, text: locale === "ja" ? "明日" : "tomorrow" };
  }

  return {
    relative: false,
    text: new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
      month: "short",
      day: "numeric",
      ...(timeZone ? { timeZone } : {}),
    }).format(when),
  };
}

/**
 * Whether there is anything worth showing beyond the tier name.
 *
 * An unmetered account has no numbers to report — "unlimited of unlimited"
 * is noise, and the menu says so in one word instead.
 */
export function isMetered(summary: UsageSummary): boolean {
  return summary.runs.limit !== null;
}
