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

/** Model tokens and the provider calls that spent them. Never money. */
export type TokenSpend = {
  tokens: number;
  calls: number;
};

export type ModelSpend = TokenSpend & {
  /** Provider model id. Empty string when the event carried no model. */
  model: string;
};

export type SpendReport = {
  windowDays: number;
  total: TokenSpend;
  chat: TokenSpend;
  runs: TokenSpend;
  /** Descending by tokens, and a partition of `total` — see parseSpend. */
  byModel: ModelSpend[];
};

export type UsageSummary = {
  tier: string;
  runs: RunAllowance;
  artifacts: Allowance;
  workspaces: Allowance;
  /**
   * Null when the control plane did not send one, or sent one that does not
   * add up. Unlike every field above it, absence here is not a parse failure:
   * `spend` arrived after the allowances did, so a web deploy that reaches
   * users before the API's must keep showing the allowances rather than
   * blanking the panel.
   */
  spend: SpendReport | null;
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

function parseTokenSpend(value: unknown): TokenSpend | null {
  if (!isRecord(value)) return null;
  const tokens = readCount(value, "tokens");
  const calls = readCount(value, "calls");
  if (tokens === null || calls === null) return null;
  return { tokens, calls };
}

/**
 * The spend block, or null — and null for a payload that contradicts itself.
 *
 * The API documents two invariants: `chat` and `runs` partition `total`, and
 * `by_model` covers every event. Both are checked here rather than trusted,
 * because the panel prints all three next to each other and a reader adds them
 * up by eye in about a second. A total that is not the sum of the two lines
 * under it does not read as "one of these is stale" — it reads as the whole
 * page being wrong, including the allowances above, which are fine.
 *
 * So a payload that fails either check renders nothing at all. That is a worse
 * outcome than a correct panel and a better one than an incoherent panel, and
 * it is the only branch here that could hide a real number: it is deliberate,
 * and it can only fire on a response the API's own tests say is impossible.
 */
function parseSpend(value: unknown): SpendReport | null {
  if (!isRecord(value)) return null;
  const windowDays = readCount(value, "window_days");
  const total = parseTokenSpend(value.total);
  const chat = parseTokenSpend(value.chat);
  const runs = parseTokenSpend(value.runs);
  if (windowDays === null || !total || !chat || !runs) return null;
  if (!Array.isArray(value.by_model)) return null;

  const byModel: ModelSpend[] = [];
  for (const entry of value.by_model) {
    const spend = parseTokenSpend(entry);
    if (!spend || !isRecord(entry) || typeof entry.model !== "string") return null;
    byModel.push({ ...spend, model: entry.model });
  }

  if (chat.tokens + runs.tokens !== total.tokens) return null;
  if (chat.calls + runs.calls !== total.calls) return null;
  const attributed = byModel.reduce((sum, entry) => sum + entry.tokens, 0);
  if (attributed !== total.tokens) return null;

  return { windowDays, total, chat, runs, byModel };
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
    spend: parseSpend(payload.spend),
  };
}

/**
 * A token count in the reader's own digits, grouped and never abbreviated.
 *
 * "1.3M" would be friendlier and is the wrong trade here: this is the only
 * place in the product a person can see what their conversations actually
 * consumed, and a figure they cannot compare against a provider's bill or
 * against last week's is decoration. Grouping separators do the readability
 * work without discarding anything.
 */
export function formatTokens(tokens: number, locale: "en" | "ja"): string {
  return new Intl.NumberFormat(locale === "ja" ? "ja-JP" : "en-US").format(tokens);
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
