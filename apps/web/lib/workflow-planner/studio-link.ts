// Carrying a plan from `/repository/plan` into Studio, through the URL
// fragment only.
//
// ## The rule this file exists to hold
//
// The fragment carries INPUTS — the reader's sentence, the problem they
// picked, the numbers they typed, the blocks they swapped — never a computed
// number. `studio-plan-panel.tsx` re-runs `planWorkflow` locally over
// whatever Atlas graph Studio already has; it does not trust a cost, a label
// or a source out of this payload. That is what makes a crafted or stale link
// safe to decode: the worst it can do is describe a wrong INPUT, and the
// planner is already built to handle an out-of-range or unrecognised one
// (`recognise.ts`, `assemble.ts`) without producing a false number.
//
// Encoding is `#plan=<base64url(JSON)>` rather than a query string, for the
// same reason the planner's own `#q=` is a fragment: it never reaches a
// server, a log, a referrer header or the CDN cache key. `plan=1` in the
// QUERY string is a separate, harmless flag — it only tells the Studio page
// to ship the (large) layer graph to the client at all; it carries no reader
// text or numbers.
//
// Decoding is strict on purpose: anything that does not match the shape
// below returns `null` and nothing else. A page reading `null` shows "this
// plan link could not be read" — never a half-applied plan, never a thrown
// error reaching the UI.
import { problemById } from "./problems.ts";
import { PLAN_TEXT_MAX } from "./recognise.ts";
import type { ParamKey, ProblemId } from "./types.ts";
import type { MethodChoices } from "./assemble.ts";

/** The fragment's own version tag. Bump it, and add a migration here, the day the shape changes. */
export const STUDIO_PLAN_LINK_VERSION = 1;

/** The `plan=` value's own length cap, in characters — checked before any decoding is attempted. */
export const STUDIO_PLAN_LINK_MAX_CHARS = 4096;

/** `choices` is reader edits keyed by stage path; unbounded growth would be a way to smuggle an oversized payload past the character cap in small pieces. */
export const STUDIO_PLAN_LINK_MAX_CHOICES = 32;

export interface StudioPlanLink {
  v: 1;
  /** The reader's own sentence, capped the same way the planner's text box is. */
  text: string;
  problem: ProblemId;
  /** Only values the reader TYPED — never a value the sentence supplied or a spec assumed. Re-reading `text` recovers those. */
  params: Partial<Record<ParamKey, number | null>>;
  choices: MethodChoices;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// base64url, over UTF-8 bytes (never over UTF-16 code units — `btoa` throws on
// a plain Japanese sentence, which every problem's own example proves this
// payload must carry).

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  // The alphabet check comes first: `atob` accepts and silently reinterprets
  // some characters outside base64 proper (whitespace), which would make a
  // malformed fragment decode to bytes instead of failing here.
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const binary = atob(padded + pad);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Encode

/** `/studio?example=<id>&plan=1#plan=<payload>` — the whole href the planner links to. */
export function studioPlanHref(workedExampleId: string, link: Omit<StudioPlanLink, "v">): string {
  return `/studio?example=${encodeURIComponent(workedExampleId)}&plan=1#${encodeStudioPlanLink(link)}`;
}

/** Just the fragment (`plan=<payload>`, no leading `#`), for a caller building its own URL. */
export function encodeStudioPlanLink(link: Omit<StudioPlanLink, "v">): string {
  const payload: StudioPlanLink = { v: STUDIO_PLAN_LINK_VERSION, ...link };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return `plan=${toBase64Url(bytes)}`;
}

// ---------------------------------------------------------------------------
// Decode + validate

function validateParams(problem: { params: readonly { key: ParamKey }[] }, value: unknown): StudioPlanLink["params"] | null {
  if (!isPlainObject(value)) return null;
  const declared = new Set(problem.params.map((spec) => spec.key));
  const out: StudioPlanLink["params"] = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!declared.has(key as ParamKey)) return null;
    if (raw === null) {
      out[key as ParamKey] = null;
      continue;
    }
    if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
    out[key as ParamKey] = raw;
  }
  return out;
}

function validateChoices(value: unknown): MethodChoices | null {
  if (!isPlainObject(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > STUDIO_PLAN_LINK_MAX_CHOICES) return null;
  const out: Record<string, string> = {};
  for (const [key, raw] of entries) {
    if (typeof raw !== "string") return null;
    out[key] = raw;
  }
  return out;
}

/** The JSON payload only — split out so a test can hand it a parsed object directly, without also exercising base64. */
export function validateStudioPlanPayload(value: unknown): StudioPlanLink | null {
  if (!isPlainObject(value)) return null;
  if (value.v !== STUDIO_PLAN_LINK_VERSION) return null;
  if (typeof value.text !== "string" || value.text.length > PLAN_TEXT_MAX) return null;
  if (typeof value.problem !== "string") return null;
  const problem = problemById(value.problem);
  if (!problem) return null;
  const params = validateParams(problem, value.params);
  if (params === null) return null;
  const choices = validateChoices(value.choices);
  if (choices === null) return null;
  return { v: STUDIO_PLAN_LINK_VERSION, text: value.text, problem: problem.id, params, choices };
}

/**
 * `hash` is `window.location.hash` (or any string with or without a leading
 * `#`) — the caller does not need to have already picked `plan=` out of it.
 * Anything that fails at any step — no `plan=` key, oversized, not valid
 * base64url, not valid UTF-8, not valid JSON, or shaped wrong — returns
 * `null`. Never throws.
 */
export function decodeStudioPlanHash(hash: string): StudioPlanLink | null {
  let raw: string | null;
  try {
    const clean = hash.startsWith("#") ? hash.slice(1) : hash;
    raw = new URLSearchParams(clean).get("plan");
  } catch {
    return null;
  }
  if (!raw || raw.length > STUDIO_PLAN_LINK_MAX_CHARS) return null;
  const bytes = fromBase64Url(raw);
  if (!bytes) return null;
  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  return validateStudioPlanPayload(parsed);
}

/** Whether `hash` even claims to carry a plan — used to tell "no fragment" (render nothing) apart from "a `plan=` fragment that failed to decode" (show the error), since Studio's hash is also used for other things (e.g. `#comments`). */
export function hashHasStudioPlan(hash: string): boolean {
  try {
    const clean = hash.startsWith("#") ? hash.slice(1) : hash;
    return new URLSearchParams(clean).has("plan");
  } catch {
    return false;
  }
}
