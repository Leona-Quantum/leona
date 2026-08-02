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

/**
 * The ENFORCED weekly allowance, and the one the meter on this page fills.
 *
 * `runsEquivalent` and `tokensPerRun` come from the server rather than from
 * this app's own tier table on purpose. The derivation belongs to whoever
 * enforces it; a client multiplying by a constant of its own is how the screen
 * and the refusal come to state different allowances.
 */
export type TokenAllowance = RunAllowance & {
  runsEquivalent: number | null;
  tokensPerRun: number;
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

/**
 * Dollars of estimated hardware spend this ACCOUNT has authorized, and the
 * ceiling it was measured against.
 *
 * `limitUsd` null is unlimited and is the ordinary case, not the exotic one:
 * the weekly hardware ceiling was removed on every tier once the owner ruled
 * that what a person spends on their own provider account is their decision.
 * The field stays in the contract because a self-set budget will use it, so
 * both branches are live code rather than one branch and a comment.
 *
 * `limitUsd` 0 is a third thing again, and the API's own docstring is explicit
 * about it: it is NOT a hardware ban. A free-queue submission estimates nothing,
 * counts as 0.00 and is never refused, so a zero ceiling means the priced
 * devices are out of reach and the free queues are not.
 */
export type HardwareSpend = {
  usedUsd: number;
  /** null means unlimited — never "unknown", exactly as {@link Allowance}. */
  limitUsd: number | null;
  remainingUsd: number | null;
  exhausted: boolean;
  windowDays: number;
};

export type UsageSummary = {
  tier: string;
  /** Execute runs started in the window. Reported; no longer the gate. */
  runs: RunAllowance;
  /**
   * The enforced weekly allowance. Null on absence rather than a parse failure,
   * for the reason `spend` is — an API that predates it must not blank the
   * whole panel.
   */
  tokens: TokenAllowance | null;
  artifacts: Allowance;
  workspaces: Allowance;
  /**
   * Shared projects this ACCOUNT is in, counted from both directions: projects
   * it owns that carry a live grant, plus projects shared with it.
   *
   * Null on absence rather than a parse failure, for the reason `spend` is —
   * see below. Unshared projects are not counted here and are unlimited on
   * every tier, which is a fact the copy layer has to say out loud: "2 of 4"
   * beside the word "projects" reads as a cap on all of them.
   */
  sharedProjects: Allowance | null;
  /**
   * Null when the control plane did not send one, or sent one that does not
   * add up. Unlike every field above it, absence here is not a parse failure:
   * `spend` arrived after the allowances did, so a web deploy that reaches
   * users before the API's must keep showing the allowances rather than
   * blanking the panel.
   */
  spend: SpendReport | null;
  /** Additive in the same way and for the same reason as `spend`. */
  hardwareSpend: HardwareSpend | null;
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

/** The windowed half of an allowance block: `window_days` + `next_slot_at`. */
function parseWindow(
  value: Record<string, unknown>,
): { ok: true; windowDays: number; nextSlotAt: string | null } | { ok: false } {
  const windowDays = readCount(value, "window_days");
  if (windowDays === null) return { ok: false };
  const rawNext = value.next_slot_at;
  if (rawNext !== null && typeof rawNext !== "string") return { ok: false };
  // A string that isn't a date is worse than no date: it would render
  // "Invalid Date" beside a real number and make both look broken.
  if (typeof rawNext === "string" && Number.isNaN(Date.parse(rawNext))) return { ok: false };
  return { ok: true, windowDays, nextSlotAt: rawNext ?? null };
}

function parseTokenAllowance(value: unknown): TokenAllowance | null {
  const allowance = parseAllowance(value);
  if (!allowance || !isRecord(value)) return null;
  const window = parseWindow(value);
  if (!window.ok) return null;
  const runsEquivalent = readOptionalCount(value, "runs_equivalent");
  const tokensPerRun = readCount(value, "tokens_per_run");
  if (!runsEquivalent.ok || tokensPerRun === null) return null;
  return {
    ...allowance,
    windowDays: window.windowDays,
    nextSlotAt: window.nextSlotAt,
    runsEquivalent: runsEquivalent.value,
    tokensPerRun,
  };
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

/**
 * The hardware block, or null — with the same "absent key is not null" rule the
 * counted allowances get, and one coherence check on top.
 *
 * `remaining_usd` is not recomputed here and it is not trusted either. The API
 * derives it as `max(limit - used, 0)`, the panel prints "$3.40 authorized" and
 * "$21.60 left" a line apart, and a reader subtracts them by eye. A pair that
 * does not agree is not a stale number to the person reading it — it is the
 * whole panel being wrong. So a contradiction drops the block, and the account
 * page renders exactly what it rendered before this field existed.
 *
 * The tolerance is half a cent because these are floats read back from a
 * `Numeric` column: 25 - 21.6 lands on 3.4000000000000004 in IEEE754, and a
 * strict comparison would reject every real response.
 */
function parseHardwareSpend(value: unknown): HardwareSpend | null {
  if (!isRecord(value)) return null;
  const used = readCount(value, "used_usd");
  const limit = readOptionalCount(value, "limit_usd");
  const remaining = readOptionalCount(value, "remaining_usd");
  const windowDays = readCount(value, "window_days");
  if (used === null || !limit.ok || !remaining.ok || windowDays === null) return null;
  if (typeof value.exhausted !== "boolean") return null;
  // Unlimited on one field and bounded on the other is not a state the API can
  // produce, and it is the state a half-applied deploy would produce.
  if ((limit.value === null) !== (remaining.value === null)) return null;
  if (limit.value !== null && remaining.value !== null) {
    if (Math.abs(Math.max(limit.value - used, 0) - remaining.value) > 0.005) return null;
  }
  return {
    usedUsd: used,
    limitUsd: limit.value,
    remainingUsd: remaining.value,
    exhausted: value.exhausted,
    windowDays,
  };
}

export function parseUsage(payload: unknown): UsageSummary | null {
  if (!isRecord(payload)) return null;
  const runs = parseAllowance(payload.runs);
  const artifacts = parseAllowance(payload.artifacts);
  const workspaces = parseAllowance(payload.workspaces);
  if (!runs || !artifacts || !workspaces || typeof payload.tier !== "string") return null;

  const runsWindow = parseWindow(payload.runs as Record<string, unknown>);
  if (!runsWindow.ok) return null;

  return {
    tier: payload.tier,
    runs: { ...runs, windowDays: runsWindow.windowDays, nextSlotAt: runsWindow.nextSlotAt },
    // Additive, like the blocks below it: an API that predates the token meter
    // renders the panel that shipped before it rather than nothing at all.
    tokens: parseTokenAllowance(payload.tokens),
    artifacts,
    workspaces,
    // `parseAllowance` already refuses a block whose `limit` key is missing, so
    // the additive treatment here costs nothing: absent means "an API that
    // predates the field", malformed means "do not guess", and both render as
    // the panel that shipped before it.
    sharedProjects: parseAllowance(payload.shared_projects),
    spend: parseSpend(payload.spend),
    hardwareSpend: parseHardwareSpend(payload.hardware_spend),
  };
}

/**
 * US dollars, always to the cent, in the reader's own digit grouping.
 *
 * Two decimals is not a style choice. These arrive as floats read back from a
 * `Numeric` column and a sum of them lands on 25.000000000000004 often enough
 * to be the normal case rather than the pathological one; printing the raw
 * value would put fourteen decimal places of IEEE754 noise on the account page.
 *
 * Deliberately NOT `qpu.formatUsd`, which shows four decimals below a dollar.
 * That one prices a single shot, where $0.000425 is the whole number and
 * rounding it to $0.00 would be reporting free hardware that is not free. This
 * one totals what an account authorized, where a fraction of a cent is noise
 * and the extra digits only make two figures harder to compare. Same currency,
 * opposite requirement — one function could not serve both without a flag that
 * every call site would then have to get right.
 */
export function formatUsd(value: number, locale: "en" | "ja"): string {
  // Round to cents before formatting so a value a hair under zero — float
  // noise on a `remaining` that is really zero — cannot print as "-$0.00".
  const cents = Math.round(value * 100);
  return new Intl.NumberFormat(locale === "ja" ? "ja-JP" : "en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents === 0 ? 0 : cents / 100);
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
