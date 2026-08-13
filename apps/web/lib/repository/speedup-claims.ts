// Where this repository's own sources do not back the class the Zoo files them under.
//
// ## The finding, and why it had nowhere to live
//
// Every Zoo-parity record carries a `speedup` quoted from the Quantum Algorithm
// Zoo, and a `speedupPrimary` saying what the record's **own primary paper** says
// about that class. Seven of them say `absent`: somebody read the paper the Zoo
// cites and it does not state the class. `gauss-sum-estimation` is the clearest —
// the Zoo files it Superpolynomial and van Dam and Seroussi decline to prove
// classical hardness, leaving it open in their own conclusion.
//
// That is the most interesting thing this corpus has produced and until now it
// existed in two places a reader cannot reach: a sentence inside each record's
// `caveat`, and a census comment inside a lint script. It counted toward no
// fraction and appeared on no page.
//
// ## The rule this module exists to enforce
//
// **The denominator comes first.** "Seven records disagree with the Zoo" reads as
// seven out of seven unless the 31 unchecked are on the page beside them, and the
// unchecked are the majority. So `speedupClaimCensus` returns all three groups and
// the surface renders all three; there is no accessor that hands out the finding
// alone.
//
// ## What these rows do NOT claim
//
// Not "the Zoo is wrong". Each is the narrower statement that **a named paper does
// not contain a named claim**, scoped to the text somebody actually opened — which
// is why `read` is required on an `absent` and is rendered beside every row. The
// Zoo may have taken the class from somewhere else entirely, and on two of the
// seven it demonstrably did: Hallgren's STOC paper states no classical running
// time where his J. ACM paper states one in L-notation, so the same author
// supports the class in one venue and not in the other.
//
// ## Why this module imports no corpus
//
// `ZOO_SPEEDUP_PROVENANCE` is passed in rather than imported. The corpus modules
// use extensionless relative imports, which esbuild and Next resolve and the web
// test runner (`node --experimental-strip-types`) does not — so a module that
// reaches the corpus is a module no test in `apps/web` can load. The invariants
// that need the real data (an `absent` naming what was read, a `reported` with a
// quote behind it) are checked over the whole corpus by
// `scripts/check-zoo-parity.mjs`, which bundles it. This file keeps the shape
// and the sentence, which is the half that can be asserted here.
import type { PublicLocale } from "../public-locale.ts";

/**
 * A record's speedup class and what its own primary paper says about it.
 *
 * Declared structurally rather than as `typeof ZOO_SPEEDUP_PROVENANCE[number]`
 * for the import reason above. TypeScript still checks the two against each
 * other at the call site in the page, so they cannot drift silently.
 */
export interface SpeedupProvenance {
  slug: string;
  title: string;
  titleJa: string;
  zooName: string;
  zooSection: string;
  speedup: string;
  source: { id: string; title: string; authors: string; year: string; url: string };
  primary:
    | { states: "reported"; quote: string }
    | { states: "absent"; read: string }
    | { states: "unknown" };
}

export interface SpeedupClaimRow {
  slug: string;
  title: string;
  titleJa: string;
  /** The Zoo entry this record covers, verbatim. */
  zooName: string;
  zooSection: string;
  /** The Zoo's class for that entry, verbatim. Never this repository's claim. */
  speedup: string;
  /** The record's own primary paper. */
  source: SpeedupProvenance["source"];
}

/** A record whose primary source states a comparable claim, with the source's own words. */
export interface SpeedupReportedRow extends SpeedupClaimRow {
  quote: string;
}

/**
 * A record whose primary source, in the text named by `read`, states no such claim.
 *
 * `read` is not decoration. "The paper does not say it" is only ever as wide as
 * the text somebody opened, and an abstract is not a paper.
 */
export interface SpeedupAbsentRow extends SpeedupClaimRow {
  read: string;
}

export interface SpeedupClaimCensus {
  /** Every record carrying a class quoted from the Zoo. The denominator. */
  records: number;
  reported: readonly SpeedupReportedRow[];
  absent: readonly SpeedupAbsentRow[];
  /** Nobody has checked these against their primary source. The worklist, named. */
  unchecked: readonly SpeedupClaimRow[];
}

const base = (row: SpeedupProvenance): SpeedupClaimRow => ({
  slug: row.slug,
  title: row.title,
  titleJa: row.titleJa,
  zooName: row.zooName,
  zooSection: row.zooSection,
  speedup: row.speedup,
  source: row.source,
});

/**
 * The whole census, always. There is deliberately no `absentClaims()` helper: a
 * caller that could ask for the finding without the denominator would eventually
 * be written, and the page it produced would be the misreading this module is for.
 */
export function speedupClaimCensus(provenance: readonly SpeedupProvenance[]): SpeedupClaimCensus {
  const reported: SpeedupReportedRow[] = [];
  const absent: SpeedupAbsentRow[] = [];
  const unchecked: SpeedupClaimRow[] = [];
  for (const row of provenance) {
    if (row.primary.states === "reported") reported.push({ ...base(row), quote: row.primary.quote });
    else if (row.primary.states === "absent") absent.push({ ...base(row), read: row.primary.read });
    else unchecked.push(base(row));
  }
  return { records: provenance.length, reported, absent, unchecked };
}

/**
 * The one sentence on the surface that carries the counts.
 *
 * It lives here rather than in the view because it is the load-bearing text on
 * that page and the view cannot be tested — the web test runner strips types but
 * has no JSX transform. A sentence nothing can assert against is a sentence that
 * silently loses its denominator the first time somebody shortens it.
 *
 * **The total comes before the finding, and a test asserts that ordering.** Lead
 * with "7 records disagree" and a reader takes it for 7 of 7; the unchecked group
 * is the largest and has to be in the same breath.
 */
export function speedupCensusSentence(census: SpeedupClaimCensus, locale: PublicLocale): string {
  if (locale === "ja") {
    return `${census.records} 件の記録が Quantum Algorithm Zoo から引用した速度向上の区分を掲げています。`
      + `うち ${census.reported.length} 件は一次資料と照合済みで、同等の主張が記載されています。`
      + `${census.absent.length} 件は照合済みで、記載がありませんでした。`
      + `残る ${census.unchecked.length} 件は未照合です。`
      + "最後の一群がもっとも多く、これは判定ではなく作業予定です。";
  }
  return `${census.records} records carry a speedup class quoted from the Quantum Algorithm Zoo.`
    + ` ${census.reported.length} have been checked against their own primary paper and it states a comparable`
    + ` claim; ${census.absent.length} have been checked and it does not; ${census.unchecked.length} have not`
    + " been checked. The last group is the largest, and it is a worklist rather than a verdict.";
}
