// Source coverage and declared gaps — roadmap §3.6, owner direction 2026-08-06.
//
// The doctrine this module implements, in one line:
//
//   A block may ship with a hole. It may never ship with a guess in the hole.
//
// Everything here exists to keep three things apart that all render as silence
// if you let them collapse: the source reports it, the source does not have it,
// and nobody has checked.

// The `.ts` specifier is required, not stylistic: from-catalog.ts imports this
// module, and from-catalog.ts is loaded directly by `node --test`, which strips
// the types but resolves the path literally. Same reason the rest of lib/
// spells it out.
import {
  BLOCK_ROLES,
  KNOWN_GAP_REASONS,
  SOURCE_COVERAGE_AXES,
  SOURCE_COVERAGE_STATUSES,
  type BlockRole,
  type KnownGapReason,
  type PublicRepositoryKnownGap,
  type SourceCoverage,
  type SourceCoverageAxis,
  type SourceCoverageStatus,
} from "./types.ts";

/**
 * The honest default: nobody has checked any axis.
 *
 * A fresh object every call — this is spread into 283 records and a shared
 * frozen literal would make one record's later correction silently rewrite all
 * of them.
 */
export function unknownCoverage(): SourceCoverage {
  return { theory: "unknown", simulation: "unknown", hardware: "unknown" };
}

export function isSourceCoverageStatus(value: unknown): value is SourceCoverageStatus {
  return typeof value === "string" && (SOURCE_COVERAGE_STATUSES as readonly string[]).includes(value);
}

export function isBlockRole(value: unknown): value is BlockRole {
  return typeof value === "string" && (BLOCK_ROLES as readonly string[]).includes(value);
}

export function isKnownGapReason(value: unknown): value is KnownGapReason {
  return typeof value === "string" && (KNOWN_GAP_REASONS as readonly string[]).includes(value);
}

/**
 * Shape check for a `sourceCoverage` blob off the API.
 *
 * Requires ALL THREE axes. A partial object is rejected rather than filled in
 * with `unknown`, because filling it here would silently turn "the API and this
 * build disagree about the axes" into "this record has not been checked" — the
 * two are not the same and only one of them is a schema problem.
 */
export function isSourceCoverage(value: unknown): value is SourceCoverage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const blob = value as Record<string, unknown>;
  return SOURCE_COVERAGE_AXES.every((axis) => isSourceCoverageStatus(blob[axis]));
}

/**
 * Shape check for one citation attached to a gap.
 *
 * Every field the renderer dereferences is checked, not just the container.
 * `citations: [null]` is an array and would sail past an `Array.isArray` test,
 * and `KnownGapsSection` then reads `citation.url` on it and throws while
 * rendering a published entry page. The blob is `dict[str, Any]` on the API
 * side, so this is a reachable input rather than a hypothetical one — and a
 * validator that checks the box but not what is in it is the exact shape this
 * module exists to prevent one layer up.
 */
export function isGapCitation(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const citation = value as Record<string, unknown>;
  // title and url are rendered as the link; authors and year sit beside it.
  if (typeof citation.title !== "string" || citation.title.trim().length === 0) return false;
  if (typeof citation.url !== "string" || citation.url.trim().length === 0) return false;
  if (typeof citation.authors !== "string") return false;
  if (typeof citation.year !== "string") return false;
  return true;
}

/**
 * Minimum lengths for a gap's prose, measured after trimming.
 *
 * A whitespace-only string has length; it does not have content. And the two
 * locales need different floors because Japanese carries far more meaning per
 * character — holding it to the English number would either force padding or
 * make the English floor uselessly low.
 */
const MIN_GAP_DETAIL = 40;
const MIN_GAP_DETAIL_JA = 12;

/** Shape check for one declared gap. */
export function isKnownGap(value: unknown): value is PublicRepositoryKnownGap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const gap = value as Record<string, unknown>;
  if (!isBlockRole(gap.role)) return false;
  if (!isKnownGapReason(gap.reason)) return false;
  if (typeof gap.detail !== "string" || gap.detail.trim().length < MIN_GAP_DETAIL) return false;
  if (typeof gap.detailJa !== "string" || gap.detailJa.trim().length < MIN_GAP_DETAIL_JA) return false;
  if (gap.citations !== undefined) {
    if (!Array.isArray(gap.citations)) return false;
    if (!gap.citations.every(isGapCitation)) return false;
  }
  return true;
}

export function isKnownGapList(value: unknown): value is PublicRepositoryKnownGap[] {
  return Array.isArray(value) && value.every(isKnownGap);
}

/**
 * Whether a coverage record says anything at all.
 *
 * On day one every record is all-`unknown`, and rendering three "unknown" chips
 * on 283 pages is noise that teaches a reader to ignore the control. Renderers
 * show the block only when `isInformative` — which also means the field becoming
 * *less* informative over time is visible as the block disappearing, rather than
 * as three chips that never change.
 */
export function isInformative(coverage: SourceCoverage | undefined): boolean {
  if (!coverage) return false;
  return SOURCE_COVERAGE_AXES.some((axis) => coverage[axis] !== "unknown");
}

/**
 * The three states of `knownGaps`, resolved once so no renderer has to
 * rediscover them — and so no renderer can accidentally collapse the last two.
 *
 * - `declared`   — this record names these specific holes.
 * - `none`       — somebody reviewed it and found none. A positive claim.
 * - `unreviewed` — nobody has looked. NOT the same claim, and the difference
 *                  matters most in exactly the field that exists to be honest
 *                  about what is missing.
 *
 * The bug this prevents is quiet: `gaps?.length ? render(gaps) : null` renders
 * nothing for both `[]` and `undefined`, and a reader takes silence in a
 * gap-disclosure panel to mean "no gaps". A record that has never been examined
 * would be asserting it is complete.
 */
export type KnownGapsState =
  | { kind: "declared"; gaps: PublicRepositoryKnownGap[] }
  | { kind: "none" }
  | { kind: "unreviewed" };

export function knownGapsState(gaps: PublicRepositoryKnownGap[] | undefined): KnownGapsState {
  if (gaps === undefined) return { kind: "unreviewed" };
  if (gaps.length === 0) return { kind: "none" };
  return { kind: "declared", gaps };
}

/** Permanent reasons render as permanent (§3.6) — not as work still to do. */
export function isPermanentGap(reason: KnownGapReason): boolean {
  return reason === "field_disagrees" || reason === "nisq_specific";
}

/**
 * Census over a corpus, for scripts/check-repository-data.mjs.
 *
 * Printed rather than merely asserted, because the failure mode for a
 * three-valued field is that one value is never taken by any record — at which
 * point the field claims a distinction it does not make. A count is the only
 * thing that shows that.
 */
export function coverageCensus(
  entries: ReadonlyArray<{ sourceCoverage?: SourceCoverage }>,
): Record<SourceCoverageAxis, Record<SourceCoverageStatus, number>> {
  const census = Object.fromEntries(
    SOURCE_COVERAGE_AXES.map((axis) => [
      axis,
      Object.fromEntries(SOURCE_COVERAGE_STATUSES.map((status) => [status, 0])),
    ]),
  ) as Record<SourceCoverageAxis, Record<SourceCoverageStatus, number>>;

  for (const entry of entries) {
    const coverage = entry.sourceCoverage;
    for (const axis of SOURCE_COVERAGE_AXES) {
      const status = coverage?.[axis] ?? "unknown";
      census[axis][status] += 1;
    }
  }
  return census;
}
