// **The card, and mostly what it does not have.**
//
// `W5-card-spec.md` records the owner's rule for this surface: *"it is assumed that gaps
// are loud and clear, but terse in text like 'none found yet'"*. A card assembled straight
// into JSX would make that rule unfalsifiable — a gap written `{x ? <p/> : <EmptyNote/>}` is
// a gap nothing can count. `card-content.ts` resolves every section to a `CardValue`, and
// this file is what that buys: the census below is a fact about the drawing, checked.
//
// The claim this file exists to defend is the one that is easiest to lose and hardest to
// see: **the two gaps say different things.** `none-recorded` means a search came back
// empty. `no-field-yet` means nothing anywhere can hold the answer — three of the sections
// the owner asked for have no field on any type here, and printing "none found yet" for
// those would report a thin literature when the truth is an unbuilt field. That is a lie in
// the direction that survives, because a reader cannot tell them apart.
import assert from "node:assert/strict";
import test from "node:test";

import { parseCardId, withCard } from "./repository/map-card.ts";
import {
  cardExists,
  cardFor,
  cardHopNotes,
  cardSections,
  ownCardId,
  sectionState,
  type Card,
} from "./repository/card-content.ts";
import { LAYER_GRAPH } from "./repository/layer-graph.ts";
import { STATE_VOCABULARY } from "./repository/state-vocabulary.ts";
import { PAPER_REGISTER } from "./repository/paper-register.ts";
import { isMethod, layerNode, routeOf, type LayerCorpusEntry, type LayerMethod } from "./repository/layers.ts";

const exists = (id: string) => layerNode(LAYER_GRAPH, id) !== null;

/**
 * The corpus, as the graph itself names it.
 *
 * Built from `node.entries` rather than from `PUBLIC_REPOSITORY_ENTRIES`, and not for
 * convenience: that module imports its seven entry files without extensions, so it cannot be
 * loaded under `node --experimental-strip-types` at all. Using the slugs the graph names
 * makes the join's *upper bound* the subject — which is the honest thing to test anyway,
 * since `entriesFor` filters against whatever corpus actually loaded and a test that
 * supplied a fatter corpus than production would be measuring a join production never makes.
 */
const CORPUS: LayerCorpusEntry[] = [
  ...new Set(LAYER_GRAPH.nodes.flatMap((node) => node.entries ?? [])),
].map((slug) => ({
  slug,
  title: slug,
  titleJa: slug,
  category: "algorithms" as LayerCorpusEntry["category"],
  description: "",
  descriptionJa: "",
}));

const cards = (locale: "en" | "ja" = "en"): Card[] =>
  LAYER_GRAPH.nodes
    .map((node) => cardFor({ graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, corpus: CORPUS, locale, register: PAPER_REGISTER }, node.id))
    .filter((card): card is Card => card !== null);

test("?card= names a node, and an id that names nothing means shut", () => {
  assert.deepEqual(parseCardId(undefined, exists), { id: null, dropped: 0 });
  assert.deepEqual(parseCardId("", exists), { id: null, dropped: 0 });
  // The one difference from `?about=`, and it is deliberate. `?about=` falls back to its
  // first section because every possible value has a sensible neighbour; there is no
  // sensible *default node*, so a stale link opens nothing rather than opening a card about
  // something the reader never asked about.
  assert.deepEqual(parseCardId("no-such-node", exists), { id: null, dropped: 1 });
  const real = LAYER_GRAPH.nodes[0]!.id;
  assert.deepEqual(parseCardId(real, exists), { id: real, dropped: 0 });
  // Single-valued: two cards at once is a second map, which is what the owner bounded the
  // card against. The extra is counted rather than ignored, so a link that tries it says so.
  assert.deepEqual(parseCardId([real, LAYER_GRAPH.nodes[1]!.id], exists), { id: real, dropped: 1 });
  assert.deepEqual(parseCardId(["nope", real], exists), { id: null, dropped: 2 });
});

test("opening a card costs the reader nothing they were already holding", () => {
  const base = "/repository/layers?focus=quantum-linear-solve&open=a&open=b&at=1.5.2.3";
  const opened = withCard(base, "hhl-qpe-inversion");
  const params = new URLSearchParams(opened.slice(opened.indexOf("?") + 1));
  assert.equal(params.get("focus"), "quantum-linear-solve");
  assert.deepEqual(params.getAll("open"), ["a", "b"]);
  assert.equal(params.get("at"), "1.5.2.3");
  assert.equal(params.get("card"), "hhl-qpe-inversion");
  // Shutting it returns the address it was opened from, byte for byte. A close link that
  // dropped a parameter would teleport a reader who had panned, or shut lines they opened.
  assert.equal(withCard(opened, null), base);
  // Two overlays on one map is a URL claiming a state the page cannot draw, and that claim
  // outlives everyone who remembers which one won.
  assert.equal(new URLSearchParams(withCard(`${base}&about=what-this-is`, "hhl-qpe-inversion")).get("about"), null);
  assert.equal(withCard("/repository/layers", null), "/repository/layers");
});

test("every node in the graph draws a card, and every card keeps the way onward", () => {
  const all = cards();
  assert.equal(all.length, LAYER_GRAPH.nodes.length, "a node in the graph draws no card");
  for (const card of all) {
    // **The card is a preview, never a replacement.** It exists because the owner wants the
    // record in place on the map; it must not become the only place the record lives.
    assert.equal(card.pageHref, `/repository/layers/${card.id}`);
    assert.ok(card.label.length > 0, `${card.id} draws a card with no name`);
  }
});

test("the card draws the sections the owner asked for, in the order he asked for them", () => {
  // **This is the test that had no subject before session 114.** `cardSections` and the
  // panel were two lists of the same sections in two different orders, and the panel did
  // not import this one — so the order a reader saw was pinned nowhere, and a section could
  // have left the drawing entirely while this census went on counting it. The panel now
  // renders from `cardSections`, which makes the order a fact rather than an intention.
  //
  // The order is `OWNER_TODO` §2, answered in full. His seven were Input, Theory, Output,
  // Requires, Example, Performance, Implementations; *When it applies* is first because he
  // made it its own section (*"okay, it's own section"*), and *Where the claim is contested*
  // sits after Performance because he kept it out of it.
  const method = cards().find((card) => card.kind === "method")!;
  assert.deepEqual(
    cardSections(method).map((section) => section.id),
    [
      "when-it-applies",
      "input",
      "theory",
      "output",
      "requires",
      "example",
      "performance",
      "contested",
      "implementations",
      "records",
    ],
  );
  // And it is the same order on every method, not just the first one sampled.
  for (const card of cards().filter((c) => c.kind === "method")) {
    assert.deepEqual(
      cardSections(card).map((s) => s.id),
      cardSections(method).map((s) => s.id),
      `${card.id} draws its sections in a different order`,
    );
  }

  const process = cards().find((card) => card.kind === "process")!;
  assert.deepEqual(cardSections(process).map((section) => section.id), [
    "contract",
    "why-a-layer",
    "filled-by",
    "bypassed-by",
    "classical-equivalents",
    "records",
  ]);

  // The own stretch, which is short on purpose. `no-slot` is in this list rather than
  // hardcoded in the panel — it was the one section the census could not see, which is
  // exactly the shape of the bug this test exists to prevent.
  const input = { graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, corpus: CORPUS, locale: "en", register: PAPER_REGISTER } as const;
  const own = cardFor(input, ownCardId("lchs-route"))!;
  assert.deepEqual(cardSections(own).map((section) => section.id), ["between", "contract", "no-slot"]);

  // **Papers are deliberately not a section.** He was asked whether a reference list should
  // be an eighth one and said *"confirm, it isn't needed for papers to be their own
  // section"*. They are 63/63 and cannot be a gap, so they are chrome below the sections.
  //
  // Not asserted here, and that is not an omission: `"papers"` is no longer a member of
  // `CardSectionId`, so `section.id === "papers"` does not compile. The type is the gate,
  // and a runtime check beside it would be a test that can never fail — which reads like
  // coverage and is the absence of it.
  //
  // What a test *can* still hold is that every card carries them somewhere, which the
  // census below does off `card.papers` directly.
});

test("a section is never empty and silent — every one resolves to held, or to which gap", () => {
  const seen = new Set<string>();
  for (const card of cards()) {
    const sections = cardSections(card);
    // Ten on a method, six on a process — the two card kinds are different shapes, and a
    // count that only fitted the fatter one would pass a process card that had lost half
    // its sections.
    const expected = card.kind === "method" ? 10 : 6;
    assert.equal(
      sections.length,
      expected,
      `${card.id} (${card.kind}) draws ${sections.length} sections, not ${expected}`,
    );
    for (const section of sections) {
      seen.add(`${card.kind}:${section.id}`);
      assert.ok(
        ["held", "none-recorded", "no-field-yet"].includes(sectionState(section)),
        `${card.id}/${section.id} resolved to ${sectionState(section)}`,
      );
    }
  }
  // Pinned so a section cannot quietly leave the card. Removing one is a change to this
  // number, which is a change somebody has to justify in a diff.
  assert.equal(seen.size, 16, `${seen.size} distinct sections: ${[...seen].sort().join(", ")}`);
});

test("the two gaps stay different facts — the undesigned sections never say 'none found yet'", () => {
  // The sections with no field anywhere. If one of these ever reports `none-recorded`,
  // somebody has given it a field and forgotten to say so — which is fine, and has to be
  // deliberate, because the copy a reader sees changes from "we have not built this" to "we
  // looked and found nothing".
  //
  // `theory-trace`, `approximations` and `assumptions` used to be on this list and are gone
  // from this level entirely: Theory *is* the chain now, and the other two are annotations
  // on a hop. Both were the owner's own re-decisions in §2. The hop-level sweep below is
  // where they are checked instead.
  // **Two left this set in session 114, and that is the change.** `example` and
  // `implementations` now read real fields on `LayerMethod`, so an empty one honestly
  // reports `none-recorded`: we built the place to put it and nobody has written one yet.
  // The sentence a reader sees changed from "we have not built this" to "we looked and
  // found nothing", which is exactly the deliberate act the comment above demands.
  //
  // `classical-equivalents` is the last one standing — the classical column the owner asked
  // for beside `bypasses`, which still has no field anywhere.
  const undesigned = new Set(["classical-equivalents"]);
  let counted = 0;
  for (const card of cards()) {
    for (const section of cardSections(card)) {
      const state = sectionState(section);
      if (undesigned.has(section.id)) {
        counted += 1;
        assert.equal(
          state,
          "no-field-yet",
          `${card.id}/${section.id} reported "${state}" — a section with no field ` +
            `behind it must not tell a reader the search came back empty`,
        );
      } else {
        assert.notEqual(
          state,
          "no-field-yet",
          `${card.id}/${section.id} says no field holds it, but one does`,
        );
      }
    }
  }
  assert.ok(counted >= 19, `only ${counted} undesigned sections swept`);
});

test("Theory is held on every method, and each hop inside it is empty or filled for the right reason", () => {
  // **Two levels, two honest answers, and one number could not carry both.** Theory is held
  // on all 63 methods because the chain is structural and `routeOf` computes it — that is
  // exactly why the owner chose the chain as its spine, so the section is honest on day one
  // and fills in hop by hop. But a reader who opens all but one of them finds nothing yet,
  // and a census reporting only "Theory: held" would describe a card fuller than it reads.
  //
  // **One census where session 114 had three slots per hop.** The owner moved approximations
  // and assumptions inside the mathematics as marks, so the countable facts changed with the
  // model: a hop is empty or authored, and an authored one marks nothing or marks something.
  const methods = cards().filter((card) => card.kind === "method");
  let hops = 0;
  let authored = 0;
  let marks = 0;
  for (const card of methods) {
    const theory = cardSections(card).find((section) => section.id === "theory")!;
    assert.equal(sectionState(theory), "held", `${card.id}: Theory is not held`);
    const swept = cardHopNotes(card);
    hops += swept.length;
    // One note per hop, keyed by the hop's own position and states. Two hops of one method
    // reporting the same key would make every count below a count of something else.
    assert.equal(
      new Set(swept.map((note) => note.hop)).size,
      swept.length,
      `${card.id}: two hops share a census key`,
    );
    for (const note of swept) {
      // **`none-recorded` since session 114, and never `no-field-yet` again.**
      // `LayerMethod.hops` exists now, so an empty hop is a source nobody has read rather
      // than a field nobody has built. If one of these ever reports `no-field-yet` again,
      // the field has been taken away and the card is telling a reader the model is still
      // being designed when it is not.
      assert.ok(
        note.state === "none-recorded" || note.state === "held",
        `${card.id} hop ${note.hop} reported "${note.state}"`,
      );
      // A mark is a clause *of* the mathematics, so it cannot exist where there is no
      // mathematics. If this ever fires, the parse and the held-ness have stopped being
      // decided by the same string.
      if (note.state !== "held") {
        assert.equal(note.marks.length, 0, `${card.id} hop ${note.hop} marks an empty note`);
      }
      if (note.state === "held") authored += 1;
      marks += note.marks.length;
    }
  }
  // **91, measured, not a floor.** 43 methods draw a single hop — the stretch they close
  // themselves, with no named step at all — 12 draw two and 8 draw three. It is pinned
  // exactly because the next corpus change that touches it is a known one: authoring the
  // readout slot for `evolution-circuit → solution-answer` (`OWNER_TODO` §1) closes four
  // methods' own stretches and would move this number. That should arrive as a failing
  // assertion somebody updates deliberately, not as a quiet drift.
  assert.equal(hops, 91, `${hops} hops, not 91`);
  // **A floor, and it must not be zero.** The marked-prose path is the whole of the owner's
  // re-decision, and a rendering path with no instance anywhere has never been drawn. One
  // authored hop is what proves the parse, the spans, the legend and both locales against
  // real data rather than only against a fixture. Raising this number is corpus work and
  // the point of the field.
  assert.ok(authored >= 1, `${authored} hops carry mathematics — the marked path draws nowhere`);
  assert.ok(marks >= 1, `${marks} marks across ${authored} authored hops`);
  console.log(
    `[theory census] ${methods.length} methods, ${hops} hops, ` +
      `${authored} with mathematics, ${marks} marked clauses`,
  );
});

test("the card reads the map node, which is the populated side of the join", () => {
  // The §2 decision, measured. The recommendation the owner was given — *"the method card
  // reads the map node, the repository entry keeps its own record, and the two are joined
  // rather than merged"* — rests on the claim that the node is populated and the record is
  // not. These are the numbers behind it, pinned as floors so they can only improve.
  const methods = cards().filter((card) => card.kind === "method");
  assert.equal(methods.length, LAYER_GRAPH.nodes.filter(isMethod).length);
  const held = (id: string) =>
    methods.filter((card) => {
      const section = cardSections(card).find((s) => s.id === id);
      return section !== undefined && sectionState(section) === "held";
    }).length;
  // Input and Output are one contract read twice, so they are the same number by
  // construction — asserted rather than assumed, because the day they differ is the day
  // somebody gave one half its own value and the two can disagree about whether a contract
  // was recorded at all.
  assert.equal(held("input"), methods.length, `input held on ${held("input")}/${methods.length}`);
  assert.equal(held("output"), held("input"), "Input and Output disagree about one contract");
  assert.equal(held("theory"), methods.length, `theory held on ${held("theory")}/${methods.length}`);
  assert.ok(held("when-it-applies") >= 61, `when-it-applies held on ${held("when-it-applies")}`);
  assert.ok(held("performance") >= 42, `performance held on ${held("performance")}`);
  assert.ok(held("contested") >= 22, `contested held on ${held("contested")}`);
  assert.ok(held("requires") >= 1, `requires held on ${held("requires")}`);
  // Papers left the section list and became chrome, so they are counted off the card
  // directly. Still 63/63, and still the thing that makes every other gap on the card
  // legible: a method with no paper would be a claim with no source.
  const withPapers = methods.filter((card) => card.papers.held).length;
  assert.equal(withPapers, methods.length, `papers held on ${withPapers}/${methods.length}`);
  // And the record side, which is the half the decision was about: thin, and said so.
  // A *ceiling*, not a floor — this is the number that makes "join rather than merge" the
  // right call, and it going up is the thing that would make the call worth revisiting.
  const withRecord = held("records");
  assert.ok(
    withRecord <= 12,
    `${withRecord} of ${methods.length} methods now name a repository record — the join is ` +
      `no longer thin, so "the card reads the node because the record is empty" wants re-deciding`,
  );
  console.log(
    `[card census] ${methods.length} methods: input/output ${held("input")}, theory ${held("theory")}, ` +
      `papers ${withPapers}, conditions ${held("when-it-applies")}, performance ${held("performance")}, ` +
      `contested ${held("contested")}, requires ${held("requires")}, records ${withRecord}`,
  );
});

test("a process card cannot answer the owner's third coverage question, and does not pretend to", () => {
  // He asked for three: covered, not covered yet, or *deliberately not a repository thing,
  // for this stated reason*. The third needs a field that does not exist, and a three-valued
  // answer with an unreachable third value is a two-valued answer wearing a third label.
  const processes = cards().filter((card) => card.kind === "process");
  assert.ok(processes.length > 0);
  for (const card of processes) {
    assert.ok(card.kind === "process");
    assert.notEqual(
      card.coverage,
      "deliberate",
      `${card.id} answered "deliberate" — if a field now holds the reason, the copy for ` +
        `"not-yet" is wrong, because it currently tells the reader nothing can distinguish them`,
    );
  }
});

test("a card is drawn in the reader's language, all the way down", () => {
  // Ja is not a translation layer over an English card: every prose field on the node has a
  // `…Ja` sibling and the card must read the sibling, including inside the nested lists that
  // are two levels down. A card that localised its headings and not its contents would look
  // translated and read as English.
  const pick = (locale: "en" | "ja", id: string) =>
    cardFor({ graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, corpus: CORPUS, locale, register: PAPER_REGISTER }, id)!;
  let compared = 0;
  for (const node of LAYER_GRAPH.nodes) {
    const en = pick("en", node.id);
    const ja = pick("ja", node.id);
    if (node.label !== node.labelJa) {
      assert.notEqual(ja.label, en.label, `${node.id}: the card's name did not change locale`);
      compared += 1;
    }
    if (en.contract.held && ja.contract.held && en.contract.value.takes !== ja.contract.value.takes) {
      assert.notEqual(ja.contract.value.takes, en.contract.value.takes);
    }
    if (en.kind === "method" && ja.kind === "method" && en.ingredients.held && ja.ingredients.held) {
      const jaIngredients = ja.ingredients.value;
      for (const [index, item] of en.ingredients.value.entries()) {
        assert.equal(
          jaIngredients[index]?.id,
          item.id,
          "the two locales listed ingredients in different orders",
        );
      }
    }
  }
  assert.ok(compared > 40, `only ${compared} names were comparable across locales`);
});

// --- the three the card had nowhere to put ----------------------------------

test("Example and Implementations stopped saying the model is still being designed", () => {
  // **The flip, pinned from the card's side.** Both sections were `no-field-yet` on all
  // 63 methods until session 114 — nothing anywhere could hold them. The owner signed
  // both models off, the fields exist, and an empty one now says "none found yet": we
  // built the place to put it and nobody has written one. The two sentences are different
  // claims and the card exists to keep them apart, so this is the assertion that catches
  // the field being quietly removed again.
  for (const card of cards().filter((c) => c.kind === "method")) {
    for (const id of ["example", "implementations"] as const) {
      const section = cardSections(card).find((s) => s.id === id)!;
      assert.notEqual(
        sectionState(section),
        "no-field-yet",
        `${card.id}/${id} still reports an unbuilt field`,
      );
    }
  }
});

test("the first pseudocode is on the map, and it is the sentences its own record already carries", () => {
  // `backward-euler` is the one populated `example` in the graph. It is here rather than
  // only in a fixture because a model with no instance anywhere has never been rendered in
  // its held state, and "the layout has a value" is not "a reader can see one".
  const input = { graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, corpus: CORPUS, locale: "en", register: PAPER_REGISTER } as const;
  const card = cardFor(input, "backward-euler");
  assert.ok(card?.kind === "method");
  assert.ok(card.example.held, "backward-euler draws no example");
  const { pseudocode, text } = card.example.value;
  assert.ok(pseudocode !== null && pseudocode.includes("\n"), "the pseudocode is not a block");
  // **Every line of it restates a sentence already on the record.** The recurrence is the
  // summary's, verbatim; the loop bound is `repeats.count`. Checked against the record
  // rather than against a copy of the string, so the day somebody edits the summary's
  // recurrence and leaves the listing behind, this fails instead of the reader finding it.
  const node = layerNode(LAYER_GRAPH, "backward-euler")!;
  assert.ok(isMethod(node));
  assert.ok(
    node.summary.includes("(I - hA)u_{k+1} = u_k + h b_{k+1}"),
    "the summary no longer states the recurrence the pseudocode transcribes",
  );
  assert.ok(node.repeats?.["quantum-linear-solve"]?.count.includes("T/h"), "the loop bound moved");
  // Prose is absent and that is deliberate — nobody has written up a run. The owner's
  // "populate on demand" only works if the easy half can ship without the hard half.
  assert.equal(text, null);
  // Pseudocode is not localised: its identifiers are the record's own symbols, and a
  // translated listing is a second one that drifts from the first.
  const ja = cardFor({ ...input, locale: "ja" }, "backward-euler");
  assert.ok(ja?.kind === "method" && ja.example.held);
  assert.equal(ja.example.value.pseudocode, pseudocode);
});

test("an empty Implementations section carries a worklist, and never a count of zero", () => {
  // `W5-card-spec.md`'s rule for an empty card is that it is a **worklist**, not a gap
  // report. The register already records, per paper and from its abstract, whether it
  // reports numerics or a hardware run — so an empty section can say what there is to
  // write instead of only that nothing is written.
  const methods = cards().filter((card) => card.kind === "method");
  let withLeads = 0;
  let simulation = 0;
  let hardware = 0;
  for (const card of methods) {
    assert.ok(card.kind === "method");
    if (!card.implementationLeads.held) continue;
    withLeads += 1;
    const leads = card.implementationLeads.value;
    if (leads.simulation > 0) simulation += 1;
    if (leads.hardware > 0) hardware += 1;
    // A lead is a count of papers actually cited here — it cannot exceed them.
    assert.ok(
      leads.simulation <= (card.papers.held ? card.papers.value.length : 0),
      `${card.id}: more simulation leads than papers`,
    );
  }
  // Measured, not guessed: 25 methods cite a paper the register says reports numerics and
  // 3 cite one reporting hardware. Pinned as floors — the register only grows by somebody
  // reading another abstract, and this going up is the corpus working.
  assert.ok(simulation >= 25, `${simulation} methods have a simulation lead, not 25+`);
  assert.ok(hardware >= 3, `${hardware} methods have a hardware lead, not 3+`);
  console.log(
    `[implementation leads] ${withLeads}/${methods.length} methods have a read paper; ` +
      `${simulation} with numerics, ${hardware} with hardware`,
  );
  // **All 63, and that is a fact about the corpus rather than about the code.** Every
  // method cites at least one paper somebody has read for `reports`, so the absent branch
  // below does not fire anywhere in the graph today. Recorded rather than asserted as a
  // floor, because it going *down* is the interesting direction: a method authored with a
  // single unread citation would land there.
  assert.equal(withLeads, methods.length, `${withLeads}/${methods.length} methods have a read paper`);
});

test("a method whose papers nobody has read reports no leads, rather than none", () => {
  // **Absent, never zero.** A method whose cited papers have no `reports` row has no count
  // to report, and "0 papers report numerics" would claim a search that was never run —
  // the same lie `no-field-yet` exists to keep out of the sections above.
  //
  // Proved against a fixture because the branch is unreachable in the authored graph: all
  // 63 methods cite at least one read paper. An unreachable branch nothing exercises is a
  // branch that is wrong the first time it runs, and 61 of the register's 145 rows carry
  // no `reports` — so the case is one authored citation away, not hypothetical.
  const graph: typeof LAYER_GRAPH = {
    nodes: LAYER_GRAPH.nodes.map((node) =>
      node.id === "backward-euler"
        ? {
            ...node,
            citations: [
              { title: "Unread", authors: "Nobody", year: "2024", url: "https://example.test/unread" },
            ],
          }
        : node,
    ),
  };
  const card = cardFor(
    { graph, vocabulary: STATE_VOCABULARY, corpus: CORPUS, locale: "en", register: PAPER_REGISTER },
    "backward-euler",
  );
  assert.ok(card?.kind === "method");
  assert.equal(card.implementationLeads.held, false);
  assert.equal(card.implementationLeads.held === false && card.implementationLeads.gap, "none-recorded");
});

test("a populated implementation draws the owner's five sub-sections, in his order", () => {
  // **Exercised against a fixture rather than the corpus, on purpose.** Writing
  // implementation entries means reading papers for what was run, on what hardware, with
  // what data — corpus work with its own sourcing discipline, and not something to invent
  // in order to prove a renderer. What has to be true *of the code* is that a populated
  // entry resolves every sub-section and keeps them in his order, and a fixture says that
  // without putting a sentence nobody sourced onto the map.
  const graph: typeof LAYER_GRAPH = {
    nodes: LAYER_GRAPH.nodes.map((node) =>
      node.id === "backward-euler"
        ? {
            ...node,
            implementations: [
              {
                id: "a-run",
                label: "A run",
                labelJa: "ある実行",
                papers: [{ title: "T", authors: "A", year: "2024", url: "https://example.test/x" }],
                about: "about-en",
                aboutJa: "about-ja",
                results: "results-en",
                resultsJa: "results-ja",
              },
            ],
          }
        : node,
    ),
  };
  const card = cardFor(
    { graph, vocabulary: STATE_VOCABULARY, corpus: CORPUS, locale: "en", register: PAPER_REGISTER },
    "backward-euler",
  );
  assert.ok(card?.kind === "method" && card.implementations.held);
  const [entry] = card.implementations.value;
  assert.equal(entry?.label, "A run");
  assert.equal(entry?.papers.length, 1);
  // His five, in his order, every time — resolved here rather than in JSX so that the
  // gaps *inside* an implementation are countable, which is the whole reason this module
  // exists one level up.
  assert.deepEqual(entry?.sections.map((s) => s.id), ["about", "methods", "data", "code", "results"]);
  assert.deepEqual(
    entry?.sections.map((s) => sectionState(s)),
    ["held", "none-recorded", "none-recorded", "none-recorded", "held"],
  );
  // And it localises all the way into the sub-section, which is two levels below the
  // heading a translation pass would notice.
  const ja = cardFor(
    { graph, vocabulary: STATE_VOCABULARY, corpus: CORPUS, locale: "ja", register: PAPER_REGISTER },
    "backward-euler",
  );
  assert.ok(ja?.kind === "method" && ja.implementations.held);
  assert.equal(ja.implementations.value[0]?.label, "ある実行");
  const about = ja.implementations.value[0]?.sections.find((s) => s.id === "about");
  assert.ok(about?.value.held && about.value.value === "about-ja");
});

// --- what a method is a narrower version of ---------------------------------
//
// Session 113, the owner: *"why do LCHS and LCHS improve kernel break down to the same
// thing, they clearly have different implementation so something at least has to change
// right?"*, and on the write-up: *"just make it clear what the difference is, and it should
// show up in UI in clear way without cluttering."*
//
// The chain being identical is correct — the improved-kernel paper changes the kernel
// *inside* `lchs-kernel-identity`, a parameter rather than a construction, which is why the
// duplicate-path gate exempts a declared refinement. What was wrong is that nothing on the
// drawing said the two lanes were related. These pin both halves of "without cluttering":
// the edge is drawn where it exists, and nothing is drawn where it does not.

test("a method's card says what it is a narrower version of, and what narrows it", () => {
  const methods = cards().filter((card): card is Extract<Card, { kind: "method" }> => card.kind === "method");
  const byId = new Map(methods.map((card) => [card.id, card]));
  const declared = LAYER_GRAPH.nodes.filter(
    (node): node is LayerMethod => isMethod(node) && node.refines !== undefined,
  );
  // Five, and the count is pinned because it is the denominator of every claim below —
  // a partition read off a set that silently grew is not the partition that was checked.
  assert.equal(declared.length, 5, `${declared.length} methods declare refines, not 5`);

  for (const node of declared) {
    const card = byId.get(node.id);
    assert.ok(card, `${node.id} draws no method card`);
    assert.equal(card.refines?.id, node.refines, `${node.id}: the card names the wrong parent`);
    // **The round trip, and it is the half that rots.** `refines` is authored on the child
    // and the back-link is a scan, so the two can only disagree if the scan stops matching
    // the field — which is exactly what happens when somebody adds a second way to declare
    // a refinement and updates one reader.
    const parent = byId.get(node.refines!);
    assert.ok(parent, `${node.id} refines ${node.refines}, which draws no card`);
    assert.ok(
      parent.refinedBy.some((child) => child.id === node.id),
      `${node.refines} does not list ${node.id} among its narrower versions`,
    );
  }

  // And nothing anywhere else. A back-link that appeared on a method nothing refines would
  // be a relation invented by the reader rather than declared by the graph.
  const parents = new Set(declared.map((node) => node.refines!));
  for (const card of methods) {
    if (!parents.has(card.id)) {
      assert.equal(card.refinedBy.length, 0, `${card.id} lists narrower versions but nothing refines it`);
    }
  }

  // The "without cluttering" claim, as a number rather than as an intention: this draws on
  // nine cards and is absent — not "none found yet" — on the other fifty-four. If it ever
  // becomes most of them, it is a section and wants a heading, not a line under the lede.
  const drawn = methods.filter((card) => card.refines !== null || card.refinedBy.length > 0);
  assert.equal(
    drawn.length,
    9,
    `the refinement line draws on ${drawn.length} of ${methods.length} cards: ${drawn.map((c) => c.id).sort().join(", ")}`,
  );
});

test("the owner's LCHS pair: the identical chain now says which is the narrower one", () => {
  const input = { graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, corpus: [], locale: "en", register: PAPER_REGISTER } as const;
  const improved = cardFor(input, "lchs-improved-kernel");
  const original = cardFor(input, "lchs-route");
  assert.ok(improved?.kind === "method" && original?.kind === "method");

  assert.equal(improved.refines?.id, "lchs-route");
  assert.deepEqual(original.refinedBy.map((child) => child.id), ["lchs-improved-kernel"]);
  // The two draw the same chain, and that is the fact the reader was tripping over. Pinned
  // here rather than assumed: if the chains ever diverge, this line is the one that says the
  // refinement edge is no longer the *only* thing distinguishing them, and the copy under
  // the lede can stop carrying that weight alone.
  const chain = (card: typeof improved) =>
    card.trace.held ? card.trace.value.map((hop) => `${hop.from}>${hop.to}:${hop.via?.id ?? "own"}`) : [];
  assert.deepEqual(chain(improved), chain(original), "the LCHS pair no longer draws one chain");

  // **What is different is not restated on the card, and that is deliberate.** It is the
  // first sentence of the narrower method's own lede, one click away. A copy here would be
  // the same claim in two places, and the copy is the one that goes stale.
  assert.match(improved.summary, /kernel/i);

  // Both directions localise, all the way to the label a reader actually reads.
  const ja = { ...input, locale: "ja" } as const;
  const improvedJa = cardFor(ja, "lchs-improved-kernel");
  const originalJa = cardFor(ja, "lchs-route");
  assert.ok(improvedJa?.kind === "method" && originalJa?.kind === "method");
  assert.notEqual(improvedJa.refines?.label, improved.refines?.label, "the parent's name did not change locale");
  assert.notEqual(
    originalJa.refinedBy[0]?.label,
    original.refinedBy[0]?.label,
    "the narrower version's name did not change locale",
  );
});

// --- the stretch a method performs itself -----------------------------------
//
// Session 113, the owner: *"I am seeing some blank processes — i would like them
// labeled. I am also confused why there are blank processes in some spots, like
// after hamiltonian simulation… Blank processes should be separately clickable
// than the parent process."*
//
// What he is seeing is `routeOf`'s trailing segment. These pin the inventory he
// asked for, so the next session argues with a number rather than with a
// recollection, and pin that the thing now has an address of its own.

test("the unnamed stretch is 57 of 63 methods, one each, and 14 of them follow a named step", () => {
  const methods: LayerMethod[] = LAYER_GRAPH.nodes.filter(isMethod);
  const withOwn: string[] = [];
  const trailing: Array<{ method: string; after: string; from: string; to: string }> = [];
  for (const method of methods) {
    const route = routeOf(LAYER_GRAPH, STATE_VOCABULARY, method);
    const at = route.segments
      .map((segment, index) => (segment.capabilityId === null ? index : -1))
      .filter((index) => index >= 0);
    // **At most one, and the `own:<methodId>` address depends on it.** A method
    // with two would give two hops the same card, and the card would describe
    // whichever `findIndex` reached first — a wrong answer that looks like a
    // right one. If this ever fires, the address needs the segment index in it.
    assert.ok(at.length <= 1, `${method.id} has ${at.length} unnamed stretches, not at most one`);
    if (at.length === 0) continue;
    withOwn.push(method.id);
    const index = at[0]!;
    if (index === 0) continue;
    trailing.push({
      method: method.id,
      after: route.segments[index - 1]!.capabilityId!,
      from: route.states[index]!,
      to: route.states[index + 1]!,
    });
  }
  console.log(
    `[unnamed stretches] ${withOwn.length}/${methods.length} methods, ${trailing.length} after a named step`,
  );
  assert.equal(withOwn.length, 57);
  assert.equal(trailing.length, 14);

  // The four the owner named. Pinned by their states as well as their ids: the
  // complaint was about a specific place on the drawing, and "after
  // hamiltonian-simulation" is only the same place while the hop is still
  // `evolution-circuit -> solution-answer`.
  const afterSimulation = trailing
    .filter((row) => row.after === "hamiltonian-simulation")
    .map((row) => `${row.method}: ${row.from} -> ${row.to}`)
    .sort();
  assert.deepEqual(afterSimulation, [
    "kvn-simulation-route: evolution-circuit -> solution-answer",
    "lchs-improved-kernel: evolution-circuit -> solution-answer",
    "lchs-route: evolution-circuit -> solution-answer",
    "schrodingerisation: evolution-circuit -> solution-answer",
  ]);
});

test("the unnamed stretch has a card of its own, and it is not the method's card", () => {
  const input = { graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, corpus: [], locale: "en", register: PAPER_REGISTER } as const;
  const card = cardFor(input, ownCardId("lchs-route"));
  assert.ok(card !== null && card.kind === "own-step", "no own-step card for lchs-route");
  assert.equal(card.from, "evolution-circuit");
  assert.equal(card.to, "solution-answer");
  assert.equal(card.method.id, "lchs-route");
  // The two are different cards at different addresses, which is the whole
  // point of the prefix — the owner asked for the blank to be *separately*
  // clickable from its parent.
  const method = cardFor(input, "lchs-route");
  assert.ok(method !== null && method.kind === "method");
  assert.notEqual(card.id, method.id);
  // And the way onward is still there, as on every other card.
  assert.equal(card.pageHref, "/repository/layers/lchs-route");
});

test("an own: card exists for exactly the methods that have the stretch, and no others", () => {
  const input = { graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, corpus: [], locale: "en", register: PAPER_REGISTER } as const;
  let built = 0;
  for (const method of LAYER_GRAPH.nodes.filter(isMethod) as LayerMethod[]) {
    const route = routeOf(LAYER_GRAPH, STATE_VOCABULARY, method);
    const has = route.segments.some((segment) => segment.capabilityId === null);
    const card = cardFor(input, ownCardId(method.id));
    assert.equal(
      card !== null,
      has,
      `${method.id}: own card ${card === null ? "missing" : "built"} but the route ${has ? "has" : "has no"} unnamed stretch`,
    );
    assert.equal(cardExists(input, ownCardId(method.id)), has);
    if (card !== null) built += 1;
  }
  assert.equal(built, 57);
  // A prefix on nothing, and a prefix on a capability, both resolve to shut
  // rather than to something. `?card=` is user-supplied.
  assert.equal(cardExists(input, ownCardId("not-a-method")), false);
  assert.equal(cardExists(input, ownCardId("linear-ode-solve")), false);
  assert.equal(cardExists(input, "own:"), false);
});
