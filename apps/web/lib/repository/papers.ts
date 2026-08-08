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
// no metadata of its own. That is a shape change to 283 records that production
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
import type { SourceCoverage } from "./types";

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
  const trimmed = url.trim();
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

/** The address the register publishes for an id. One paper, one link. */
export function canonicalPaperUrl(id: PaperId): string {
  if (id.startsWith("arxiv:")) return `https://arxiv.org/abs/${id.slice("arxiv:".length)}`;
  return `https://doi.org/${id.slice("doi:".length)}`;
}

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
   * What this paper reports, on the three axes `SourceCoverage` already names.
   *
   * **Absent on every row today, and absent means nobody has read it for this.**
   * The owner asked for theory and experimentation to be distinguishable, and
   * this is where that fact belongs — on the *paper*, once, rather than on each
   * of the up to 20 records citing it. That reframes the size of the job: it is
   * 143 source reads rather than 283 record reads, and each one is answerable
   * from the abstract.
   *
   * Never derived. A classifier over abstracts would produce 143 confident
   * labels nobody checked, on the field whose entire purpose is to say what was
   * actually done.
   */
  reports?: SourceCoverage;
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
  }
  // Two rows with the same title and year are almost always one paper reached by
  // two ids — a preprint and its journal DOI. Reported rather than refused,
  // because it is occasionally genuine (a paper and its published erratum), and
  // because refusing it would block a legitimate arXiv/DOI pair a reader wants
  // both of. It is the thing to look at when the register grows.
  const byTitle = new Map<string, PaperId[]>();
  for (const paper of register.papers) {
    const key = `${paper.title.toLowerCase().replace(/\W+/g, " ").trim()}|${paper.year}`;
    byTitle.set(key, [...(byTitle.get(key) ?? []), paper.id]);
  }
  for (const [, ids] of byTitle) {
    if (ids.length > 1) errors.push(`the same title and year appear under ${ids.join(" and ")}`);
  }
  return errors;
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
  return audit;
}
