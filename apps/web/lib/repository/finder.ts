// Proposal 2: "Atlas as the way in — from a problem to candidate methods"
// (owner-approved 2026-09-20). A reader states a problem and some limits; this
// module filters and ranks the corpus against what each record ACTUALLY
// states, and never fabricates a number a record does not carry.
//
// ## Why this reads `resources`, not `metadata` or `classicalComparison`
//
// `PublicRepositoryListEntry` (`./types.ts`) is what production actually
// serves: when `MAJORANA_PUBLIC_CATALOG_API` is on (true in production —
// `.github/workflows/deploy-web.yml`), `/repository/find` reads the API's
// trimmed `?view=list` projection, and `metadata` and `classicalComparison`
// are NOT on `PUBLIC_REPOSITORY_LIST_FIELDS` — a past feature that read the
// full local corpus in dev and the trimmed list in production shipped
// invisible in production for exactly this reason. `resources` IS on the
// allowlist, and it is where a record's qubit count, depth, reported cost and
// speedup-class citation actually live. So every field this module reads is
// one production genuinely serves.
//
// ## What each limit can and cannot judge, measured over the corpus 2026-09-20
//
// - Qubits: 89 of 284 records state a `resources` row labelled "Qubits"; 86 of
//   those parse to a leading integer ("5", "16"), 3 do not ("Problem mapped",
//   "n + 1", "n (n=1,2 shown)"). A record with no stated value, or a stated
//   value this module cannot parse as a number, never satisfies OR violates a
//   qubit limit — it is reported "not stated" and is never excluded on a guess.
// - Depth: 46 of 284 state a "Depth" row; 41 parse to a leading integer ("14
//   gates"). Five do not ("Oracle + diffusion", "oracle-dependent", …) and are
//   treated the same way.
// - Problem size (n): no record in the corpus carries a structured, numeric
//   field for the size of a *problem instance* (as opposed to a circuit's own
//   qubit count). This limit therefore reports "not stated" for every record
//   and never excludes one — see `checkDataSize`.
// - Hardware era: 58 records carry a `resources` "Speedup class (secondary
//   source)" row and a citation of whether that classification has been
//   checked against the record's own primary paper; a handful state
//   "Readiness: FTQC required" outright. The fault-tolerant *cost* — physical
//   qubits, magic states, runtime — comes only from the resource estimator via
//   the catalog API (`getRepositoryEstimates()`), which this module never
//   calls itself: it takes the already-fetched result as a plain argument, so
//   the browser never talks to Python and a page rendered with the estimator
//   off is a page that says so rather than one that guesses.

import { matchesRepositoryQuery, type RepositorySearchable } from "./search.ts";
import { topicsInFacet, type TopicId } from "./topics.ts";
import { isPriced, type ResourceEstimateBasis, type RepositoryEstimateList } from "./estimate.ts";
import type { PublicRepositoryListEntry } from "./types";

export type HardwareEraFilter = "any" | "nisq" | "fault-tolerant";

export interface FinderLimits {
  /** A domain-facet topic id ("chemistry", "optimization", …), or "" for any problem area. */
  problem: TopicId | "";
  /** Free text, matched the same way the Atlas browse search matches (search.ts). */
  query: string;
  maxQubits: number | null;
  maxDepth: number | null;
  /**
   * Informational only. See the module header: no record states a comparable
   * field, so this never excludes a record — it only ever reports "not
   * stated" in `FinderMatch.criteria`. Kept as a real input because the
   * proposal asks for it and because "we built the place, nobody filled it"
   * is a different, honest sentence from not asking at all.
   */
  dataSizeN: number | null;
  hardwareEra: HardwareEraFilter;
}

export const DEFAULT_FINDER_LIMITS: FinderLimits = {
  problem: "",
  query: "",
  maxQubits: null,
  maxDepth: null,
  dataSizeN: null,
  hardwareEra: "any",
};

export interface FinderResource {
  label: string;
  value: string;
}

/** The fault-tolerant cost this module was HANDED, never fetched by it. See the module header. */
export interface FinderEstimate {
  basis: ResourceEstimateBasis;
  totalPhysicalQubits: number | null;
  seconds: number | null;
}

/**
 * One catalog record, projected to what the finder reads. A subset of
 * `PublicRepositoryListEntry` (every field below is on `PUBLIC_REPOSITORY_LIST_FIELDS`)
 * plus two fields the page joins in server-side, because both need data the
 * list projection does not carry:
 *
 * - `studioExampleId`: `resolveWorkedExamples(slug).hero?.id ?? null`, computed
 *   from the worked-example map (server-only — see `worked-example-resolution.ts`).
 *   Carries the id itself, not just a boolean, because "Open in Studio" needs
 *   it to build `/studio?example=<id>` (`workedExampleStudioHref`).
 * - `estimate`: one row of `getRepositoryEstimates()`, or null.
 */
export interface FinderRecord {
  slug: string;
  title: string;
  titleJa: string;
  description: string;
  descriptionJa: string;
  algorithmFamily: string;
  categoryLabel: string;
  categoryLabelJa: string;
  provenance: string;
  framework: string;
  tags: readonly string[];
  topics: readonly TopicId[];
  resources: readonly FinderResource[];
  /** `portableCircuit.qubitCount`, or null when this record publishes no bounded circuit. */
  portableCircuitQubits: number | null;
  /** The worked example this record's page would show as its hero, or null. See the field's own comment above. */
  studioExampleId: string | null;
  estimate: FinderEstimate | null;
}

export type CriterionVerdict = "satisfied" | "not-stated" | "violated";

export type FinderCriterionKey = "problem" | "query" | "qubits" | "depth" | "dataSize" | "hardwareEra";

export interface FinderCriterion {
  key: FinderCriterionKey;
  verdict: CriterionVerdict;
  detail: string;
  detailJa: string;
}

export interface FinderMatch {
  record: FinderRecord;
  /** Only the limits actually set, in a fixed order — see `buildCriteria`. */
  criteria: FinderCriterion[];
  /** Count of `criteria` entries with verdict `"satisfied"`. Drives the ranking. */
  satisfiedCount: number;
}

export interface FinderOutcome {
  matches: FinderMatch[];
  /**
   * For each limit, how many records fail ONLY that limit — i.e. pass every
   * other stated limit and would be included if this one limit were relaxed.
   * Lets an empty state say which limit is doing the excluding, rather than
   * just "nothing matched".
   */
  excludedByOnly: Record<FinderCriterionKey, number>;
}

function parseLeadingInt(value: string | undefined): number | null {
  if (value === undefined) return null;
  const m = /^\s*(\d+)/.exec(value);
  return m ? Number(m[1]) : null;
}

function resourceValue(record: FinderRecord, label: string): string | undefined {
  return record.resources.find((r) => r.label === label)?.value;
}

/** The record's own stated cost, read from `resources` — never derived or guessed. */
export interface StatedField {
  stated: boolean;
  value: string | null;
}

/**
 * "Cost as recorded" for display. Prefers the one field authored as a cost
 * summary ("Reported cost", 90 of 284 records); falls back to the two
 * structural resource rows ("Qubits"/"Depth", the benchmark circuits' own
 * cost) when neither carries a dedicated cost sentence. Returns `stated:
 * false` — never a placeholder number — when the record carries none of
 * these.
 */
export function statedCost(record: FinderRecord): StatedField {
  const reported = resourceValue(record, "Reported cost");
  if (reported) return { stated: true, value: reported };
  const qubits = resourceValue(record, "Qubits");
  const depth = resourceValue(record, "Depth");
  if (qubits || depth) {
    const parts: string[] = [];
    if (qubits) parts.push(`${qubits} qubits`);
    if (depth) parts.push(depth);
    return { stated: true, value: parts.join(", ") };
  }
  return { stated: false, value: null };
}

/**
 * The record's own stated advantage regime — its speedup class, as cited from
 * an outside index (the Quantum Algorithm Zoo) and marked with whether that
 * classification has been checked against the record's own primary paper. See
 * `/repository/claims` for the corpus-wide accounting this reuses the same
 * two fields from. This is NOT the estimator's crossover verdict
 * (`packages/py/estimation`'s `assess_advantage` is not wired to the web app
 * at all — see the PR description) and is not the fault-tolerant cost
 * (`FinderRecord.estimate`, sourced separately). It is the closest thing to a
 * regime a record states when neither of those is available.
 */
export function statedRegime(record: FinderRecord): StatedField {
  const speedup = resourceValue(record, "Speedup class (secondary source)");
  if (speedup) {
    const primarySource = resourceValue(record, "Primary source on the speedup");
    const checked = primarySource !== undefined && !/not checked/i.test(primarySource);
    return {
      stated: true,
      value: checked
        ? `${speedup} (checked against the record's own primary paper)`
        : `${speedup} (from a secondary index; not yet checked against the record's own primary paper)`,
    };
  }
  const readiness = resourceValue(record, "Readiness");
  if (readiness) return { stated: true, value: readiness };
  return { stated: false, value: null };
}

function checkNumericLimit(
  record: FinderRecord,
  label: "Qubits" | "Depth",
  limit: number | null,
): { verdict: CriterionVerdict; detail: string; detailJa: string } {
  const raw = resourceValue(record, label);
  const labelJa = label === "Qubits" ? "量子ビット数" : "深さ";
  if (limit === null) return { verdict: "not-stated", detail: "", detailJa: "" };
  if (raw === undefined) {
    return {
      verdict: "not-stated",
      detail: `${label}: not stated in the source.`,
      detailJa: `${labelJa}: 出典に記載なし。`,
    };
  }
  const parsed = parseLeadingInt(raw);
  if (parsed === null) {
    return {
      verdict: "not-stated",
      detail: `${label}: "${raw}" (stated, but not a single number to compare against your limit).`,
      detailJa: `${labelJa}:「${raw}」(記載はあるが、数値として上限と比較できない)。`,
    };
  }
  if (parsed <= limit) {
    return {
      verdict: "satisfied",
      detail: `${label}: ${raw} ≤ ${limit}.`,
      detailJa: `${labelJa}: ${raw} ≤ ${limit}。`,
    };
  }
  return {
    verdict: "violated",
    detail: `${label}: ${raw} exceeds your limit of ${limit}.`,
    detailJa: `${labelJa}: ${raw} は上限 ${limit} を超えています。`,
  };
}

function checkDataSize(limit: number | null): { verdict: CriterionVerdict; detail: string; detailJa: string } {
  if (limit === null) return { verdict: "not-stated", detail: "", detailJa: "" };
  return {
    verdict: "not-stated",
    detail:
      "Problem size (n): not stated in the source. No record in this catalog carries a structured, comparable instance-size field yet — shown for reference only, and never used to exclude a result.",
    detailJa:
      "問題サイズ（n）: 出典に記載なし。このカタログには、比較可能な構造化されたインスタンスサイズの項目を持つ記録がまだありません。参考情報としてのみ表示し、結果の除外には使いません。",
  };
}

function checkHardwareEra(
  record: FinderRecord,
  era: HardwareEraFilter,
  estimatesAvailable: boolean,
): { verdict: CriterionVerdict; detail: string; detailJa: string } {
  if (era === "any") return { verdict: "not-stated", detail: "", detailJa: "" };
  if (era === "nisq") {
    if (record.portableCircuitQubits !== null) {
      return {
        verdict: "satisfied",
        detail: `Publishes a runnable ${record.portableCircuitQubits}-qubit circuit.`,
        detailJa: `実行可能な ${record.portableCircuitQubits} 量子ビット回路を公開しています。`,
      };
    }
    return {
      verdict: "violated",
      detail: "No runnable circuit is published for this record.",
      detailJa: "この記録には実行可能な回路が公開されていません。",
    };
  }
  // era === "fault-tolerant"
  if (record.estimate && isPriced(record.estimate.basis)) {
    const q = record.estimate.totalPhysicalQubits;
    return {
      verdict: "satisfied",
      detail:
        q !== null
          ? `Fault-tolerant cost estimated: ${q.toLocaleString()} physical qubits.`
          : "A fault-tolerant cost estimate exists for this record.",
      detailJa: q !== null ? `フォールトトレラントコストの見積もり: 物理量子ビット ${q.toLocaleString()} 個。` : "この記録にはフォールトトレラントコストの見積もりがあります。",
    };
  }
  const readiness = resourceValue(record, "Readiness");
  if (readiness && /fault|ftqc/i.test(readiness)) {
    return {
      verdict: "satisfied",
      detail: `The record states: "${readiness}".`,
      detailJa: `記録には次のように記載されています:「${readiness}」。`,
    };
  }
  if (!estimatesAvailable) {
    return {
      verdict: "not-stated",
      detail: "The fault-tolerant cost estimator is not wired to this build, so this cannot be judged.",
      detailJa: "このビルドではフォールトトレラントコスト見積もりが接続されていないため、判定できません。",
    };
  }
  return {
    verdict: "violated",
    detail: "No fault-tolerant cost estimate is available for this record.",
    detailJa: "この記録にはフォールトトレラントコストの見積もりがありません。",
  };
}

function toSearchable(record: FinderRecord): RepositorySearchable {
  return {
    title: record.title,
    titleJa: record.titleJa,
    algorithmFamily: record.algorithmFamily,
    framework: record.framework,
    description: record.description,
    descriptionJa: record.descriptionJa,
    provenance: record.provenance,
    tags: record.tags,
  };
}

/** Every criterion for a record that has already passed every hard filter. */
function buildCriteria(
  record: FinderRecord,
  limits: FinderLimits,
  estimatesAvailable: boolean,
): FinderCriterion[] {
  const criteria: FinderCriterion[] = [];
  if (limits.problem) {
    criteria.push({
      key: "problem",
      verdict: "satisfied",
      detail: "Carries this problem area, from the Atlas's own topic vocabulary.",
      detailJa: "アトラス自身のトピック語彙で、この問題領域が付与されています。",
    });
  }
  if (limits.query.trim()) {
    criteria.push({
      key: "query",
      verdict: "satisfied",
      detail: `Matches "${limits.query.trim()}" in its title, description, family, framework or tags.`,
      detailJa: `タイトル・説明・ファミリー・フレームワーク・タグのいずれかが「${limits.query.trim()}」に一致します。`,
    });
  }
  if (limits.maxQubits !== null) {
    const c = checkNumericLimit(record, "Qubits", limits.maxQubits);
    criteria.push({ key: "qubits", ...c });
  }
  if (limits.maxDepth !== null) {
    const c = checkNumericLimit(record, "Depth", limits.maxDepth);
    criteria.push({ key: "depth", ...c });
  }
  if (limits.dataSizeN !== null) {
    criteria.push({ key: "dataSize", ...checkDataSize(limits.dataSizeN) });
  }
  if (limits.hardwareEra !== "any") {
    criteria.push({ key: "hardwareEra", ...checkHardwareEra(record, limits.hardwareEra, estimatesAvailable) });
  }
  return criteria;
}

/**
 * Whether `record` survives every hard filter EXCEPT `except` (or every one,
 * when `except` is null). A record is excluded only on a `"violated"`
 * verdict — `"not-stated"` never excludes, which is the honesty rule the
 * whole module exists to enforce; guessing a record out of the results on a
 * field it never stated would be the same fabrication as guessing it in.
 */
function passesExcept(
  record: FinderRecord,
  limits: FinderLimits,
  estimatesAvailable: boolean,
  except: FinderCriterionKey | null,
): boolean {
  if (except !== "problem" && limits.problem && !record.topics.includes(limits.problem)) return false;
  if (except !== "query" && !matchesRepositoryQuery(toSearchable(record), limits.query)) return false;
  if (except !== "qubits" && checkNumericLimit(record, "Qubits", limits.maxQubits).verdict === "violated") return false;
  if (except !== "depth" && checkNumericLimit(record, "Depth", limits.maxDepth).verdict === "violated") return false;
  // dataSize never excludes (see checkDataSize) — nothing to check here.
  if (
    except !== "hardwareEra" &&
    checkHardwareEra(record, limits.hardwareEra, estimatesAvailable).verdict === "violated"
  ) {
    return false;
  }
  return true;
}

/** Records with more *satisfied* limits first; then a runnable worked example; then title, then slug for a stable order. */
function compareMatches(a: FinderMatch, b: FinderMatch): number {
  if (a.satisfiedCount !== b.satisfiedCount) return b.satisfiedCount - a.satisfiedCount;
  const heroA = a.record.studioExampleId !== null ? 0 : 1;
  const heroB = b.record.studioExampleId !== null ? 0 : 1;
  if (heroA !== heroB) return heroA - heroB;
  const titleCompare = a.record.title.localeCompare(b.record.title);
  if (titleCompare !== 0) return titleCompare;
  return a.record.slug.localeCompare(b.record.slug);
}

const CRITERION_KEYS: readonly FinderCriterionKey[] = [
  "problem",
  "query",
  "qubits",
  "depth",
  "hardwareEra",
];

/**
 * Filter and rank `records` against `limits`.
 *
 * `estimatesAvailable` says whether `FinderRecord.estimate` reflects a real
 * catalog-API answer (`getRepositoryEstimates()` returned non-null) as
 * opposed to the estimator simply not being wired in this environment
 * (`MAJORANA_PUBLIC_CATALOG_API` off) — see `checkHardwareEra`.
 */
export function findMethods(
  records: readonly FinderRecord[],
  limits: FinderLimits,
  estimatesAvailable: boolean,
): FinderOutcome {
  const matches: FinderMatch[] = [];
  for (const record of records) {
    if (!passesExcept(record, limits, estimatesAvailable, null)) continue;
    const criteria = buildCriteria(record, limits, estimatesAvailable);
    const satisfiedCount = criteria.filter((c) => c.verdict === "satisfied").length;
    matches.push({ record, criteria, satisfiedCount });
  }
  matches.sort(compareMatches);

  const excludedByOnly = Object.fromEntries(
    CRITERION_KEYS.map((key) => [
      key,
      records.filter(
        (record) =>
          passesExcept(record, limits, estimatesAvailable, key) &&
          !passesExcept(record, limits, estimatesAvailable, null),
      ).length,
    ]),
  ) as Record<FinderCriterionKey, number>;

  return { matches, excludedByOnly };
}

/** Domain-facet options for the problem picker, counted against `records`. Reuses the same vocabulary `topic-filter.ts` groups as "domain". */
export interface FinderProblemOption {
  id: TopicId;
  label: string;
  labelJa: string;
  definition: string;
  definitionJa: string;
  count: number;
}

export function finderProblemOptions(
  records: readonly { topics: readonly TopicId[] }[],
): FinderProblemOption[] {
  const counts = new Map<TopicId, number>();
  for (const record of records) {
    for (const topic of new Set(record.topics)) {
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }
  return topicsInFacet("domain")
    .map((topic) => {
      // `topicsInFacet` returns `Topic[]`, whose `id` field is typed as the
      // general `string` even though every element actually comes from
      // `PUBLIC_REPOSITORY_TOPICS` (a `TopicId` by construction). This narrows
      // the TYPE only — it validates nothing new.
      const id = topic.id as TopicId;
      return {
        id,
        label: topic.label,
        labelJa: topic.labelJa,
        definition: topic.definition,
        definitionJa: topic.definitionJa,
        count: counts.get(id) ?? 0,
      };
    })
    .filter((option) => option.count > 0);
}

/**
 * Joins one list-projection catalog record with its estimate (if any) and its
 * worked-example hero id (if any) into a `FinderRecord`.
 *
 * Server-only by convention, not by import restriction: `studioExampleId` is
 * meant to come from `resolveWorkedExamples(slug).hero?.id ?? null`
 * (`worked-example-resolution.ts`), which that module's own header says to
 * call only from a Server Component. This function itself imports nothing
 * server-only, so it stays reachable from `node --test`; the page passes the
 * id in already resolved.
 */
export function buildFinderRecord(
  entry: PublicRepositoryListEntry,
  estimate: FinderEstimate | null,
  studioExampleId: string | null,
): FinderRecord {
  return {
    slug: entry.slug,
    title: entry.title,
    titleJa: entry.titleJa,
    description: entry.description,
    descriptionJa: entry.descriptionJa,
    algorithmFamily: entry.algorithmFamily,
    categoryLabel: entry.categoryLabel,
    categoryLabelJa: entry.categoryLabelJa,
    provenance: entry.provenance,
    framework: entry.framework,
    tags: entry.tags,
    topics: entry.topics ?? [],
    resources: entry.resources,
    portableCircuitQubits: entry.portableCircuit?.qubitCount ?? null,
    studioExampleId,
    estimate,
  };
}

/** `getRepositoryEstimates()`'s per-slug rows, reduced to what `FinderRecord.estimate` carries. */
export function estimatesBySlug(
  estimates: RepositoryEstimateList | null,
): ReadonlyMap<string, FinderEstimate> {
  const map = new Map<string, FinderEstimate>();
  if (!estimates) return map;
  for (const row of estimates.estimates) {
    map.set(row.slug, { basis: row.basis, totalPhysicalQubits: row.totalPhysicalQubits, seconds: row.seconds });
  }
  return map;
}
