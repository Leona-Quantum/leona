// The identity rule, which is the part that has to survive thousands of papers,
// and the audit that keeps 438 citations agreeing with 143 rows.
//
// The corpus is not imported here, for the reason `repository-topics.test.ts`
// states. `scripts/check-paper-register.mjs` runs the same functions over the
// real corpus and the real graph.
import assert from "node:assert/strict";
import test from "node:test";

import {
  auditCitations,
  canonicalPaperUrl,
  paperIdFromUrl,
  paperRegisterWarnings,
  reportsCensus,
  validatePaperRegister,
  type PaperRegister,
} from "./repository/papers.ts";
import { PAPER_REGISTER } from "./repository/paper-register.ts";

test("five strings for one paper collapse to one id", () => {
  // This is the whole reason the register is keyed on an id rather than a URL. A
  // corpus growing to thousands of papers acquires every one of these variants,
  // and a register keyed on whichever string arrived first silently splits a
  // paper in two — two rows, two titles, and no rule can see they are one thing.
  const arxiv = "arxiv:2011.03185";
  for (const url of [
    "https://arxiv.org/abs/2011.03185",
    "https://arxiv.org/abs/2011.03185v2",
    "https://arxiv.org/pdf/2011.03185",
    "https://arxiv.org/pdf/2011.03185v7",
    "http://www.arxiv.org/abs/2011.03185",
  ]) {
    assert.equal(paperIdFromUrl(url), arxiv, url);
  }
  // Pre-2007 ids keep their native form. Rewriting `quant-ph/9508027` into
  // anything else would make the register's keys stop matching arXiv's own.
  assert.equal(paperIdFromUrl("https://arxiv.org/abs/quant-ph/9508027v2"), "arxiv:quant-ph/9508027");
});

test("a publisher's front door to a DOI is the same paper as the DOI", () => {
  // `link.aps.org/doi/10.1103/PhysRevA.53.2855` and `doi.org/10.1103/…` are one
  // paper. The corpus carried the first; without this rule, pasting the second
  // one day would create a second row.
  assert.equal(
    paperIdFromUrl("https://link.aps.org/doi/10.1103/PhysRevA.53.2855"),
    "doi:10.1103/physreva.53.2855",
  );
  assert.equal(
    paperIdFromUrl("https://doi.org/10.1103/PhysRevA.53.2855"),
    "doi:10.1103/physreva.53.2855",
  );
  // Case is not identity for a DOI, and two casings of one DOI are one paper.
  assert.equal(
    paperIdFromUrl("https://doi.org/10.1017/CBO9780511976667"),
    paperIdFromUrl("https://doi.org/10.1017/cbo9780511976667"),
  );
});

test("an address the register cannot key on is refused, not guessed at", () => {
  // Returning some fabricated id here would put an unjoinable island in the
  // register that looks exactly like a paper. The build refuses instead.
  assert.equal(paperIdFromUrl("https://example.org/some-preprint"), null);
  assert.equal(paperIdFromUrl("https://www.nature.com/articles/nature23879"), null);
  assert.equal(paperIdFromUrl(""), null);
});

test("every id round-trips through its canonical url", () => {
  for (const paper of PAPER_REGISTER.papers) {
    assert.equal(paperIdFromUrl(canonicalPaperUrl(paper.id)), paper.id, paper.id);
  }
});

test("the authored register satisfies every structural rule", () => {
  assert.deepEqual(validatePaperRegister(PAPER_REGISTER), []);
  // A floor, not the exact count: pinning 143 would fail the day a paper is
  // added, which is the one thing this file should never discourage.
  assert.ok(PAPER_REGISTER.papers.length >= 140);
});

test("validation refuses the rows that would reintroduce drift one level up", () => {
  const one = (over: Record<string, unknown>): PaperRegister => ({
    papers: [
      {
        id: "arxiv:2011.03185",
        title: "T",
        authors: "A",
        year: "2020",
        url: "https://arxiv.org/abs/2011.03185",
        ...over,
      },
    ],
  });
  assert.deepEqual(validatePaperRegister(one({})), []);
  // A row whose link points somewhere its own key does not is the exact failure
  // the register exists to stop, moved up one level.
  assert.match(
    validatePaperRegister(one({ url: "https://arxiv.org/abs/1701.03684" })).join("\n"),
    /url is https:\/\/arxiv\.org\/abs\/1701\.03684/,
  );
  assert.match(validatePaperRegister(one({ year: "2020a" })).join("\n"), /year is not four digits/);
  assert.match(validatePaperRegister(one({ authors: "  " })).join("\n"), /authors is empty/);
  assert.match(
    validatePaperRegister({ papers: [...one({}).papers, ...one({}).papers] }).join("\n"),
    /listed twice/,
  );
});

test("two ids carrying one title and year are a warning, and must not fail the build", () => {
  // A preprint and its journal DOI, both registered. Not always wrong — it is
  // the thing to look at, and it is invisible without this. The first draft put
  // it in `errors`, so the gate exited non-zero on the case its own comment
  // called legitimate; the split is the fix and this asserts both halves.
  const register: PaperRegister = {
    papers: [
      { id: "arxiv:2011.03185", title: "One paper", authors: "A", year: "2020", url: "https://arxiv.org/abs/2011.03185" },
      { id: "doi:10.1000/x", title: "One Paper", authors: "A", year: "2020", url: "https://doi.org/10.1000/x" },
    ],
  };
  assert.deepEqual(validatePaperRegister(register), []);
  assert.match(paperRegisterWarnings(register).join("\n"), /the same title and year appear under/);
  // And the authored register is clean on both counts.
  assert.deepEqual(paperRegisterWarnings(PAPER_REGISTER), []);
});

test("a query string or a fragment is navigation, never identity", () => {
  // `arxiv.org/abs/X?context=quant-ph` is what a search result hands you, and
  // `doi.org/10.1/x#sec3` is what a deep link does. Without stripping, the
  // trailing pattern swallows both into the key and one paper becomes two rows —
  // or a citation somebody pasted becomes unregistered.
  assert.equal(paperIdFromUrl("https://arxiv.org/abs/2011.03185?context=quant-ph"), "arxiv:2011.03185");
  assert.equal(paperIdFromUrl("https://arxiv.org/abs/2011.03185v2#abstract"), "arxiv:2011.03185");
  assert.equal(paperIdFromUrl("https://doi.org/10.1103/PhysRevA.53.2855#sec3"), "doi:10.1103/physreva.53.2855");
});

const FIXTURE: PaperRegister = {
  papers: [
    { id: "arxiv:1", title: "Real title", authors: "Real authors", year: "2020", url: "https://arxiv.org/abs/1" },
    { id: "arxiv:2", title: "Unplaced", authors: "Somebody", year: "2021", url: "https://arxiv.org/abs/2" },
  ],
};

test("a citation is audited on all four fields, against the row and not its neighbours", () => {
  const audit = auditCitations(
    [
      {
        where: "entry:a",
        title: "A Quantum-Classical Algorithm for Molecular Properties",
        authors: "Real authors",
        year: "2020",
        url: "https://arxiv.org/abs/1",
      },
      // Same paper, different URL spelling, and every field right. The version
      // suffix must not make this a second paper or a drift.
      {
        where: "node:n",
        title: "Real title",
        authors: "Real authors",
        year: "2020",
        url: "https://arxiv.org/abs/1v3",
      },
    ],
    FIXTURE,
  );
  // The wrong-title citation drifts on title AND on url (the row publishes the
  // canonical form), and the v3 one drifts only on url.
  assert.deepEqual(
    audit.drifted.filter((d) => d.field === "title").map((d) => d.expected),
    ["Real title"],
  );
  assert.equal(audit.unregistered.length, 0);
  assert.equal(audit.unparseable.length, 0);
});

test("a paper cited from both sides is reported, and one cited from neither is not an error", () => {
  const audit = auditCitations(
    [
      { where: "entry:a", title: "Real title", authors: "Real authors", year: "2020", url: "https://arxiv.org/abs/1" },
      { where: "node:n", title: "Real title", authors: "Real authors", year: "2020", url: "https://arxiv.org/abs/1" },
    ],
    FIXTURE,
  );
  // The substrate for "papers as traces": the map and the Atlas agree about this
  // one. `arxiv:2` is cited by nobody, which is a queue, not a defect.
  assert.deepEqual(audit.shared, ["arxiv:1"]);
  assert.deepEqual(audit.uncited, ["arxiv:2"]);
  assert.deepEqual(audit.drifted, []);
});

test("two citations of one paper from the same side do not count as shared", () => {
  // `shared` means the two *bibliographies* meet. Counting two entries citing
  // one paper would report the Atlas agreeing with itself.
  const cite = (where: string) => ({
    where,
    title: "Real title",
    authors: "Real authors",
    year: "2020",
    url: "https://arxiv.org/abs/1",
  });
  assert.deepEqual(auditCitations([cite("entry:a"), cite("entry:b")], FIXTURE).shared, []);
  assert.deepEqual(auditCitations([cite("node:a"), cite("node:b")], FIXTURE).shared, []);
});

test("an unregistered paper is reported as unregistered, never as drift", () => {
  // The fix is "add the row", and a drift error would send the reader to edit a
  // row that does not exist.
  const audit = auditCitations(
    [{ where: "entry:a", title: "x", authors: "y", year: "1999", url: "https://arxiv.org/abs/9999" }],
    FIXTURE,
  );
  assert.equal(audit.unregistered.length, 1);
  assert.deepEqual(audit.drifted, []);
});

test("a reports judgement cannot be recorded without saying what was read", () => {
  // The invariant runs both ways. A judgement with no basis is a claim whose
  // strength nobody can weigh — an abstract read and a full-text read are
  // different evidence and render identically. A basis with no judgement
  // asserts a paper was read and writes nothing down, so the row reads as
  // unread forever while claiming it is not.
  const row = { id: "arxiv:1", title: "T", authors: "A", year: "2020", url: "https://arxiv.org/abs/1" };
  const coverage = { theory: "reported", simulation: "unknown", hardware: "absent" } as const;
  assert.match(
    validatePaperRegister({ papers: [{ ...row, reports: coverage }] }).join("\n"),
    /reports is recorded with no reportsBasis/,
  );
  assert.match(
    validatePaperRegister({ papers: [{ ...row, reportsBasis: "abstract" }] } as PaperRegister).join("\n"),
    /reportsBasis is recorded with no reports/,
  );
  assert.deepEqual(
    validatePaperRegister({ papers: [{ ...row, reports: coverage, reportsBasis: "abstract" }] }),
    [],
  );
});

test('an abstract read may never conclude "this paper runs no numerics"', () => {
  // The one axis where the negative does not follow from the evidence, made a
  // failure rather than a comment. Numerics routinely sit in a section the
  // abstract never mentions, so `simulation: "absent"` off an abstract is a
  // guess wearing the shape of a measurement — and `reports` exists precisely
  // to not be that. `hardware: "absent"` is fine on the same evidence and is
  // asserted here beside it, because the rule is per-axis and a blanket ban
  // would cost the field the distinction the owner asked for.
  const row = { id: "arxiv:1", title: "T", authors: "A", year: "2020", url: "https://arxiv.org/abs/1" };
  assert.match(
    validatePaperRegister({
      papers: [
        {
          ...row,
          reports: { theory: "reported", simulation: "absent", hardware: "absent" },
          reportsBasis: "abstract",
        },
      ],
    }).join("\n"),
    /must be "unknown" until someone reads the full text/,
  );
  // The same values are legitimate once somebody has read the paper.
  assert.deepEqual(
    validatePaperRegister({
      papers: [
        {
          ...row,
          reports: { theory: "reported", simulation: "absent", hardware: "absent" },
          reportsBasis: "full-text",
        },
      ],
    }),
    [],
  );
});

test("the census counts each axis separately, because they were filled by different rules", () => {
  // One "N read" number would let `simulation` — open on most rows — ride on
  // `hardware`, which the abstract decides on nearly all of them. Asserted on
  // the real register so the shape of the honest answer cannot silently
  // collapse into a single reassuring figure.
  const census = reportsCensus(PAPER_REGISTER);
  assert.equal(census.papers, PAPER_REGISTER.papers.length);
  assert.equal(
    census.read,
    PAPER_REGISTER.papers.filter((paper) => paper.reports !== undefined).length,
  );
  for (const axis of ["theory", "simulation", "hardware"] as const) {
    const counts = census.byAxis[axis];
    assert.equal(
      counts.reported + counts.absent + counts.unknown,
      census.read,
      `${axis} must account for every read row`,
    );
  }
  // The rule in ./repository/papers.ts, asserted rather than trusted: nothing
  // filled from an abstract may claim a paper has no numerics.
  assert.equal(census.byAxis.simulation.absent, 0);
});

test("citedByNode is the set the source-read passes are prioritised against", () => {
  // Published as data so the scripts and any surface agree on which papers "the
  // map cites" means. A grep for `node:` in two places drifts the first time
  // one of them learns about a new citation site.
  const cite = (where: string, url: string) => ({
    where,
    title: "Real title",
    authors: "Real authors",
    year: "2020",
    url,
  });
  const audit = auditCitations(
    [
      cite("node:a", "https://arxiv.org/abs/1"),
      cite("entry:b", "https://arxiv.org/abs/1"),
      cite("entry:c", "https://arxiv.org/abs/2"),
    ],
    FIXTURE,
  );
  assert.deepEqual(audit.citedByNode, ["arxiv:1"]);
});
