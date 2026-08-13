// One register of papers, and the rule that a paper has one set of metadata.
//
// > *"think and plan about how we go about putting rest of papers and future
// > academic corpus into repository and map."*
// > — owner, session-98 inbox
//
// ## The measurement that made this a module rather than a convention
//
// Counted across the published corpus and the layer graph on 2026-08-08, before
// any of this existed:
//
// | | |
// |---|---|
// | citation objects | **438** |
// | distinct papers they name | **143** |
// | papers whose copies disagree with each other on title, authors or year | **11** |
// | papers whose recorded title is **not the paper's title** | **14** |
//
// Every citation carried its own `{title, authors, year, url}`, written by hand
// beside the record that cited it. At three copies per paper that is not a
// storage question, it is a **correctness** one, and the corpus had already
// crossed the line: `1812.11173` was recorded as *"A Quantum-Classical Algorithm
// for Molecular Properties Near Term Quantum Devices"* and is actually
// *"An adaptive variational algorithm for exact molecular simulations on a
// quantum computer"* — a different, real paper. `quant-ph/0010033` was recorded
// as *"A one-way quantum computer"*, which is also a different, real
// Raussendorf–Briegel paper. Nielsen & Chuang was cited **38 times under two
// different URLs, three titles, two author formats and two year strings.**
//
// None of that is catchable by a rule that looks at one citation, and all of it
// is trivially catchable by a rule that looks at two. `validateLayerGraph`
// already had the two-copy rule *within* the graph; the corpus had nothing, and
// nothing at all compared the two sides. Now one register does both.
//
// ## Why it is a register rather than a normalisation, for now
//
// The end state is that a citation is `{paper: PaperId, relevance}` and carries
// no metadata of its own. That is a shape change to every record that production
// serves from the catalog API, so it is a two-part deploy and its own PR. What
// lands here gets the whole correctness benefit without the shape change: the
// citations keep their fields, **and a script asserts every one of them equals
// the register row**. Drift is impossible either way; only the byte count
// differs. See `plans/leona-map-scaling-rules.md` §5 for the sequencing.
//
// ## The identity rule, which is the part that has to survive thousands of papers
//
// A URL is not an identity. `arxiv.org/abs/2011.03185`, `.../abs/2011.03185v2`,
// `arxiv.org/pdf/2011.03185`, `link.aps.org/doi/10.1103/X` and `doi.org/10.1103/X`
// are five strings for at most two papers. `paperId` collapses them, and it is
// the only thing anything may key on — a corpus that grows to thousands of
// papers acquires every one of those variants, and a register keyed on the
// string it was first written with silently splits a paper in two.
import type { SourceCoverage, SourceCoverageAxis, SourceCoverageStatus } from "./types";
// Extensioned on purpose: `node --test` resolves specifiers literally, so an
// extensionless *runtime* import here takes every test that reaches this module
// down with `ERR_MODULE_NOT_FOUND`. The `import type` line above is erased
// before it runs and does not have the problem, which is why the two lines
// disagree.
import { SOURCE_COVERAGE_AXES, SOURCE_COVERAGE_STATUSES } from "./types.ts";

/**
 * `arxiv:<id>` or `doi:<lowercased doi>`.
 *
 * Two schemes and no more, deliberately: every source in the corpus is one or
 * the other, and a third would have to be a decision somebody makes rather than
 * a URL nobody could parse. `paperIdFromUrl` returns `null` for anything else
 * and validation refuses it, so an unparseable source fails the build instead of
 * becoming its own unjoinable island in the register.
 */
export type PaperId = string;

export const PAPER_ID_SCHEMES = ["arxiv", "doi"] as const;

/**
 * The canonical id for a source URL, or `null` if this is not an address the
 * register can key on.
 *
 * arXiv ids keep their native form — both the modern `2011.03185` and the
 * pre-2007 `quant-ph/9508027` — because that is what the id *is*, and rewriting
 * one into the other would make the register's keys stop matching the arXiv API.
 * The version suffix is dropped: `v1` and `v3` are the same paper, and pinning a
 * version in a citation would make two records citing different revisions look
 * like two papers.
 */
export function paperIdFromUrl(url: string): PaperId | null {
  // A query string and a fragment are navigation, never identity.
  // `arxiv.org/abs/X?context=quant-ph` and `doi.org/10.1/x#sec3` are the paper,
  // and without this the trailing `\S+` swallows them into the key — which makes
  // one paper two rows, or unregisters a citation somebody pasted from a search
  // result. Stripped before matching so both schemes get it.
  const trimmed = url.trim().replace(/[?#].*$/, "");
  const arxiv = /^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/(.+?)(?:v\d+)?(?:\.pdf)?$/i.exec(
    trimmed,
  );
  if (arxiv) return `arxiv:${arxiv[1]}`;
  // `link.aps.org/doi/…`, `dl.acm.org/doi/…` and friends are a publisher's
  // front door to a DOI. Matching the DOI rather than the host is what stops one
  // paper becoming two rows the day somebody pastes the other link.
  const doi = /^https?:\/\/(?:[a-z0-9.-]+\/)?doi(?:\.org)?\/(10\.\d{4,9}\/\S+)$/i.exec(trimmed);
  if (doi) return `doi:${doi[1].toLowerCase()}`;
  return null;
}

/**
 * The URL segment for a paper on this site — `/repository/papers/<slug>`.
 *
 * A `PaperId` cannot be a route segment as it stands: it carries a `:` and, for
 * every pre-2007 arXiv id and every DOI, a `/`. A segment containing a slash is
 * two segments, and the page 404s.
 *
 * The mapping is `:` → `-` and `/` → `_`, and it is **checked rather than
 * proved**. Nothing in the DOI grammar forbids an underscore, so a future row
 * could in principle collide with another row's slug or fail to round-trip.
 * `validatePaperRegister` refuses both, over the whole register, so the day it
 * happens the build says so instead of serving one paper at another's address —
 * which is the same failure the identity rule exists to stop, one layer up.
 */
export function paperSlug(id: PaperId): string {
  return id.replace(":", "-").replaceAll("/", "_");
}

/** The inverse of `paperSlug`, or `null` if this is not a slug shape. */
export function paperIdFromSlug(slug: string): PaperId | null {
  const separator = slug.indexOf("-");
  if (separator <= 0) return null;
  const scheme = slug.slice(0, separator);
  if (!PAPER_ID_SCHEMES.includes(scheme as (typeof PAPER_ID_SCHEMES)[number])) return null;
  return `${scheme}:${slug.slice(separator + 1).replaceAll("_", "/")}`;
}

/** The address the register publishes for an id. One paper, one link. */
export function canonicalPaperUrl(id: PaperId): string {
  if (id.startsWith("arxiv:")) return `https://arxiv.org/abs/${id.slice("arxiv:".length)}`;
  return `https://doi.org/${id.slice("doi:".length)}`;
}

/**
 * What kind of document a register row is. **Both are primary sources.**
 *
 * Owner ruling, `EshMis/ai-ops` issue #44,
 * https://github.com/EshMis/ai-ops/issues/44#issuecomment-5269393488, EshMis
 * (OWNER), 2026-08-12T16:13:38Z: *"ALSO, put this in memory: textbooks are also
 * primary sources!!"* — answering the primary-source-first ruling on #12, which
 * on its own reads as "a paper or nothing".
 *
 * ## Why this is a field and not a sentence in a doc comment
 *
 * The register keys on `arxiv:` and `doi:` and nothing else, so a textbook with
 * a publisher DOI has *always* been able to sit in it. Nothing here was
 * blocking a textbook, and that is exactly the problem: nothing distinguished
 * one either. A row for a 400-page book was indistinguishable from a row for a
 * 6-page letter, so the next pass that asks "is this record traceable to a
 * primary source?" had nothing to read and would answer from the row's *shape*
 * — and a textbook does not look like a paper. This project's recurring defect
 * is a value that is wrong but well-formed; "scrapped for not being a paper"
 * is that defect with a record deleted at the end of it.
 *
 * So the ruling is a value the code carries, with three things resting on it:
 * `validatePaperRegister` refuses an unknown medium; it also refuses a book DOI
 * whose row does not say so, so the set of textbooks is enumerated rather than
 * guessed at (see `TEXTBOOK_DOI_PREFIXES`); and
 * `scripts/check-paper-register.mjs` prints the textbook count and every
 * textbook-sourced record on each CI run, so the set is visible rather than
 * inferred by the next person deciding what counts as traceable.
 *
 * Absent means `"article"`. That is the majority and stating it 232 times would
 * bury the 2 rows the distinction exists for.
 */
export const PRIMARY_SOURCE_MEDIA = ["article", "textbook"] as const;

export type PrimarySourceMedium = (typeof PRIMARY_SOURCE_MEDIA)[number];

/**
 * DOI registrant prefixes that only ever mint book identifiers, used to catch a
 * textbook row somebody forgot to tag.
 *
 * `10.1017/cbo…` and `10.1017/9781…` are Cambridge University Press's book
 * DOIs — Cambridge's *journal* DOIs are `10.1017/S…`. The check is deliberately
 * one-directional: it can prove a row IS a book and never that a row is not, so
 * it warns on an untagged book and says nothing about anything else. A future
 * textbook from a publisher not on this list is tagged by hand, and this list
 * does not pretend otherwise.
 */
const TEXTBOOK_DOI_PREFIXES = ["doi:10.1017/cbo", "doi:10.1017/9781"] as const;

export interface RegisteredPaper {
  id: PaperId;
  title: string;
  /** Every author, in the order the source lists them. Never truncated here. */
  authors: string;
  /**
   * Four digits.
   *
   * **The year of the thing the URL resolves to**, which for an arXiv address is
   * the v1 submission year and not the journal year. Stated as a rule because it
   * was not one: 29 papers carried their journal year and 98 carried their arXiv
   * year, so HHL was 2009 in the Atlas and 2008 on the map, and both were
   * defensible. One convention, chosen because it is the one a reader can check
   * by following the link that is right there.
   */
  year: string;
  url: string;
  /**
   * `"textbook"` where this row is a book rather than an article. Absent means
   * `"article"`. **Neither is less primary than the other** — see
   * `PRIMARY_SOURCE_MEDIA` for the ruling this encodes and why it is a value
   * rather than a paragraph.
   */
  medium?: PrimarySourceMedium;
  /**
   * What this paper reports, on the three axes `SourceCoverage` already names.
   *
   * **Absent means nobody has read this paper for this.** The owner asked for
   * theory and experimentation to be distinguishable, and this is where that
   * fact belongs — on the *paper*, once, rather than on each of the up to 20
   * records citing it. That reframes the size of the job: it is a read per
   * paper rather than per record, and each one is answerable from the abstract.
   *
   * Never derived. A classifier over abstracts would produce confident labels
   * nobody checked, on the field whose entire purpose is to say what was
   * actually done.
   *
   * ## The rule the populated rows were filled by, stated because it is not
   * ## symmetric across the three axes and pretending it were would be a lie
   *
   * Every populated row was filled by fetching the source's own abstract and
   * reading it. That evidence is **much stronger on one axis than the other
   * two**, so the axes do not get the same treatment:
   *
   * - **hardware** — `reported` when the abstract says the work ran on a
   *   device, `absent` otherwise. A hardware demonstration is headline material
   *   and does not hide below the abstract, so the negative is well founded.
   *   This is the axis the owner's theory-vs-experimentation question actually
   *   turns on.
   * - **theory** — `reported` when the abstract claims theorems, complexity
   *   bounds or proved constructions; `absent` when the abstract characterises
   *   the work as an experiment or a tool and claims none.
   * - **simulation** — `reported` when the abstract (or the arXiv comment)
   *   states numerics, benchmarks or numerical experiments; **`unknown`
   *   otherwise, never `absent`.** Numerics routinely sit in a section the
   *   abstract does not mention, so "the abstract did not say" is genuinely not
   *   "the paper does not have any". This is why `simulation` carries most of
   *   the `unknown`s in the register, and the census prints that per axis
   *   rather than letting one number stand for all three.
   *
   * Upgrading a row from an abstract read to a full-text read is a normal edit:
   * change the values and change `reportsBasis` with them.
   */
  reports?: SourceCoverage;
  /**
   * What was read to fill `reports`. Required whenever `reports` is present,
   * and refused when it is not (`validatePaperRegister`).
   *
   * A judgement without its evidence is the thing this whole module exists to
   * stop one level down: `reports` says *what the paper does*, and without this
   * a reader cannot tell a claim backed by the abstract from one backed by the
   * paper. The two are different strengths — see the `reports` rule above,
   * where the abstract basis is what forces `simulation` to `unknown`.
   */
  reportsBasis?: ReportsBasis;
}

/**
 * How much of a paper was read to fill `reports`.
 *
 * Two values and no "partial": a basis a reader cannot act on is not a basis.
 */
export const REPORTS_BASES = ["abstract", "full-text"] as const;
export type ReportsBasis = (typeof REPORTS_BASES)[number];

export interface ReportsCensus {
  papers: number;
  /** Rows carrying a `reports` judgement at all. */
  read: number;
  byBasis: Record<ReportsBasis, number>;
  /** Per axis, how the populated rows fall. The denominator is `read`. */
  byAxis: Record<SourceCoverageAxis, Record<SourceCoverageStatus, number>>;
}

/**
 * The census, printed rather than summarised to one number.
 *
 * "82 of 143 read" hides that `hardware` is decided on all 82 and `simulation`
 * is open on most of them. Three axes that were filled by different rules have
 * to be counted by different columns or the weakest one rides on the
 * strongest's number.
 */
export function reportsCensus(register: PaperRegister): ReportsCensus {
  const byAxis = Object.fromEntries(
    SOURCE_COVERAGE_AXES.map((axis) => [
      axis,
      Object.fromEntries(SOURCE_COVERAGE_STATUSES.map((status) => [status, 0])),
    ]),
  ) as ReportsCensus["byAxis"];
  const byBasis = Object.fromEntries(REPORTS_BASES.map((basis) => [basis, 0])) as Record<
    ReportsBasis,
    number
  >;
  let read = 0;
  for (const paper of register.papers) {
    if (!paper.reports) continue;
    read += 1;
    if (paper.reportsBasis) byBasis[paper.reportsBasis] += 1;
    for (const axis of SOURCE_COVERAGE_AXES) byAxis[axis][paper.reports[axis]] += 1;
  }
  return { papers: register.papers.length, read, byBasis, byAxis };
}

export interface PaperRegister {
  papers: readonly RegisteredPaper[];
}

export function indexPapers(register: PaperRegister): ReadonlyMap<PaperId, RegisteredPaper> {
  return new Map(register.papers.map((paper) => [paper.id, paper]));
}

/** Structural rules on the register itself, independent of who cites it. */
export function validatePaperRegister(register: PaperRegister): string[] {
  const errors: string[] = [];
  const seen = new Set<PaperId>();
  // Two rows whose slugs agree would put one paper at the other's address, and
  // the loser is unreachable while the route still returns 200. Checked over
  // the whole register because a slug collision is a property of the *set*, and
  // no per-row rule can see it.
  const bySlug = new Map<string, PaperId>();
  for (const paper of register.papers) {
    const slug = paperSlug(paper.id);
    const other = bySlug.get(slug);
    if (other !== undefined && other !== paper.id) {
      errors.push(`${paper.id}: its url segment "${slug}" is already ${other}'s`);
    }
    bySlug.set(slug, paper.id);
    if (paperIdFromSlug(slug) !== paper.id) {
      errors.push(`${paper.id}: does not survive a round trip through its url segment "${slug}"`);
    }
  }
  for (const paper of register.papers) {
    if (seen.has(paper.id)) errors.push(`${paper.id}: listed twice`);
    seen.add(paper.id);
    if (!PAPER_ID_SCHEMES.some((scheme) => paper.id.startsWith(`${scheme}:`))) {
      errors.push(`${paper.id}: not an ${PAPER_ID_SCHEMES.join(" or ")} id`);
    }
    // The url and the id must not be able to disagree — a row whose link points
    // somewhere its own key does not is the exact failure this module exists to
    // stop, reintroduced one level up.
    if (paper.url !== canonicalPaperUrl(paper.id)) {
      errors.push(`${paper.id}: url is ${paper.url}, not ${canonicalPaperUrl(paper.id)}`);
    }
    if (paperIdFromUrl(paper.url) !== paper.id) {
      errors.push(`${paper.id}: its own url does not parse back to its id`);
    }
    for (const [field, value] of [
      ["title", paper.title],
      ["authors", paper.authors],
    ] as const) {
      if (typeof value !== "string" || value.trim() === "") {
        errors.push(`${paper.id}: ${field} is empty`);
      }
    }
    if (!/^\d{4}$/.test(paper.year)) {
      errors.push(`${paper.id}: year is not four digits — ${JSON.stringify(paper.year)}`);
    }
    // A typo'd medium is the failure mode this field exists to stop, arriving
    // through the field itself: `"book"` or `"Textbook"` is falsy against every
    // comparison downstream and so reads as `"article"` — the row goes back to
    // being indistinguishable from a paper while looking tagged.
    if (paper.medium !== undefined && !PRIMARY_SOURCE_MEDIA.includes(paper.medium)) {
      errors.push(
        `${paper.id}: medium is ${JSON.stringify(paper.medium)}, not one of ${PRIMARY_SOURCE_MEDIA.join(", ")}`,
      );
    }
    // An untagged book. See `TEXTBOOK_DOI_PREFIXES` for why this can only fire
    // one way. It is an error rather than a warning because the whole value of
    // `medium` is that the set of textbooks is *enumerated* rather than guessed
    // at by whoever reads the register next — and a warning is a thing CI
    // prints and nobody reads.
    if (
      paper.medium !== "textbook" &&
      TEXTBOOK_DOI_PREFIXES.some((prefix) => paper.id.toLowerCase().startsWith(prefix))
    ) {
      errors.push(
        `${paper.id}: this is a book DOI and the row does not say medium: "textbook" — a textbook is a primary source (ai-ops#44) and must be findable as one`,
      );
    }
    // `reports` and `reportsBasis` stand or fall together, in **both**
    // directions. A judgement with no basis is a claim whose strength nobody
    // can weigh; a basis with no judgement says a paper was read and records
    // nothing, which is a row that will read as "unread" forever while
    // asserting it was read.
    if (paper.reports && !paper.reportsBasis) {
      errors.push(`${paper.id}: reports is recorded with no reportsBasis — say what was read`);
    }
    if (paper.reportsBasis && !paper.reports) {
      errors.push(`${paper.id}: reportsBasis is recorded with no reports — nothing was written down`);
    }
    if (paper.reportsBasis && !REPORTS_BASES.includes(paper.reportsBasis)) {
      errors.push(
        `${paper.id}: reportsBasis is ${JSON.stringify(paper.reportsBasis)}, not one of ${REPORTS_BASES.join(", ")}`,
      );
    }
    if (paper.reports) {
      for (const axis of SOURCE_COVERAGE_AXES) {
        if (!SOURCE_COVERAGE_STATUSES.includes(paper.reports[axis])) {
          errors.push(
            `${paper.id}: reports.${axis} is ${JSON.stringify(paper.reports[axis])}, not one of ${SOURCE_COVERAGE_STATUSES.join(", ")}`,
          );
        }
      }
      // The reading rule in `reports`' doc comment says an abstract cannot
      // support "this paper runs no numerics" — numerics hide below an
      // abstract routinely. Without this, the next pass fills 60 rows with
      // `simulation: absent` from an abstract and the field quietly becomes a
      // guess, which is the one thing it exists not to be.
      if (paper.reportsBasis === "abstract" && paper.reports.simulation === "absent") {
        errors.push(
          `${paper.id}: reports.simulation is "absent" on an abstract read — an abstract that omits numerics is not a paper without them, so this must be "unknown" until someone reads the full text`,
        );
      }
    }
  }
  return errors;
}

/**
 * Things worth looking at that are **not** failures.
 *
 * Separate from `validatePaperRegister` and separately returned, because the one
 * item in here says so in its own reasoning and the first draft pushed it into
 * `errors` anyway — so the script exited non-zero on a case the comment called
 * legitimate. A diagnostic whose text argues for tolerance and whose call site
 * refuses is worse than either choice made cleanly.
 *
 * Two rows with the same title and year are usually one paper reached by two ids
 * — a preprint and its journal DOI — and occasionally genuine (a paper beside its
 * published erratum). Refusing it would block a legitimate arXiv/DOI pair a
 * reader wants both of. It is the thing to look at as the register grows, and the
 * script prints it without failing.
 */
export function paperRegisterWarnings(register: PaperRegister): string[] {
  const warnings: string[] = [];
  const byTitle = new Map<string, PaperId[]>();
  for (const paper of register.papers) {
    const key = `${paper.title.toLowerCase().replace(/\W+/g, " ").trim()}|${paper.year}`;
    byTitle.set(key, [...(byTitle.get(key) ?? []), paper.id]);
  }
  for (const [, ids] of byTitle) {
    if (ids.length > 1) {
      warnings.push(`the same title and year appear under ${ids.join(" and ")} — one paper, two ids?`);
    }
  }
  return warnings;
}

/** One recorded citation, wherever it lives. */
export interface CitationRef {
  /** `entry:<slug>` or `node:<id>` — where the reader would go to fix it. */
  where: string;
  title: string;
  authors: string;
  year: string;
  url: string;
}

export interface CitationAudit {
  /** Citations whose URL the register cannot key on at all. */
  unparseable: CitationRef[];
  /** Citations naming a paper the register does not carry. */
  unregistered: CitationRef[];
  /** Citations whose metadata differs from the register row. */
  drifted: Array<{ citation: CitationRef; field: "title" | "authors" | "year" | "url"; expected: string }>;
  /** Register rows nothing cites. Not an error — see the doc comment. */
  uncited: PaperId[];
  /** Papers cited from both an Atlas record and a map node. */
  shared: PaperId[];
  /**
   * Papers a map node cites, sorted.
   *
   * The prioritisation set for every source-read pass: these are the papers a
   * process page will ever show, so they are the ones `reports` is filled on
   * first. Published as data rather than left as a `grep`, so the scripts and
   * any surface agree on which set that is.
   */
  citedByNode: PaperId[];
  /**
   * Papers an Atlas record cites, sorted.
   *
   * Published beside `citedByNode` because the pair is the measurement the
   * whole ingestion plan is aimed at — two bibliographies of one field, and
   * `shared` is where they meet. It was carried in prose in
   * `plans/leona-map-scaling-rules.md` and was **wrong by one** (68 for 67)
   * within a day of being written, which is the argument for computing it.
   */
  citedByEntry: PaperId[];
}

/**
 * Every recorded citation, against the one register.
 *
 * `uncited` is reported and never failed. A register row with no citation is a
 * paper somebody read and has not yet placed, which is the normal state of an
 * ingestion queue and the opposite of a defect — the register is meant to run
 * ahead of the map. A row that is wrong is a different thing and is caught by
 * `validatePaperRegister`.
 *
 * `shared` is the substrate for the owner's "papers as traces": a paper cited by
 * both a node and a record is one the map and the Atlas already agree about, and
 * there were **8** of 143 when this was written.
 */
export function auditCitations(
  citations: readonly CitationRef[],
  register: PaperRegister,
): CitationAudit {
  const byId = indexPapers(register);
  const audit: CitationAudit = {
    unparseable: [],
    unregistered: [],
    drifted: [],
    uncited: [],
    shared: [],
    citedByNode: [],
    citedByEntry: [],
  };
  const citedFromEntry = new Set<PaperId>();
  const citedFromNode = new Set<PaperId>();
  for (const citation of citations) {
    const id = paperIdFromUrl(citation.url);
    if (id === null) {
      audit.unparseable.push(citation);
      continue;
    }
    const paper = byId.get(id);
    if (!paper) {
      audit.unregistered.push(citation);
      continue;
    }
    if (citation.where.startsWith("node:")) citedFromNode.add(id);
    else citedFromEntry.add(id);
    for (const field of ["title", "authors", "year", "url"] as const) {
      if (citation[field] !== paper[field]) {
        audit.drifted.push({ citation, field, expected: paper[field] });
      }
    }
  }
  const cited = new Set([...citedFromEntry, ...citedFromNode]);
  audit.uncited = register.papers.map((paper) => paper.id).filter((id) => !cited.has(id));
  audit.shared = [...citedFromEntry].filter((id) => citedFromNode.has(id)).sort();
  audit.citedByNode = [...citedFromNode].sort();
  audit.citedByEntry = [...citedFromEntry].sort();
  return audit;
}
