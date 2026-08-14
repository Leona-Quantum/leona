#!/usr/bin/env node
// The Zoo gauge: how much of the Quantum Algorithm Zoo this repository carries.
//
// ## Why this exists
//
// `check-match-gauge.mjs` scores the *map* half of "expand the repository and the
// map until they match, and then beyond" — anchored records, revealing papers,
// undrawn steps. All three of its numbers are internal: they compare the catalog
// with the map, so a catalog that is missing an entire subject area scores a clean
// triple. The repository half needs an outside denominator, and the Quantum
// Algorithm Zoo is the closest thing the field has to one.
//
// First reading, at dev b7b507d1 before the Zoo-parity intake: **8 of 60 covered**.
// The eight were not chosen — they are what a catalog grown from circuit examples
// happens to overlap with a survey of the literature. That is the number this
// gauge exists to make impossible to not know.
//
// ## Two corrections to that sentence, both from 2026-08-13
//
// **The denominator was never 60.** The Zoo has 74 entries; the index generator's
// entry splitter matched one spelling of the label and missed 14, absorbing each
// into the row above it. Every figure this gauge ever printed — 8/60, 19/60,
// 39/60, 57/60, 59/60 — was measured against a denominator missing four subject
// areas, including Adiabatic Algorithms and Machine Learning. See
// ./generate-zoo-index.mjs for the parse and the guard that now catches it.
//
// **And "covered" meant two different things.** 35 of the 74 rows are subject
// headings, not results, and a row went green on one record out of a possible
// twenty-three. Coverage is now three-state — closed, partial, unreviewed — and a
// heading can only ever report partial. ../apps/web/lib/repository/zoo-coverage.ts
// carries the shape of every row and the reason for it.
//
// ## What it fails on, and what it only reports
//
// Report-only: the coverage numbers. A gauge that fails the build gets greened the
// cheapest way, and the cheapest way here is to declare the remainder
// not-applicable — so the counts exit 0 whatever they say. People decide.
//
// Fails (exit 1): a declaration that no longer refers to anything, or a row nobody
// has judged —
//   * a slug declared as covering a Zoo entry that is not in the corpus,
//   * a Zoo entry named in a declaration that is not in the pinned index,
//   * a row of the pinned index with no shape declared,
//   * a row declared `result` or `union` with no reason behind it.
// The first two are how a hand-maintained list rots without anyone seeing it. The
// last two are why the honest number survives the next session: abstaining is a
// typed answer here, so a row cannot be quietly left out to keep the count high.
//
// The Zoo index is pinned (scripts/zoo-parity/zoo-index.json) and refreshed by
// `node scripts/generate-zoo-index.mjs` — see that file for why the fetch is a
// human action with a diff rather than something this check does behind your back.
//
// Usage: node scripts/check-zoo-parity.mjs [--json] [--quiet] [--missing]
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/ts/ui-visual/package.json"));
const esbuild = require("esbuild");

const AS_JSON = process.argv.includes("--json");
const QUIET = process.argv.includes("--quiet");
const SHOW_MISSING = process.argv.includes("--missing");

async function bundle(relativePath, label) {
  const outDir = mkdtempSync(join(tmpdir(), "zoo-parity-"));
  const outFile = join(outDir, `${label}.mjs`);
  try {
    await esbuild.build({
      entryPoints: [join(root, relativePath)],
      bundle: true,
      format: "esm",
      platform: "neutral",
      outfile: outFile,
      logLevel: "silent",
    });
  } catch (error) {
    console.error(`✖ failed to bundle ${relativePath}:`, error.message);
    process.exit(1);
  }
  const mod = await import(pathToFileURL(outFile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

const index = JSON.parse(readFileSync(join(root, "scripts/zoo-parity/zoo-index.json"), "utf8"));
const corpusMod = await bundle("apps/web/lib/public-repository.ts", "public-repository");
const intakeMod = await bundle("apps/web/lib/repository/entries-zoo-parity.ts", "entries-zoo-parity");
const coverageMod = await bundle("apps/web/lib/repository/zoo-coverage.ts", "zoo-coverage");
const papersMod = await bundle("apps/web/lib/repository/papers.ts", "papers");

const { PUBLIC_REPOSITORY_ENTRIES } = corpusMod;
const { ZOO_PARITY_COVERAGE, ZOO_SPEEDUP_PROVENANCE } = intakeMod;
const { ZOO_LEGACY_COVERAGE, ZOO_NOT_APPLICABLE, ZOO_ROW_SHAPE } = coverageMod;
const { paperIdFromUrl } = papersMod;

const corpusSlugs = new Set(PUBLIC_REPOSITORY_ENTRIES.map((entry) => entry.slug));
const zooNames = new Set(index.entries.map((entry) => entry.name));

// slugs claimed per Zoo entry, from both halves of the declaration
const claimed = new Map();
const claim = (zooName, slug, origin) => {
  if (!claimed.has(zooName)) claimed.set(zooName, []);
  claimed.get(zooName).push({ slug, origin });
};
for (const { zooName, slug } of ZOO_PARITY_COVERAGE) claim(zooName, slug, "intake");
for (const [zooName, slugs] of Object.entries(ZOO_LEGACY_COVERAGE)) {
  for (const slug of slugs) claim(zooName, slug, "legacy");
}

const errors = [];
for (const [zooName, claims] of claimed) {
  if (!zooNames.has(zooName)) {
    errors.push(
      `coverage declares Zoo entry "${zooName}" (${claims.map((c) => c.slug).join(", ")}),`
      + " but the pinned index has no entry with that name — the Zoo renamed or removed it,"
      + " or the declaration has a typo. Refresh the index and re-point the declaration.",
    );
  }
  for (const { slug, origin } of claims) {
    if (!corpusSlugs.has(slug)) {
      errors.push(`${origin} coverage of "${zooName}" names slug "${slug}", which is not in the corpus`);
    }
  }
}
for (const zooName of Object.keys(ZOO_NOT_APPLICABLE)) {
  if (!zooNames.has(zooName)) {
    errors.push(`notApplicable declares Zoo entry "${zooName}", which is not in the pinned index`);
  }
  if (claimed.has(zooName)) {
    errors.push(`"${zooName}" is declared both covered and not-applicable — pick one`);
  }
}

// --- the row's shape decides what covering it means -----------------------------
//
// `covered` was a binary predicate over `slugs.length > 0`, and 35 of the Zoo's 74
// rows are subject headings rather than results — "Quantum Cryptanalysis" cites 23
// papers, "Machine Learning" 56. One record covering one strand made the whole
// heading read as closed. See ../apps/web/lib/repository/zoo-coverage.ts for the
// argument; here is the arithmetic it buys:
//
//   closed      the row is one result and something covers it
//   partial     the row is a heading and something covers part of it — never closed
//   unreviewed  nobody has judged the row's shape, or two passes disagreed
//   declined    out of scope, with a reason
//   missing     nothing covers it
//
// A silence is not one of the states. Every row of the pinned index must have a
// shape or this check fails, so the cheapest way to raise the headline is to read
// a Zoo entry rather than to leave one out.
for (const name of Object.keys(ZOO_ROW_SHAPE)) {
  if (!zooNames.has(name)) {
    errors.push(`ZOO_ROW_SHAPE declares "${name}", which is not in the pinned index — the Zoo renamed or removed it`);
  }
}
for (const entry of index.entries) {
  const shape = ZOO_ROW_SHAPE[entry.name];
  if (!shape) {
    errors.push(
      `no shape declared for Zoo row "${entry.name}". Read the entry and say whether it is one result or a`
      + " subject heading — `{ kind: \"unreviewed\" }` is an acceptable answer and an honest one, but silence"
      + " is not, because a row nobody declared is indistinguishable from a row nobody looked at.",
    );
    continue;
  }
  if ((shape.kind === "result" || shape.kind === "union") && !shape.reason?.trim()) {
    errors.push(`Zoo row "${entry.name}" is declared "${shape.kind}" with no reason — a judgement nobody can disagree with`);
  }
}

/**
 * Which of a row's references this repository actually cites.
 *
 * Derived, never declared. The row's references carry arXiv and DOI links; the
 * covering records carry their own `source` and `literature` urls; `paperIdFromUrl`
 * canonicalises both sides so a publisher's front door and an arXiv abs page do not
 * read as two papers. A hand-maintained strand count would be a second thing to keep
 * true, and it would be true on the day it was written and never checked again.
 *
 * Only `kind: "paper"` references count. The other two kinds are not things a record
 * could carry: 14 are cross-links to other Zoo entries, and 3 are citations to
 * anchors the Zoo's own page does not define.
 */
const paperIdsOf = (slug) => {
  const entry = PUBLIC_REPOSITORY_ENTRIES.find((candidate) => candidate.slug === slug);
  if (!entry) return [];
  const urls = [entry.source?.url, ...(entry.literature ?? []).map((citation) => citation.url)];
  return urls.filter(Boolean).map((url) => paperIdFromUrl(url)).filter(Boolean);
};

const rows = index.entries.map((entry) => {
  const slugs = (claimed.get(entry.name) ?? []).map((c) => c.slug);
  const shape = ZOO_ROW_SHAPE[entry.name] ?? { kind: "unreviewed" };
  const cited = new Set(slugs.flatMap(paperIdsOf));
  const papers = entry.refs.filter((ref) => ref.kind === "paper");
  // 103 of the Zoo's 625 paper references carry no arXiv or DOI link at all — a
  // conference or journal citation typed as prose. This join cannot see those in
  // either direction, so they are counted apart rather than folded into the
  // denominator: "1 of 23" would otherwise mean partly "we do not cite it" and
  // partly "there is nothing here to match", and no later reader could separate them.
  const linked = papers.filter((ref) => (ref.links ?? []).length > 0);
  const carried = linked.filter((ref) =>
    ref.links.some((link) => {
      const id = paperIdFromUrl(link);
      return id !== null && cited.has(id);
    }));
  const notApplicable = Object.hasOwn(ZOO_NOT_APPLICABLE, entry.name);
  const state = notApplicable
    ? "declined"
    : slugs.length === 0
      ? "missing"
      : shape.kind === "result"
        ? "closed"
        : shape.kind === "union" ? "partial" : "unreviewed";
  return {
    name: entry.name,
    section: entry.section,
    speedup: entry.speedup,
    slugs,
    shape: shape.kind,
    state,
    references: papers.length,
    referencesLinked: linked.length,
    referencesCarried: carried.length,
  };
});

const of = (state) => rows.filter((row) => row.state === state);
const [closed, partial, unreviewed, declined, missing] =
  ["closed", "partial", "unreviewed", "declined", "missing"].map(of);

// Strands are only meaningful where the row is a union, so the fraction is printed
// over exactly those rows and nowhere else. Summing it over the whole index would
// count a single-result row's bibliography as unmet coverage.
const strands = partial.reduce(
  (total, row) => ({
    carried: total.carried + row.referencesCarried,
    linked: total.linked + row.referencesLinked,
    references: total.references + row.references,
  }),
  { carried: 0, linked: 0, references: 0 },
);

const bySection = {};
for (const row of rows) {
  const key = row.section ?? "(unsectioned)";
  bySection[key] ??= { total: 0, closed: 0, partial: 0, unreviewed: 0, missing: 0, declined: 0 };
  bySection[key].total += 1;
  bySection[key][row.state] += 1;
}

const report = {
  source: index.source,
  indexFetchedAt: index.fetchedAt,
  zooEntries: rows.length,
  closed: closed.length,
  partial: partial.length,
  unreviewed: unreviewed.length,
  declined: declined.length,
  missing: missing.length,
  partialStrands: strands,
  bySection,
  partialNames: partial.map((row) => `${row.name} (${row.referencesCarried}/${row.referencesLinked} linked, ${row.references} papers)`),
  unreviewedNames: unreviewed.map((row) => row.name),
  missingNames: missing.map((row) => row.name),
  errors,
};

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 1));
} else if (!QUIET || errors.length > 0) {
  console.log(
    `Zoo parity: ${rows.length} rows — ${closed.length} closed, ${partial.length} partial,`
    + ` ${unreviewed.length} shape-unreviewed, ${declined.length} declined, ${missing.length} missing`
    + `  (index fetched ${index.fetchedAt})`,
  );
  console.log(
    `  the ${partial.length} partial rows are subject headings. Of the ${strands.references} papers they`
    + ` reference, ${strands.linked} carry an arXiv or DOI link this check can match on, and this`
    + ` repository cites ${strands.carried} of those. The remaining ${strands.references - strands.linked}`
    + " are matched by nothing either way.",
  );
  if (!QUIET) {
    for (const [section, counts] of Object.entries(bySection)) {
      console.log(
        `  ${String(counts.closed).padStart(2)} closed  ${String(counts.partial).padStart(2)} partial`
        + `  ${String(counts.missing).padStart(2)} missing  of ${String(counts.total).padStart(2)}  ${section}`,
      );
    }
  }
  if (SHOW_MISSING) {
    for (const row of missing) console.log(`  missing: ${row.name}  [${row.section}]`);
    for (const row of partial) {
      console.log(
        `  partial: ${row.name} — ${row.referencesCarried} of ${row.referencesLinked} linked papers cited`
        + ` (${row.references} referenced in all)`,
      );
    }
    for (const row of unreviewed) console.log(`  shape unreviewed: ${row.name}`);
  }
}

// --- whose claim is the speedup class? -----------------------------------------
//
// Every `speedup` on an intake record is a quotation from the Quantum Algorithm Zoo,
// and on at least one of them it is a quotation about a whole SECTION rather than
// about the paper. The owner ruled that such a class may stay, provided the record
// says whether its own primary source backs it, and that "which claims are from
// secondary sources" stays countable (EshMis/ai-ops#18, 2026-08-12).
//
// **An exact census, and a fall fails too** — the same shape, and for the same
// reason, as the per-slot hollow-twin census in `repository-layers.test.ts` that the
// owner settled on the same day (#21). A ceiling on `unknown` would let the number
// drift down as primary sources get read and then quietly absorb a new unchecked
// record without a word; an exact count makes reading a paper an edit to this line,
// which is the diff that records the win.
const SPEEDUP_PROVENANCE_CENSUS = {
  // Primary papers that state a comparable speedup in their own words. This read
  // 0 until W22, when the second Zoo-parity pass read six primary papers in full
  // rather than from their abstracts:
  //   sparse-matrix-power-diagonal-entries — Janzing and Wocjan, conditional on
  //     BQP≠BPP and, as section 2 insists, on the b^m scale the accuracy is
  //     measured against.
  //   string-rewriting-derivation-counts   — the same authors, same condition.
  //   zeta-function-of-a-curve             — Kedlaya names Schoof and Lauder-Wan
  //     and their costs; he never writes "superpolynomial", which is the Zoo's word.
  //   exponential-congruences              — van Dam and Shparlinski state the
  //     cubic gap outright, and in the same breath that both sides are still
  //     superpolynomial in log q.
  // Four more from the second batch of the same pass:
  //   matrix-products-over-semirings       — Le Gall and Nishimura name Duan and
  //     Pettie's O(n^2.687) as the classical figure they beat.
  //   viterbi-decoding-convolutional-codes — Grice and Meyer claim "better than
  //     classical performance under certain conditions", but state no classical
  //     bound anywhere, so the claim is comparative and qualitative at once.
  //   average-case-lattice-problems-by-filtering — the claim is the narrow one:
  //     no polynomial-time algorithm, classical or quantum, was known for these
  //     variants. Not the Zoo's "Exponential".
  //   quantum-primality-test-order-finding — compared against AKS by exponent.
  // Two more from the third batch. Both from Hallgren's J. ACM paper, which is the
  // one number-theory source here that does state a classical cost, in L-notation.
  //   pell-equation-regulator, principal-ideal-problem
  // Two more from the fourth batch, and on one of them the very same sentence
  // takes most of the claim back:
  //   irreducible-representation-matrix-elements — "exponential speedup in worst
  //     case complexity ... On the other hand, we show that average case instances
  //     are classically easy." One sentence, both halves.
  //   boson-sampling-linear-optics — the Jerrum-Sinclair-Vigoda contrast between
  //     nonnegative and complex permanents.
  // Two more from the fifth batch, the two Zoo *subject headings* — see the
  // declaration comments in ./entries-zoo-parity.ts for which of each heading's
  // eight references these carry and which stay outstanding:
  //   elliptic-curve-discrete-log-resources — Proos and Zalka name Pollard rho and
  //     call the classical side truly exponential. The famous "1000 qubits" is
  //     LOGICAL qubits on an explicitly noise-free machine.
  //   backtracking-quantum-walk-speedup — Montanaro's near-quadratic speedup, and
  //     the square root is of the TREE SIZE, not the problem size.
  //
  // A third was written and could not land, and now has. The Zoo's "Subset-sum"
  // entry is cited to Bernstein, Jeffery, Lange and Meurer, whose only identifier
  // is the Springer chapter DOI 10.1007/978-3-642-38616-9_2. `paperSlug` mapped
  // "/" to "_", and that DOI already contains "_2", so the id did not survive a
  // round trip through its own url segment and `validatePaperRegister` refused it
  // — exactly the case papers.ts says the check exists for, firing for the first
  // time. The identity scheme now escapes the underscore, so:
  //   subset-sum-quantum-walk — the authors state a cost exponent and claim it
  //     beats every prior algorithm, quantum and classical. Their comparison
  //     against the best CLASSICAL exponent is made in a table and in no sentence,
  //     and they never call their own speedup polynomial, which is the Zoo's word
  //     for this row. Read in full, all eighteen pages, from the authors' own text.
  //
  // Worth keeping on the record that this row was never a sourcing gap: the paper
  // had been read for a session, and from the gauge a row held open by a url
  // mapping looked exactly like a row nobody could source
  reported: 15,
  // Read and silent. gibbs-state-sampling was the first: Poulin and Wocjan's
  // abstract makes no comparison to a classical algorithm and the Zoo's
  // "Superpolynomial" is the section heading's. This is the record the owner's
  // ruling was about. W22 added two more, both from full-text reads:
  //   gauss-sum-estimation        — van Dam and Seroussi decline to prove classical
  //     hardness and leave it open in their conclusion, so the Zoo's
  //     "Superpolynomial" has no support in the paper the Zoo cites for it.
  //   subset-finding-quantum-walk — Childs and Eisenberg compare only against
  //     quantum query lower bounds; the word "classical" is not in the body.
  // Two more from the second batch:
  //   quadratically-signed-weight-enumerators — Knill and Laflamme prove an
  //     equivalence, not a speedup. The Zoo files it "Superpolynomial"; the paper
  //     it cites for that makes no comparison of costs at all.
  //   double-bracket-diagonalization — every comparison is against other quantum
  //     methods. `read` scopes this to a partial retrieval, which is exactly the
  //     case the field's narrowness was written for.
  // Two more from the third batch, and the contrast with the pair above is the
  // finding: the SAME author's STOC 2005 paper, read cover to cover, states no
  // classical running time at all, where his J. ACM paper states one in L-notation.
  //   unit-group-of-a-number-field, class-group-of-a-number-field
  absent: 7,
  // The worklist. The intake checked the problem statement, the class against the
  // Zoo, the reference metadata and the complexity claim — it never asked whether
  // the paper supports the class. `unknown` says that, rather than pretending.
  unknown: 31,
};

const seen = { reported: 0, absent: 0, unknown: 0 };
for (const { slug, primary } of ZOO_SPEEDUP_PROVENANCE) {
  if (!(primary?.states in seen)) {
    errors.push(`${slug}: speedupPrimary.states is "${primary?.states}", which is not one of reported/absent/unknown`);
    continue;
  }
  seen[primary.states] += 1;
  // A state with no evidence behind it is exactly what this field was added to
  // stop, and an empty string type-checks perfectly well.
  if (primary.states === "reported" && !primary.quote?.trim()) {
    errors.push(`${slug}: speedupPrimary is "reported" with no quote — a claim with nothing behind it`);
  }
  if (primary.states === "absent" && !primary.read?.trim()) {
    errors.push(
      `${slug}: speedupPrimary is "absent" with nothing named in \`read\` — "the paper does not say it" `
      + "is only as wide as the text somebody actually read",
    );
  }
}
for (const [state, pinned] of Object.entries(SPEEDUP_PROVENANCE_CENSUS)) {
  if (seen[state] === pinned) continue;
  errors.push(
    seen[state] > pinned
      ? `speedup provenance: ${seen[state]} records are "${state}", was ${pinned}. If a primary source was read, `
        + `record the win: ${state}: ${seen[state]}. If a record was added without checking one, that is the `
        + "worklist growing and it should be deliberate."
      : `speedup provenance: ${seen[state]} records are "${state}", down from ${pinned}. Update the census: `
        + `${state}: ${seen[state]}. A stale-high number is silent room for an unchecked claim to hide in.`,
  );
}
if (!QUIET && !AS_JSON) {
  console.log(
    `  speedup class vs primary source: ${seen.reported} reported, ${seen.absent} absent, ${seen.unknown} unchecked`
    + ` (of ${ZOO_SPEEDUP_PROVENANCE.length})`,
  );
}

if (errors.length > 0) {
  for (const error of errors) console.error(`✖ ${error}`);
  process.exit(1);
}
