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

import {
  parseCardId,
  parseCardSection,
  parseInnerId,
  SECTION_PARAM,
  withCard,
  withCardSection,
  withInner,
  withIopen,
} from "./repository/map-card.ts";
import {
  drawableSlots,
  figureHref,
  innerToggleHref,
  layoutConverge,
  methodHasInterior,
  resolveOpenIds,
} from "./repository/converge-layout.ts";
import {
  cardExists,
  cardFor,
  cardHopNotes,
  cardRepetitions,
  cardSections,
  ownCardId,
  sectionState,
  type Card,
} from "./repository/card-content.ts";
import { LAYER_GRAPH } from "./repository/layer-graph.ts";
import { STATE_VOCABULARY } from "./repository/state-vocabulary.ts";
import { PAPER_REGISTER } from "./repository/paper-register.ts";
import { isMethod, layerNode, routeOf, type LayerCorpusEntry, type LayerMethod } from "./repository/layers.ts";
import type { SourceCoverage } from "./repository/types.ts";

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
  // Exactly one runnable variant each, because in production **every** record
  // has at least one — 283 of 283 carry `codeVariants`, measured. Before the
  // record join this field did not exist and the fixture was representative
  // without it; now a corpus without it would make the join untestable here and
  // would understate what production feeds, which is the opposite of the
  // upper-bound property this fixture exists to keep.
  runnable: [{ framework: "Qiskit", status: "verified", filename: `${slug}.py` }],
  verification: `${slug} checked`,
  provenance: "Curated reference",
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

test("a card href can say WHERE the click happened, and the occurrence is the link's own, never inherited", () => {
  const base = "/repository/layers?focus=linear-ode-solve&open=a";
  const query = (href: string) => new URLSearchParams(href.slice(href.indexOf("?") + 1));

  const placed = withCard(base, "quantum-linear-solve", "linear-ode-solve:1.0.3");
  assert.equal(query(placed).get("card"), "quantum-linear-solve");
  assert.equal(query(placed).get("sel"), "linear-ode-solve:1.0.3");

  // A `sel` riding in from the base names whatever was selected when the base
  // was built — the OLD place. A link that inherits it claims the reader's next
  // click happened where their last one did.
  assert.equal(query(withCard(placed, "backward-euler")).get("sel"), null);
  assert.equal(
    query(withCard(placed, "backward-euler", "linear-ode-solve:1.1")).get("sel"),
    "linear-ode-solve:1.1",
  );

  // Closing keeps it: the reader finished reading, they did not leave the thing
  // — the same rule the client interceptor applies, now true with JS off too.
  assert.equal(query(withCard(placed, null)).get("sel"), "linear-ode-solve:1.0.3");
});

test("which section is showing is an address, and a stale one never blanks the card", () => {
  // The owner's *"card sections horizontally clickable, not a scroll"*, one level down from
  // the drawing: once only one section is drawn, *which one* is part of what the page is
  // showing, so it lives where everything else about this page lives. It also makes "the
  // Theory of backward Euler" a link somebody can send, on a repository whose purpose is
  // being cited.
  const method = cards().find((card) => card.kind === "method")!;
  const ids = cardSections(method).map((section) => section.id);
  assert.ok(ids.length >= 10, `only ${ids.length} sections to choose between`);

  // Absent, empty and unrecognised all mean "the card's own first" — never "no card".
  // `?card=` cannot do this because there is no sensible default node; a section list is
  // small, fixed and supplied by the card, so every possible value lands somewhere.
  assert.equal(parseCardSection(undefined, ids), null);
  assert.equal(parseCardSection("", ids), null);
  assert.equal(parseCardSection("no-such-section", ids), null);
  assert.equal(parseCardSection("theory", ids), "theory");
  // Only the first, like `?card=`: two sections showing at once is a card the page cannot
  // draw, and a URL should not claim it.
  assert.equal(parseCardSection(["theory", "input"], ids), "theory");
  // A section of a *different* kind of card is not a section of this one. `filled-by` is a
  // process card's, and a reader who opened a method from one must not land on it.
  assert.equal(parseCardSection("filled-by", ids), null);

  const base = "/repository/layers?focus=quantum-linear-solve&open=a&at=1.5.2.3&card=hhl-qpe-inversion";
  const showing = withCardSection(base, "theory");
  const params = new URLSearchParams(showing.slice(showing.indexOf("?") + 1));
  // Everything the reader was holding survives, exactly as opening the card does.
  assert.equal(params.get("focus"), "quantum-linear-solve");
  assert.deepEqual(params.getAll("open"), ["a"]);
  assert.equal(params.get("at"), "1.5.2.3");
  assert.equal(params.get("card"), "hhl-qpe-inversion");
  assert.equal(params.get(SECTION_PARAM), "theory");
  // One section at a time in the URL as well as on the page: switching replaces rather
  // than appends, so an address cannot accumulate a history of what was read.
  assert.deepEqual(
    new URLSearchParams(withCardSection(showing, "output").split("?")[1]!).getAll(SECTION_PARAM),
    ["output"],
  );
  // **A new card starts at its own first section.** Carrying `?sec=` across would leave the
  // URL naming a section the page is not showing — it falls back, but by accident rather
  // than by intent, and the address goes on making a claim that is not true.
  assert.equal(new URLSearchParams(withCard(showing, "backward-euler").split("?")[1]!).get(SECTION_PARAM), null);
  assert.equal(new URLSearchParams(withCard(showing, null).split("?")[1]!).get(SECTION_PARAM), null);
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
      // s121 (W17): folded refinements, after Performance — "same walk,
      // better analysis" is a performance-adjacent sentence, and like
      // Contested it is commentary on the method's standing rather than part
      // of the recipe above it.
      "refinements",
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
    // Eleven on a method (ten until s121 — `refinements` is W17's addition),
    // six on a process — the two card kinds are different shapes, and a
    // count that only fitted the fatter one would pass a process card that had lost half
    // its sections.
    const expected = card.kind === "method" ? 11 : 6;
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
  // number, which is a change somebody has to justify in a diff. 16 until s121
  // (`method:refinements` is W17's addition).
  assert.equal(seen.size, 17, `${seen.size} distinct sections: ${[...seen].sort().join(", ")}`);
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
  // **91 until W21.** The variational region (`plans/atlas-revamp/W21-the-variational-region.md`)
  // added 14: `variational-ground-state` draws three, `variational-imaginary-time` two, and the
  // adaptive and gradient methods one apiece for the `observable-estimation` stub their sources
  // say they hang. Updated deliberately, which is what the paragraph above asks for.
  // **122 since W21-E.** The excited-state region added 17: the four routes that reuse
  // VQE's three hops draw three apiece, the deflation route draws those three plus the
  // `ground-state-energy` ingredient it hangs, and the subspace-expansion and
  // equation-of-motion routes draw their own stretch beside two ingredients each.
  // 124 since B5 unit 3: the two new leaves draw one hop each.
  // 127 since B5's three leaf anchors, one hop each.
  // 132 since `layerwise-training`, and it adds exactly ONE despite having a step. The
  // `ansatz-construction` it declares is an ingredient it HANGS, not a named segment on its
  // spine — `routeOf` gives it the single stretch `parameterized-circuit → prepared-state`
  // and nothing else — so the step it consumes costs a stub on the drawing and no second hop
  // here. Worth stating because the arithmetic looks wrong otherwise: a method with a step
  // that contributes one hop is the ingredient shape, not a miscount.
  // +2 in session 129: `berry-multistep` carries a hop note on each of the two stretches it
  // delegates — the same pair `taylor-all-at-once` does, and the contrast with the note above
  // is exactly the ingredient/segment distinction.
  // 137 in session 130: `childs-liu-spectral` carries two (its Chebyshev
  // collocation and its linear solve) and `chebyshev-pseudospectral-collocation`
  // one (its own stretch).
  assert.equal(hops, 137, `${hops} hops, not 137`);

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

test("every authored hop note reaches the card, including the ones keyed to an ingredient", () => {
  // **The failure this exists to stop, found by walking into it.** `hops` is keyed by a step
  // id, `validateLayerGraph` accepts any of the method's steps, and until this test the card
  // read a note only off the CHAIN. A step is either a chain hop or an ingredient — and a
  // note keyed to an ingredient rendered on no surface at all: Theory held, Requires held,
  // and several paragraphs of sourced mathematics simply gone. `hhl-qpe-inversion` delegates
  // all three of its steps as ingredients, so its route draws one segment and *every*
  // sentence about preparing |b⟩ O(κ) times had nowhere to go. That is the hop where the
  // route's dominant cost lives.
  //
  // It is the same argument `IngredientList` already makes for `repeats` — *"7 of the 10
  // records key a `feeds` step rather than a hop… A count drawn only on the chain would have
  // left every one of them exactly where it was — nowhere"* — and it had only been applied to
  // one of the two fields keyed that way.
  //
  // The expected set is read off the graph rather than typed here, so authoring a note
  // against a step no surface reads fails this test rather than going quietly missing.
  let checked = 0;
  let viaIngredient = 0;
  for (const locale of ["en", "ja"] as const) {
    for (const card of cards(locale)) {
      if (card.kind !== "method") continue;
      const node = LAYER_GRAPH.nodes.find((one) => one.id === card.id)!;
      if (!isMethod(node) || node.hops === undefined) continue;
      const onChain = new Map(
        (card.trace.held ? card.trace.value : []).map((hop) => [hop.via?.id ?? card.id, hop.theory]),
      );
      const onList = new Map(
        (card.ingredients.held ? card.ingredients.value : []).map((item) => [item.link.id, item.theory]),
      );
      for (const key of Object.keys(node.hops)) {
        const drawn = onChain.get(key) ?? onList.get(key);
        assert.ok(
          drawn !== undefined && drawn.held,
          `${card.id} (${locale}): the note keyed "${key}" renders on no surface — it is neither a hop of the drawn chain nor an ingredient`,
        );
        checked += 1;
        if (onChain.get(key) === undefined) viaIngredient += 1;
      }
    }
  }
  // Floors, not exact counts: authoring more notes must not fail this. But the ingredient
  // arm must be non-zero, or the surface this test was written for is untested and could be
  // deleted without anything going red.
  assert.ok(checked > 0, "no authored hop notes at all — this test is asserting nothing");
  assert.ok(
    viaIngredient > 0,
    `${viaIngredient} notes reach the card through the ingredient list — the arm this test exists for is unexercised`,
  );
});

// --- how many times a step is walked ----------------------------------------

test("every recorded multiplicity reaches the card, and the card is where most of them are ingredients", () => {
  // **The card was the one surface that said nothing about `repeats` at all.** Measured in
  // `W12-what-the-map-cannot-say.md` across canvas, card and node page: it is on 9 methods —
  // nearly twice as many as `refines` — and only the node page drew it. Two methods filling
  // one slot, one of them walking it T/h times, read as the same card.
  //
  // **The subject here is a record that reaches nowhere**, which is the failure this data
  // shape allows and no section census can see. `repeats` keys a *step*; a step is either a
  // hop of the chain or an ingredient; those are two different pieces of the panel. A count
  // keyed to something that is neither would render on no surface and no section would report
  // a gap — Theory held, Requires held, and the fact simply gone. So the expected set is read
  // off the graph rather than typed here: authoring a tenth record fails this test until the
  // card draws it.
  const expected = new Map<string, { step: string; count: string; closure: string }[]>();
  for (const node of LAYER_GRAPH.nodes) {
    if (!isMethod(node) || node.repeats === undefined) continue;
    expected.set(
      node.id,
      Object.entries(node.repeats).map(([step, repetition]) => ({
        step,
        count: repetition.count,
        closure: repetition.closure,
      })),
    );
  }
  const places = { hop: 0, ingredient: 0 };
  let drawn = 0;
  for (const card of cards()) {
    const swept = cardRepetitions(card);
    const want = expected.get(card.id) ?? [];
    assert.deepEqual(
      [...swept].map((one) => ({ step: one.step, count: one.count, closure: one.closure })).sort((a, b) => a.step.localeCompare(b.step)),
      [...want].sort((a, b) => a.step.localeCompare(b.step)),
      `${card.id}: the card draws a different set of multiplicities than the graph records`,
    );
    for (const one of swept) {
      places[one.place] += 1;
      drawn += 1;
    }
  }
  const recorded = [...expected.values()].reduce((sum, list) => sum + list.length, 0);
  assert.equal(drawn, recorded, `${drawn} multiplicities drawn against ${recorded} recorded`);
  // **Both places must have an instance, and this is the correction to the plan.** `W12`
  // proposed drawing the count *"beside the lane's name"* on the assumption these sat on the
  // chain. They mostly do not: only `time-marching-usva`, `qsvt-matrix-inversion` and
  // `qsvt-transform` repeat a hop. HHL's preparation and Hamiltonian simulation, and all three
  // readouts' preparation, are
  // `feeds` — so a count drawn on the chain alone would have reached 3 of the 8 records and
  // left the five most expensive loops on this map exactly as invisible as they were. (10 and
  // six until session 118 took the two iterators' linear solve off the map.)
  //
  // Asserted as "neither is zero" rather than as 3 and 5, because both are corpus counts that
  // should be free to move; what must not happen is a rendering path with no instance, which
  // is a path nobody has ever seen drawn.
  assert.ok(places.hop >= 1, "no multiplicity lands on a hop — that rendering path draws nowhere");
  assert.ok(
    places.ingredient >= 1,
    "no multiplicity lands on an ingredient — that rendering path draws nowhere",
  );
  console.log(
    `[repeat census] ${recorded} records on ${expected.size} methods, ` +
      `${places.hop} on a hop, ${places.ingredient} on an ingredient`,
  );
});

test("a multiplicity is drawn in the reader's language, and its closure is not", () => {
  // The count and the note are authored twice and must both change; the closure is an enum
  // and must not, because a `measured` loop is `measured` in both locales and the class name,
  // the `data-closure` attribute and every sweep over them are keyed on it.
  let compared = 0;
  for (const node of LAYER_GRAPH.nodes) {
    if (!isMethod(node) || node.repeats === undefined) continue;
    const en = cardRepetitions(
      cardFor({ graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, corpus: CORPUS, locale: "en", register: PAPER_REGISTER }, node.id)!,
    );
    const ja = cardRepetitions(
      cardFor({ graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, corpus: CORPUS, locale: "ja", register: PAPER_REGISTER }, node.id)!,
    );
    assert.equal(ja.length, en.length, `${node.id}: the two locales drew different counts`);
    for (const [index, one] of en.entries()) {
      const other = ja[index]!;
      assert.equal(other.step, one.step, `${node.id}: the locales ordered multiplicities differently`);
      assert.equal(other.closure, one.closure, `${node.id}: the closure changed with the locale`);
      assert.notEqual(other.count, one.count, `${node.id}: ${one.step}'s count did not change locale`);
      compared += 1;
    }
  }
  // 10 until session 118. `backward-euler` and `trapezoidal-rule` each recorded a
  // `×T/h` on the `quantum-linear-solve` step they hung as an ingredient, and the
  // owner ruled that step out — *"this is not how i want an iterator to be
  // visualized"* — so both records went with it. The two counts survive as prose
  // in each method's `conditions`. **The floor falls for a reason, and the reason
  // is written here**, because a floor lowered to fit is indistinguishable from
  // one lowered because the thing it measured got smaller.
  assert.ok(compared >= 8, `only ${compared} multiplicities were comparable across locales`);
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
  // **The record side — where the ceiling used to be, and why it is gone.**
  //
  // This was `withRecord <= 26`, a pin that moved 12 -> 22 -> 26 in one evening,
  // each raise individually justified and the sequence with no terminating case.
  // It was measuring a premise: *"the record side is thin, so the card reads the
  // node because the record is empty."*
  //
  // **That premise is refuted, not strained.** The record side is 283 records and
  // every one of them carries runnable code, while `implementations` was empty on
  // all 74 methods — and in all 27 method->record pairs the card rendered
  // "none-recorded" over a record that had code. The section was never
  // un-researched; nothing had joined it. Owner ruling `27267f` merged them
  // (`plans/atlas-revamp/W23-record-join.md`), so a count of how few methods name
  // a record no longer measures anything anyone would act on.
  //
  // What replaces it is an invariant of the merged shape, which holds at ANY
  // density — that is what makes it terminating where a ceiling was not. A count
  // that may only go down is a gate that eventually blocks the work it protects.
  const withRecord = held("records");
  const joined = methods.flatMap((card) =>
    card.implementations.held ? card.implementations.value : [],
  );
  const fromRecord = joined.filter((entry) => entry.origin.kind === "record");

  // 1. Every pair composes. A method that names a record whose variants are
  //    projected must render them — this is the exact bug the ruling fixed, so
  //    it is the exact thing that must not come back.
  for (const card of methods) {
    const names = cardSections(card).find((s) => s.id === "records");
    if (names === undefined || sectionState(names) !== "held") continue;
    assert.ok(
      card.implementations.held,
      `${card.id} names a repository record and still reports no implementations — ` +
        `the join regressed to reading the node alone`,
    );
    assert.ok(
      (card.implementations.value as readonly { origin: { kind: string } }[]).some(
        (entry) => entry.origin.kind === "record",
      ),
      `${card.id} names a record but every implementation it shows is authored`,
    );
  }

  // 2. The stamp is never absent, and never wrong. Two branches of the W5 tree
  //    now share one list, and unstamped they are indistinguishable — a corpus
  //    scaffold reading as a paper reproduction is a provenance claim nobody made.
  for (const entry of joined) {
    assert.ok(
      entry.origin.kind === "authored" || entry.origin.kind === "record",
      `implementation ${entry.id} carries no classification stamp`,
    );
    if (entry.origin.kind === "record") {
      assert.ok(entry.origin.slug.length > 0, `${entry.id} is stamped as a record with no slug`);
      assert.equal(
        entry.origin.href,
        `/repository/${entry.origin.slug}`,
        `${entry.id} links somewhere other than the record it is stamped with`,
      );
      // Branch three is "not from a paper". An entry claiming both is the one
      // combination the tree cannot represent.
      assert.equal(entry.papers.length, 0, `${entry.id} is stamped as a record and cites papers`);
    }
  }

  // 3. The join reaches every record the graph names. Not a floor that can be
  //    raised — a statement that the two sides agree about which pairs exist.
  const slugsNamed = new Set(
    methods.flatMap((card) => (card.records.held ? card.records.value.map((r) => r.slug) : [])),
  );
  const slugsJoined = new Set(
    fromRecord.map((entry) => (entry.origin.kind === "record" ? entry.origin.slug : "")),
  );
  for (const slug of slugsNamed) {
    assert.ok(
      slugsJoined.has(slug),
      `record ${slug} is named by a method card and contributes no implementation`,
    );
  }

  console.log(
    `[card census] ${methods.length} methods: input/output ${held("input")}, theory ${held("theory")}, ` +
      `papers ${withPapers}, conditions ${held("when-it-applies")}, performance ${held("performance")}, ` +
      `contested ${held("contested")}, requires ${held("requires")}, records ${withRecord}, ` +
      `implementations ${joined.length} (${fromRecord.length} joined from records)`,
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
          jaIngredients[index]?.link.id,
          item.link.id,
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
  // `backward-euler` is here, against the real graph rather than only a fixture, because a
  // model with no instance anywhere has never been rendered in its held state, and "the
  // layout has a value" is not "a reader can see one".
  //
  // **It is NOT "the one populated `example` in the graph", which is what this comment said
  // for several sessions.** That was false when it was written and stayed false while the
  // corpus moved under it — dozens of methods carry an `example`, and the count has moved
  // three times this month. The claim survived because nothing checks a comment: the
  // assertions below never depended on uniqueness, so it cost nothing until somebody read it
  // and believed it.
  //
  // **So the census is printed rather than written down here.** A second number in prose is
  // how the first one got stale, and the fix for a comment that quotes a measurement is not
  // a fresher measurement.
  //
  // What this test actually holds is three separate things, and they are worth naming so the
  // next edit knows which one it is touching: that a card renders a *held* example at all;
  // that the pseudocode restates sentences the record itself carries, checked against the
  // record rather than against a copy; and that both the half-filled and the fully-filled
  // shapes exist somewhere in the corpus. None of those is a claim about this record being
  // the only one of anything.
  const input = { graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, corpus: CORPUS, locale: "en", register: PAPER_REGISTER } as const;
  const methods = LAYER_GRAPH.nodes.filter(isMethod);
  const examples = methods.filter((node) => node.example !== undefined);
  console.log(
    `[example census] ${examples.length} of ${methods.length} methods carry an example · `
      + `${examples.filter((node) => (node.example?.pseudocode ?? "").trim() !== "").length} pseudocode · `
      + `${examples.filter((node) => (node.example?.text ?? "").trim() !== "").length} a run in prose`,
  );
  const card = cardFor(input, "backward-euler");
  assert.ok(card?.kind === "method");
  assert.ok(card.example.held, "backward-euler draws no example");
  const { pseudocode, text } = card.example.value;
  assert.ok(pseudocode !== null && pseudocode.includes("\n"), "the pseudocode is not a block");
  // **Every line of it restates a sentence already on the record.** The recurrence is the
  // summary's, verbatim; the loop bound is `conditions`'. Checked against the record
  // rather than against a copy of the string, so the day somebody edits the summary's
  // recurrence and leaves the listing behind, this fails instead of the reader finding it.
  //
  // The loop bound was `repeats["quantum-linear-solve"].count` until session 118 removed
  // that step as an ingredient. **This assertion moved with the sentence rather than being
  // deleted** — the listing's `for k = 0 … T/h − 1` still needs a source on the record, and
  // a guard whose subject is gone is a guard that has stopped guarding.
  const node = layerNode(LAYER_GRAPH, "backward-euler")!;
  assert.ok(isMethod(node));
  assert.ok(
    node.summary.includes("(I - hA)u_{k+1} = u_k + h b_{k+1}"),
    "the summary no longer states the recurrence the pseudocode transcribes",
  );
  assert.equal(node.repeats, undefined, "the step this loop bound was keyed to is back");
  assert.ok(node.conditions?.includes("T/h"), "the loop bound moved");
  // **The half-filled shape, and this record is back in it.** The point this assertion
  // has always made is that a card can hold pseudocode with no prose — the owner's
  // "populate on demand" only works if the easy half ships without the hard half.
  //
  // For a few hours on 2026-08-12 `backward-euler` also carried prose, and it was a
  // negative account: Dong, Li and Xue's numerics are diagonal Padé at order nine and
  // this method is the $(0,1)$ approximant they set aside two sections earlier. The
  // owner then ruled that the field is for runs only (EshMis/ai-ops#19) — because a
  // negative account is a claim about one paper written where a reader takes it as a
  // claim about the method, and most of these methods do have a run in a paper this
  // record has not cited. So the prose came off, and this record is the half-filled
  // subject again.
  assert.equal(text, null, "backward-euler carries example prose — #19 ruled this field runs-only");
  const halfFilled = cardFor(input, "chebyshev-lcu-inversion");
  assert.ok(halfFilled?.kind === "method" && halfFilled.example.held);
  assert.ok(halfFilled.example.value.pseudocode !== null, "the half-filled subject lost its listing");
  assert.equal(halfFilled.example.value.text, null);
  // **And the fully-filled shape still exists**, on one of the three genuine runs, so
  // "a card can hold both" stays a checked claim rather than one nothing exercises. A
  // guard whose subject is gone is a guard that has stopped guarding — the same rule
  // the `repeats` paragraph above applied — and dropping this alongside the prose would
  // have left the both-halves path with no witness at all.
  const bothHalves = cardFor(input, "eigenstate-filtering-inversion");
  assert.ok(bothHalves?.kind === "method" && bothHalves.example.held);
  assert.ok(bothHalves.example.value.pseudocode !== null, "the both-halves subject lost its listing");
  assert.ok(
    (bothHalves.example.value.text ?? "").length > 0,
    "no method carries example prose any more — if that is deliberate, this guard needs a new subject or a deletion",
  );
  // **And the run says whose it is, and what kind.** `example.run` was added to make a
  // negative account unwritable, and it would do that job as validation data that
  // renders nowhere — which is how the fact a reader most needs stays invisible. All
  // three runs in the graph are classical simulations, and an "Example" section with
  // numbers under it reads as a quantum execution unless the card says otherwise.
  assert.equal(
    bothHalves.example.value.runNote,
    "Classical simulation · Section 4.3, Figure 2 of arXiv:1910.14596",
  );
  // A record with no prose has no provenance line to draw — the two are required
  // together, so a line under nothing would mean the validator had been bypassed.
  assert.equal(halfFilled.example.value.runNote, null);
  const bothHalvesJa = cardFor({ ...input, locale: "ja" }, "eigenstate-filtering-inversion");
  assert.ok(bothHalvesJa?.kind === "method" && bothHalvesJa.example.held);
  assert.equal(
    bothHalvesJa.example.value.runNote,
    "古典計算機によるシミュレーション・arXiv:1910.14596 Section 4.3, Figure 2",
  );
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

test("every declared absence reaches a reader, in both locales", () => {
  // **`noneFound` is right when nobody has looked and wrong when somebody has.**
  // A record that declares why a field is empty has been read; showing it "None
  // found yet." tells the reader the opposite of what the record knows.
  //
  // Asserted against the AUTHORED graph rather than a fixture, deliberately and
  // against this directory's usual rule. The claim is not that the plumbing
  // works — it is that **every declaration in the corpus actually surfaces**, and
  // a fixture proves that on data nobody ships. It caught the case this test was
  // first written wrong for: four of the six declarations are `example.text` on
  // methods that HAVE pseudocode, so their Example section is held, the
  // section-level gap note never draws, and the reason had nowhere to go until
  // `CardExample.textReason` existed. The pseudocode was hiding the account of
  // the missing half.
  const reaching = (card: Card, field: string): string | null => {
    if (card.kind !== "method") return null;
    if (field === "cost") return card.cost.held === false ? (card.cost.reason ?? null) : null;
    if (field === "conditions") {
      return card.whenItApplies.held === false ? (card.whenItApplies.reason ?? null) : null;
    }
    if (field === "implementations") {
      return card.implementations.held === false ? (card.implementations.reason ?? null) : null;
    }
    if (field === "example.text") {
      return card.example.held ? card.example.value.textReason : (card.example.reason ?? null);
    }
    return card.example.held === false ? (card.example.reason ?? null) : null;
  };
  let declared = 0;
  for (const locale of ["en", "ja"] as const) {
    const input = { graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, corpus: CORPUS, locale, register: PAPER_REGISTER } as const;
    for (const node of LAYER_GRAPH.nodes) {
      if (!isMethod(node) || node.absences === undefined) continue;
      const card = cardFor(input, node.id);
      assert.ok(card?.kind === "method");
      for (const field of Object.keys(node.absences)) {
        const shown = reaching(card, field);
        assert.ok(
          shown !== null && shown.trim().length > 40,
          `${node.id} (${locale}): the declared reason for ${field} does not reach a reader`,
        );
        declared += 1;
      }
    }
  }
  // Non-vacuous, and the floor is the six declarations the graph carries, across
  // both locales. (Written "PR 452" rather than with a hash: check-raw-hex reads
  // a three-digit PR reference as a colour literal, which is how this landed a
  // red `ts` job the first time.)
  assert.ok(declared >= 12, `${declared} declarations checked, fewer than the 12 that exist`);
  // The two locales must not be one string — the failure a paired field has, and
  // the one an English-only read cannot see.
  const en = cardFor({ graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, corpus: CORPUS, locale: "en", register: PAPER_REGISTER }, "backward-euler");
  const ja = cardFor({ graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, corpus: CORPUS, locale: "ja", register: PAPER_REGISTER }, "backward-euler");
  assert.ok(en?.kind === "method" && ja?.kind === "method");
  assert.notEqual(reaching(en, "implementations"), reaching(ja, "implementations"));
  // And a gap with NO declaration still gets the standing sentence — this must
  // not turn every empty field into a claim. `qsvt-transform` carries no
  // `absences` at all.
  const undeclared = cardFor({ graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, corpus: CORPUS, locale: "en", register: PAPER_REGISTER }, "qsvt-transform");
  assert.ok(undeclared?.kind === "method");
  assert.equal(reaching(undeclared, "example.text"), null);
});

test("an empty Implementations section says WHICH of the three things it means", () => {
  // **Zero became ambiguous on 2026-08-12 and the card had one sentence for two
  // very different facts.** Until then every populated register row was an abstract read,
  // and `papers.ts` forbids an abstract read from claiming a paper has no numerics — so
  // `simulation: 0` always meant "the abstracts did not mention any" and silence was
  // right. Full-text reads make zero mean either "every cited paper was read and none
  // reports a run", which is the section's final answer, or "nobody has looked", which is
  // work. `unread` is the number that tells them apart, and the panel picks the sentence.
  //
  // Ordering matters and is asserted here rather than left to the component: a LEAD
  // outranks everything, because there is already work to do; and the finding may only be
  // claimed when NOTHING is unread, since one unread paper makes "none reports a run" a
  // claim about a paper nobody opened.
  const paper = (url: string, reports?: SourceCoverage) => ({
    id: `arxiv:${url.slice(-4)}`,
    title: "A paper",
    authors: "Someone",
    year: "2020",
    url,
    ...(reports ? { reports, reportsBasis: "full-text" as const } : {}),
  });
  const register = {
    papers: [
      paper("https://example.org/0001", { theory: "reported", simulation: "reported", hardware: "absent" }),
      paper("https://example.org/0002", { theory: "reported", simulation: "absent", hardware: "absent" }),
      paper("https://example.org/0003"),
    ],
  };
  const cite = (url: string) => ({ title: "A paper", authors: "Someone", year: "2020", url });
  // The fixture is built inline rather than off the authored graph on this
  // directory's standing rule: a test that reads the real corpus asserts today's
  // content and goes green the day the content changes for an unrelated reason.
  // The states are the vocabulary's own so `routeOf` resolves; nothing here
  // depends on which they are.
  const entry = STATE_VOCABULARY.states[0]!.id;
  const exit = STATE_VOCABULARY.states[1]!.id;
  const shape = { from: entry, to: exit, takes: "t", takesJa: "t", returns: "r", returnsJa: "r" };
  const filler = (id: string, urls: string[]) =>
    ({
      kind: "method",
      id,
      label: id,
      labelJa: id,
      summary: "s",
      summaryJa: "s",
      realizes: "solve",
      steps: [],
      atomic: true,
      citations: urls.map(cite),
    }) as const;
  const graph = {
    nodes: [
      {
        kind: "capability",
        id: "solve",
        label: "solve",
        labelJa: "solve",
        summary: "s",
        summaryJa: "s",
        contract: shape,
        whyALayer: "w",
        whyALayerJa: "w",
      },
      filler("has-a-lead", ["https://example.org/0002", "https://example.org/0001"]),
      filler("all-read-none-report", ["https://example.org/0002"]),
      filler("something-unread", ["https://example.org/0002", "https://example.org/0003"]),
    ],
  } as const;
  const at = (id: string) => {
    const card = cardFor(
      { graph, vocabulary: STATE_VOCABULARY, corpus: [], locale: "en", register } as never,
      id,
    );
    assert.ok(card?.kind === "method" && card.implementationLeads.held, `${id}: no leads`);
    return card.implementationLeads.value;
  };
  assert.deepEqual(at("has-a-lead"), { simulation: 1, hardware: 0, unread: 0 });
  assert.deepEqual(at("all-read-none-report"), { simulation: 0, hardware: 0, unread: 0 });
  // A citation the register does not carry counts as UNREAD rather than being dropped.
  // `check-layer-graph.mjs` proves every citation resolves against the register in the
  // repo and nothing proves it against the register the page was built from; omitting it
  // would turn a shortfall into the stronger claim, which is the direction this module
  // never lets a count move.
  assert.deepEqual(at("something-unread"), { simulation: 0, hardware: 0, unread: 1 });
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
  // Six since W21: `qubit-adapt-ansatz` refines `adapt-ansatz`, with the mark "ADAPT"
  // verifiable against the parent's own label in both locales, as validation requires.
  // 7 since B5 folded `tetris-adapt-ansatz` into `adapt-ansatz` (W17/s121).
  assert.equal(declared.length, 8, `${declared.length} methods declare refines, not 8`);

  for (const node of declared) {
    const card = byId.get(node.id);
    assert.ok(card, `${node.id} draws no method card`);
    assert.equal(card.refines?.id, node.refines, `${node.id}: the card names the wrong parent`);
    // **The round trip, and it is the half that rots.** `refines` is authored on the child
    // and the back-link is a scan, so the two can only disagree if the scan stops matching
    // the field — which is exactly what happens when somebody adds a second way to declare
    // a refinement and updates one reader. Since s121 (W17) the scan has two
    // homes and each child has exactly one: a FOLDED child
    // (`sameInternalsAsParent`) is a full entry in the parent's `refinements`
    // section, a drawn child is a chrome link in `refinedBy` — never both.
    const parent = byId.get(node.refines!);
    assert.ok(parent, `${node.id} refines ${node.refines}, which draws no card`);
    if (node.sameInternalsAsParent === true) {
      assert.ok(
        parent.refinements.held &&
          parent.refinements.value.some((entry) => entry.link.id === node.id),
        `${node.refines} does not carry folded ${node.id} in its refinements section`,
      );
      assert.ok(
        !parent.refinedBy.some((child) => child.id === node.id),
        `${node.refines} lists folded ${node.id} in chrome too — one child, one home`,
      );
    } else {
      assert.ok(
        parent.refinedBy.some((child) => child.id === node.id),
        `${node.refines} does not list ${node.id} among its narrower versions`,
      );
      assert.ok(
        !(parent.refinements.held && parent.refinements.value.some((entry) => entry.link.id === node.id)),
        `${node.refines} carries drawn ${node.id} in its refinements section too`,
      );
    }
  }

  // And nothing anywhere else. A back-link that appeared on a method nothing refines would
  // be a relation invented by the reader rather than declared by the graph.
  const parents = new Set(declared.map((node) => node.refines!));
  for (const card of methods) {
    if (!parents.has(card.id)) {
      assert.equal(card.refinedBy.length, 0, `${card.id} lists narrower versions but nothing refines it`);
      assert.ok(
        !card.refinements.held,
        `${card.id} holds a refinements section but nothing refines it`,
      );
    }
  }

  // The "without cluttering" claim, as a number rather than as an intention. Nine cards
  // until s121: the fold moved three children out of chrome-on-parent into the parents'
  // sections, so the chrome now draws on six cards (five children's own back-links +
  // koopman-linearization's two drawn narrower versions) and the section holds on three
  // (taylor-all-at-once, lchs-route, sabre-routing). If chrome ever becomes most of the
  // sixty-three, it is a section and wants a heading, not a line under the lede.
  // **Eight since W21**, and the two added are one pair rather than two facts: the ADAPT
  // lineage draws the line on the child (`qubit-adapt-ansatz`, its own back-link) and on
  // the parent (`adapt-ansatz`, its one drawn narrower version). The ratio the paragraph
  // above cares about barely moved — 8 of 74 against 6 of 63 — so this is still chrome.
  const drawn = methods.filter((card) => card.refines !== null || card.refinedBy.length > 0);
  assert.equal(
    drawn.length,
    // 9 since B5 folded `tetris-adapt-ansatz` into `adapt-ansatz`: the refinement LINE is
    // a card-level statement ("a narrower version of X"), which a folded refinement still
    // makes — folding removes its LANE from the slot figure, never its card.
    10,
    `the refinement line draws on ${drawn.length} of ${methods.length} cards: ${drawn.map((c) => c.id).sort().join(", ")}`,
  );
  const sectioned = methods.filter((card) => card.refinements.held);
  assert.deepEqual(
    sectioned.map((c) => c.id).sort(),
    // `adapt-ansatz` is a fourth folded parent since B5 folded TETRIS-ADAPT into it:
    // the section is where a folded refinement lives instead of on the map.
    ["adapt-ansatz", "lchs-route", "qcc-ansatz", "sabre-routing", "taylor-all-at-once"],
    "the refinements section holds on exactly the five folded parents",
  );
});

test("the owner's LCHS pair: the fold puts the narrower one inside the broader card", () => {
  // Session 113 asked the pair to say which is narrower; s121 went further, in
  // the owner's own words: *"it just doesn't make sense to put LCHS with
  // improved kernel as a separate process when we haven't researched the
  // internals enough … the refinement can exist within the LCHS card within
  // its own section."* So the improved kernel is FOLDED (W17): no lane of its
  // own, a full entry in the LCHS card's Refinements section, its node and
  // page untouched.
  const input = { graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, corpus: [], locale: "en", register: PAPER_REGISTER } as const;
  const improved = cardFor(input, "lchs-improved-kernel");
  const original = cardFor(input, "lchs-route");
  assert.ok(improved?.kind === "method" && original?.kind === "method");

  // The child's own back-link survives the fold; the parent's chrome does not
  // carry it — the section is its one home on the parent.
  assert.equal(improved.refines?.id, "lchs-route");
  assert.deepEqual(original.refinedBy, []);
  assert.ok(original.refinements.held, "the LCHS card holds no refinements section");
  const entry = original.refinements.value.find((e) => e.link.id === "lchs-improved-kernel");
  assert.ok(entry, "the improved kernel is not in the LCHS card's refinements section");

  // The two still record the same chain — the fold is a consequence of that
  // fact, and validation refuses the flag the day the chains diverge, so this
  // pin is what says "the fold is still earned" rather than inherited.
  const chain = (card: typeof improved) =>
    card.trace.held ? card.trace.value.map((hop) => `${hop.from}>${hop.to}:${hop.via?.id ?? "own"}`) : [];
  assert.deepEqual(chain(improved), chain(original), "the LCHS pair no longer records one chain");

  // **What is different is still the child's own words, read in place, not
  // copied.** The entry's lede is the child's `summary` (the kernel, its decay
  // rate, what it replaces) and the potential-path note is the child's own
  // `potentialPath` — the owner's "recorded as potential for new paths".
  assert.match(entry!.summary, /kernel/i);
  assert.match(improved.summary, /kernel/i);
  assert.equal(entry!.summary, improved.summary, "the entry restates instead of reading the lede");
  assert.ok(entry!.potentialPath.length > 0, "the fold carries no potential-path note");

  // Both directions localise, all the way to the strings a reader actually reads.
  const ja = { ...input, locale: "ja" } as const;
  const improvedJa = cardFor(ja, "lchs-improved-kernel");
  const originalJa = cardFor(ja, "lchs-route");
  assert.ok(improvedJa?.kind === "method" && originalJa?.kind === "method");
  assert.notEqual(improvedJa.refines?.label, improved.refines?.label, "the parent's name did not change locale");
  assert.ok(originalJa.refinements.held, "the ja card lost the section");
  const entryJa = originalJa.refinements.value.find((e) => e.link.id === "lchs-improved-kernel");
  assert.ok(entryJa, "the ja section lost the improved kernel");
  assert.notEqual(entryJa!.summary, entry!.summary, "the entry's lede did not change locale");
  assert.notEqual(entryJa!.potentialPath, entry!.potentialPath, "the potential-path note did not change locale");
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

test("the unnamed stretch is 56 of 63 methods, one each, and 13 of them follow a named step", () => {
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
  // 57/14 until session 120: the W14 wiring closed the KvN route's blank —
  // its readout is now the `observable-estimation` step (Joseph §V C, owner
  // ruling), it lands on `observable-value`, which satisfies the slot's
  // `solution-answer` exit, so the route has no own stretch any more.
  // 56/13 until W21. Every one of the ten new variational methods has an own stretch,
  // because a slot that has just been opened has nothing decomposed inside it yet — that
  // is the honest starting state of a new region and not a defect in it. The trailing
  // count moved by one: `variational-ground-state` ends on `observable-estimation`, so
  // its blank follows a named step rather than standing alone.
  // 68 since W21-E: the subspace-expansion and equation-of-motion routes each close
  // the whole stretch themselves — they take the ground state as an ingredient and do
  // their own work with it — while the other five excited-state routes end on
  // `observable-estimation` and so have no own stretch, exactly as VQE does not.
  // 70 since B5 unit 3: the two new leaves each close their own stretch.
  // 78 since `layerwise-training`. Its stretch stands at index 0 rather than after a named
  // step — the slot it consumes is an ingredient hanging off the strand, not something it
  // walks through first — so `trailing` is deliberately unchanged at 14. The two numbers
  // moving apart is the point of counting them separately.
  // 79 since `chebyshev-pseudospectral-collocation` (session 130). It is atomic, so
  // its stretch is the whole route and stands at index 0 — `trailing` is deliberately
  // unchanged at 14, the same way `layerwise-training` moved one number and not the
  // other. `childs-liu-spectral`, authored in the same commit, moves NEITHER: it
  // delegates both of its hops to named slots, so it has no own stretch at all.
  assert.equal(withOwn.length, 79);
  assert.equal(trailing.length, 14);

  // The three that remain of the four the owner named. Pinned by their states
  // as well as their ids: the complaint was about a specific place on the
  // drawing, and "after hamiltonian-simulation" is only the same place while
  // the hop is still `evolution-circuit -> solution-answer`. These three keep
  // their tails by W11's measurement — they recover a solution *state*, and
  // the recovery is each method's own work.
  const afterSimulation = trailing
    .filter((row) => row.after === "hamiltonian-simulation")
    .map((row) => `${row.method}: ${row.from} -> ${row.to}`)
    .sort();
  assert.deepEqual(afterSimulation, [
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
  // 57 until session 120 — the KvN route lost its stretch to the W14 wiring.
  // 66 since W21: the ten methods of the variational region each have one, for the reason
  // recorded on the stretch census above.
  // 68 since W21-E, for the two routes named on the stretch census above.
  // 78 since `layerwise-training`, tracking the stretch census above one-for-one, which is
  // the whole claim this test makes: the own-card population and the stretch population are
  // the same set, so they move together or one of them is wrong.
  // 79 since `chebyshev-pseudospectral-collocation`, tracking the stretch census
  // above one-for-one as it must.
  assert.equal(built, 79);
  // A prefix on nothing, and a prefix on a capability, both resolve to shut
  // rather than to something. `?card=` is user-supplied.
  assert.equal(cardExists(input, ownCardId("not-a-method")), false);
  assert.equal(cardExists(input, ownCardId("linear-ode-solve")), false);
  assert.equal(cardExists(input, "own:"), false);
});

// --- the truncated map inside the card (W9) ---------------------------------
//
// Session 113, the owner: *"Opening processes further when within their card
// should be possible. it stays in the card, but disconnects from the rest of
// the graph, so the user can click around in there… Clicking to another card
// while in here will reset this… i don't want the issues of having to track
// process within process within process visualization and take memory, hence
// the reset with every card."*
//
// The reset is a **deletion in `withCard`**, not history code, so these are
// URL-transition tests: the rule lives in the pure functions and this is where
// it is asserted. Every address below is built through the same serializers
// the page uses (`figureHref`/`withCard`/`withInner`), never written by hand,
// because `URLSearchParams` percent-encodes an address's `:` and a hand-typed
// URL would fail byte-identity for the wrong reason.

const DRAWABLE = drawableSlots(LAYER_GRAPH, STATE_VOCABULARY);
const drawable = (id: string) => DRAWABLE.some((slot) => slot.id === id);

test("?inner= names a drawable slot, one only, and an id that names nothing means shut", () => {
  assert.deepEqual(parseInnerId(undefined, drawable), { id: null, dropped: 0 });
  assert.deepEqual(parseInnerId("", drawable), { id: null, dropped: 0 });
  assert.deepEqual(parseInnerId("no-such-slot", drawable), { id: null, dropped: 1 });
  // The predicate is drawability, not `cardExists` — a value that opens a
  // perfectly good card can still name no figure. Both live cases: the own
  // stretch has a card and is nobody's slot, and a method is opened *inside* a
  // figure, never drawn as one.
  const input = { graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, corpus: CORPUS, locale: "en", register: PAPER_REGISTER } as const;
  assert.equal(cardExists(input, ownCardId("lchs-route")), true);
  assert.deepEqual(parseInnerId(ownCardId("lchs-route"), drawable), { id: null, dropped: 1 });
  assert.ok(isMethod(layerNode(LAYER_GRAPH, "hhl-qpe-inversion")!));
  assert.deepEqual(parseInnerId("hhl-qpe-inversion", drawable), { id: null, dropped: 1 });
  const slot = DRAWABLE[0]!.id;
  assert.deepEqual(parseInnerId(slot, drawable), { id: slot, dropped: 0 });
  // Single-valued by the same argument `?card=` is: a second truncated map is
  // the process-within-process tracking the owner ruled out.
  assert.deepEqual(parseInnerId([slot, DRAWABLE[1]!.id], drawable), { id: slot, dropped: 1 });
});

test("opening the truncated map costs nothing, and leaving it forgets what was open inside", () => {
  assert.ok(drawable("quantum-linear-solve"), "the fixture slot stopped being drawable");
  const map = figureHref("quantum-linear-solve", ["quantum-linear-solve:0.0"], "1.5.2.3");
  const card = withCardSection(withCard(map, "quantum-linear-solve"), "filled-by");
  const opened = withInner(card, "quantum-linear-solve");
  const params = new URLSearchParams(opened.slice(opened.indexOf("?") + 1));
  // Everything the reader was holding survives — focus, the whole outer open
  // set, the viewport, the card and even the section they were reading.
  assert.equal(params.get("focus"), "quantum-linear-solve");
  assert.deepEqual(params.getAll("open"), ["quantum-linear-solve:0.0"]);
  assert.equal(params.get("at"), "1.5.2.3");
  assert.equal(params.get("card"), "quantum-linear-solve");
  assert.equal(params.get(SECTION_PARAM), "filled-by");
  assert.equal(params.get("inner"), "quantum-linear-solve");
  // `?iopen=` dies with the figure it describes, in both directions: a new
  // inner must not inherit the old map's expansions, and closing must not
  // leave a set behind for the next open to resume.
  const expanded = withIopen(opened, ["quantum-linear-solve:0.0", "quantum-linear-solve:0.1"]);
  assert.deepEqual(
    new URLSearchParams(expanded.slice(expanded.indexOf("?") + 1)).getAll("iopen"),
    ["quantum-linear-solve:0.0", "quantum-linear-solve:0.1"],
  );
  assert.deepEqual(
    new URLSearchParams(withInner(expanded, DRAWABLE[0]!.id).split("?")[1]!).getAll("iopen"),
    [],
  );
  // Shutting it returns the card it opened from, byte for byte — same section.
  assert.equal(withInner(expanded, null), card);
});

test("the owner's four-step walk is distinct URLs, and the reset makes back from (4) land on (1)", () => {
  const P = "quantum-linear-solve";
  assert.ok(drawable(P), "the fixture slot stopped being drawable");
  // (1) the whole map, some branches open.
  const step1 = figureHref(null, [`${P}:0.0`], "1.5.2.3");
  // (2) click a label → its process card.
  const step2 = withCard(step1, P);
  // (3) click the process to expand it further → the truncated map…
  const step3 = withInner(step2, P);
  // …and click around in there: the toggle writes `?iopen=`, never `?open=`.
  const step3b = innerToggleHref(step3, new Set(), `${P}:0.0`, null);
  assert.equal(new Set([step1, step2, step3, step3b]).size, 4, "two steps share one address");
  const q3b = new URLSearchParams(step3b.slice(step3b.indexOf("?") + 1));
  assert.deepEqual(q3b.getAll("open"), [`${P}:0.0`], "a click inside the panel touched the outer set");
  assert.deepEqual(q3b.getAll("iopen"), [`${P}:0.0`]);
  assert.equal(q3b.get("card"), P);
  assert.equal(q3b.get("inner"), P);
  assert.equal(q3b.get("at"), "1.5.2.3");
  // The iopen grammar is the open grammar — one parser, both keys, exactly as
  // the page resolves them. An address needs no graph lookup to be honoured.
  const parsed = resolveOpenIds(q3b.getAll("iopen"), () => false);
  assert.deepEqual([...parsed.open], [`${P}:0.0`]);
  assert.equal(parsed.dropped, 0);
  // Toggling the same lane shuts it: back to step (3), byte for byte.
  assert.equal(innerToggleHref(step3, new Set([`${P}:0.0`]), `${P}:0.0`, null), step3);
  // An inherited node id holds a lane open inside the panel exactly as it does
  // outside — shutting removes both forms, or the control does nothing.
  assert.equal(innerToggleHref(step3, new Set(["some-node", `${P}:0.0`]), `${P}:0.0`, "some-node"), step3);
  // (4) click another label → the new label's card. `inner` and `iopen` are
  // gone the moment `card=<new>` arrives — the reset, as a deletion.
  const step4 = withCard(step3b, "hhl-qpe-inversion");
  const q4 = new URLSearchParams(step4.slice(step4.indexOf("?") + 1));
  assert.equal(q4.get("card"), "hhl-qpe-inversion");
  assert.equal(q4.get("inner"), null);
  assert.deepEqual(q4.getAll("iopen"), []);
  assert.deepEqual(q4.getAll("open"), [`${P}:0.0`], "the reset must not touch the outer map");
  // *"back now goes to (1), not (3)"* — the new card's close link is the whole
  // map the walk started on, because `withCard` dropped `inner` and `iopen`
  // when the card opened, not because anything remembered a history.
  assert.equal(withCard(step4, null), step1);
  // And *"go to the actual map itself"* from step (3) is the same address: the
  // close control needs no second rule for the deeper state.
  assert.equal(withCard(step3b, null), step1);
});

test("inside the card, every control the figure emits stays on the outer address", () => {
  // Swept over every drawable slot rather than one chosen to match: the
  // truncated map can be opened on any of them, and a figure whose toggles
  // leak `?open=` or whose names forget the reset would be wrong on exactly
  // the slots nobody sampled.
  let toggles = 0;
  let names = 0;
  for (const slot of DRAWABLE) {
    const base = withInner(withCard(figureHref("quantum-linear-solve", ["keep-me"], "1.5.2.3"), slot.id), slot.id);
    const diagram = layoutConverge({
      graph: LAYER_GRAPH,
      vocabulary: STATE_VOCABULARY,
      focus: slot,
      locale: "en",
      open: new Set(),
      innerBase: base,
    });
    if (diagram.empty) continue;
    for (const shape of diagram.lanes) {
      if (shape.openHref !== null) {
        toggles += 1;
        const q = new URLSearchParams(shape.openHref.slice(shape.openHref.indexOf("?") + 1));
        // The outer address survives whole: focus, open set, viewport, card,
        // inner. A toggle that rebuilt any of these from the figure's own
        // parameters would silently swap the reader's map for the panel's.
        assert.equal(q.get("focus"), "quantum-linear-solve", `${slot.id}: toggle lost the focus`);
        assert.deepEqual(q.getAll("open"), ["keep-me"], `${slot.id}: toggle touched the outer set`);
        assert.equal(q.get("at"), "1.5.2.3", `${slot.id}: toggle lost the viewport`);
        assert.equal(q.get("card"), slot.id, `${slot.id}: toggle lost the card`);
        assert.equal(q.get("inner"), slot.id, `${slot.id}: toggle lost the inner figure`);
        assert.deepEqual(q.getAll("iopen"), [shape.address], `${slot.id}: toggle wrote the wrong key`);
      }
      if (shape.cardHref !== null) {
        names += 1;
        const q = new URLSearchParams(shape.cardHref.slice(shape.cardHref.indexOf("?") + 1));
        // A name is the reset: `card=<new>` on the outer address, with `inner`
        // and `iopen` already gone — step (4) of the walk, minted by the layout.
        assert.notEqual(q.get("card"), null, `${slot.id}: a name opens no card`);
        assert.equal(q.get("inner"), null, `${slot.id}: a name kept the truncated map`);
        assert.deepEqual(q.getAll("iopen"), [], `${slot.id}: a name kept the inner expansions`);
        assert.deepEqual(q.getAll("open"), ["keep-me"], `${slot.id}: a name touched the outer set`);
      }
    }
  }
  // Both paths must have an instance somewhere on the real graph, or one of
  // the two behaviours this test is about has never been drawn.
  assert.ok(toggles >= 1, "no lane inside any truncated map is openable — the iopen path draws nowhere");
  assert.ok(names >= 1, "no name inside any truncated map opens a card — the reset path draws nowhere");
  console.log(`[inner figure census] ${DRAWABLE.length} drawable slots, ${toggles} toggles, ${names} card links`);
});

test("a method's interior is the lane's own notion of it — ingredients are not one", () => {
  // The card's expand control and the lane's open control must answer "does
  // this method have an interior" identically, and `methodHasInterior` is the
  // one writer both read. That has not changed; **what the predicate answers
  // has.**
  //
  // It read `segments >= 2 || feeds.length > 0` while an ingredient was a
  // shape on the canvas, and `hhl-qpe-inversion` was the fixture that pinned
  // the second clause: every step it names is an ingredient, so a predicate
  // over segments alone called it empty and the layout's own comment recorded
  // it going inert once already. The owner has since ruled ingredients off the
  // map and onto the card (issue 16), so the second clause is the defect now —
  // HHL's expand control would offer a truncated map with nothing in it to
  // draw.
  //
  // Same fixture, inverted, which is the point: this is the case where the two
  // readings differ, and it is the one worth pinning either way round.
  const hhl = layerNode(LAYER_GRAPH, "hhl-qpe-inversion")!;
  assert.ok(isMethod(hhl));
  const route = routeOf(LAYER_GRAPH, STATE_VOCABULARY, hhl);
  assert.ok(route.segments.length < 2, "hhl grew named segments — pick a new fixture for this case");
  assert.ok(route.feeds.length > 0, "hhl lost its ingredients — pick a new fixture for this case");
  assert.equal(
    methodHasInterior(LAYER_GRAPH, STATE_VOCABULARY, hhl),
    false,
    "a method whose only recorded structure is its ingredients has no interior the map can draw",
  );
  // …and the ingredients are not lost with the control: they are the card's
  // Requires section, which is where the ruling put them.
  const card = cardFor(
    { graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, corpus: CORPUS, locale: "en", register: PAPER_REGISTER },
    "hhl-qpe-inversion",
  );
  assert.ok(card && card.kind === "method");
  assert.ok(card.ingredients.held, "hhl's Requires section is empty");
  assert.deepEqual(
    card.ingredients.value.map((item) => item.link.id),
    [...route.feeds],
  );
  // The positive case still needs a witness, or the predicate could be a
  // constant `false` and this would pass.
  const withSegments = LAYER_GRAPH.nodes.filter(isMethod).filter(
    (method) => routeOf(LAYER_GRAPH, STATE_VOCABULARY, method).segments.length >= 2,
  );
  assert.ok(withSegments.length >= 10, `only ${withSegments.length} methods walk two named hops`);
  for (const method of withSegments) {
    assert.equal(methodHasInterior(LAYER_GRAPH, STATE_VOCABULARY, method), true, method.id);
  }
});
