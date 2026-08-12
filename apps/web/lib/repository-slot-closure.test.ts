import test from "node:test";
import assert from "node:assert/strict";

import {
  SLOT_CLOSURES,
  auditSlotClosure,
  auditSlotClosures,
  isAbsentMember,
  type SlotClosure,
} from "./repository/slot-closure.ts";
import { LAYER_GRAPH } from "./repository/layer-graph.ts";
import { STATE_VOCABULARY } from "./repository/state-vocabulary.ts";
import { isCapability, isMethod, layerNode, type LayerGraph } from "./repository/layers.ts";
import { layoutConverge } from "./repository/converge-layout.ts";
import { cardFor } from "./repository/card-content.ts";
import { PAPER_REGISTER } from "./repository/paper-register.ts";
import { paperIdFromUrl } from "./repository/papers.ts";

const CARD_INPUT = {
  graph: LAYER_GRAPH,
  vocabulary: STATE_VOCABULARY,
  corpus: [],
  locale: "en",
  register: PAPER_REGISTER,
} as const;

function slotFigure(graph: LayerGraph, id: string) {
  const node = layerNode(graph, id);
  assert.ok(node && isCapability(node), `${id} is not a capability`);
  return layoutConverge({ graph, vocabulary: STATE_VOCABULARY, focus: node, locale: "en" });
}

/** The closure with its member list replaced, for the mutation arms below. */
function edited(closure: SlotClosure, members: SlotClosure["members"]): SlotClosure {
  return { ...closure, members };
}

test("the authored graph agrees with every closure pinned against it", () => {
  const errors = auditSlotClosures(LAYER_GRAPH, PAPER_REGISTER);
  assert.deepEqual(errors, [], errors.join("\n"));

  // Denominators. An empty closure list, or a closure whose slot nothing
  // realizes, passes the line above while measuring nothing — which is the
  // failure this file is a response to, one level up.
  assert.ok(SLOT_CLOSURES.length >= 1, "no slot is closed, so nothing above was checked");
  for (const closure of SLOT_CLOSURES) {
    const realizing = LAYER_GRAPH.nodes.filter(
      (node) => isMethod(node) && node.realizes === closure.slot,
    );
    assert.ok(
      realizing.length >= 2,
      `${closure.slot} is pinned closed and only ${realizing.length} method realizes it`,
    );
  }
  console.log(
    "[population] " +
      SLOT_CLOSURES.map((closure) => {
        const drawn = closure.members.filter((member) => !isAbsentMember(member)).length;
        return `${closure.slot} — ${drawn} of ${closure.members.length} recorded members drawn`;
      }).join("; "),
  );
});

test("a method added to a closed slot without a row fails the closure", () => {
  // **The check this file exists for, made to fail before it is trusted.** The
  // eighth method is synthesised rather than authored: the property under test is
  // that the *absence of a row* fails, not that any particular paper is missing.
  const closure = SLOT_CLOSURES.find((one) => one.slot === "linear-ode-solve");
  assert.ok(closure, "linear-ode-solve is no longer a closed slot");

  const grown = {
    ...LAYER_GRAPH,
    nodes: [
      ...LAYER_GRAPH.nodes,
      {
        kind: "method",
        id: "probe-eighth-linear-ode-route",
        label: "A route nobody wrote a population row for",
        labelJa: "母集団の行が書かれていない経路",
        summary: "probe",
        summaryJa: "probe",
        realizes: "linear-ode-solve",
        steps: ["time-discretization", "quantum-linear-solve"],
      },
    ],
  } as unknown as LayerGraph;

  const errors = auditSlotClosure(grown, closure, PAPER_REGISTER);
  assert.ok(
    errors.some((error) => error.includes("probe-eighth-linear-ode-route")),
    `an unrecorded eighth method passed the closure: ${JSON.stringify(errors)}`,
  );
});

test("every other closure rule fails on its own mutation", () => {
  // Six rules sharing one green line is six chances for one of them to have
  // stopped guarding. Each arm breaks exactly one and asserts the error names it,
  // against the real graph — so a rule that has quietly become unreachable on
  // this corpus shows up here rather than in the next session's surprise.
  const real = SLOT_CLOSURES.find((one) => one.slot === "linear-ode-solve");
  assert.ok(real);

  const fails = (closure: SlotClosure, needle: string, what: string) => {
    const errors = auditSlotClosure(LAYER_GRAPH, closure, PAPER_REGISTER);
    assert.ok(
      errors.some((error) => error.includes(needle)),
      `${what}: expected an error mentioning "${needle}", got ${JSON.stringify(errors)}`,
    );
  };

  // [1] the pin itself.
  fails({ ...real, slot: "no-such-slot" }, "not in the graph", "an unknown slot");
  fails({ ...real, slot: "lchs-route" }, "and not a slot", "a method pinned as a slot");
  fails(
    { ...real, source: { ...real.source, url: "https://example.com/paper" } },
    "does not resolve to an arXiv abstract",
    "an unresolvable enumeration",
  );
  fails({ ...real, sourceLocus: "  " }, "is not a pin", "a source with no locus");

  // [3] a pinned id that is a method of another slot, and one that is nothing.
  fails(
    edited(real, [...real.members, { node: "forward-euler" }]),
    "does not realize linear-ode-solve",
    "a method of another slot",
  );
  fails(
    edited(real, [...real.members, { node: "no-such-method" }]),
    "is not in the graph",
    "a pinned id that names nothing",
  );

  // [4] the same method pinned twice.
  fails(
    edited(real, [...real.members, { node: "lchs-route" }]),
    "is pinned twice",
    "a duplicate row",
  );

  // [5] the absence rules, all four.
  const absent = (over: Record<string, unknown>) =>
    edited(real, [
      ...real.members,
      { absent: "Something", because: "a reason", citation: real.source, ...over },
    ]);
  fails(absent({ because: "  " }), "recorded absent with no reason", "an unreasoned absence");
  fails(absent({ absent: " " }), "an absent member with no name", "an unnamed absence");
  fails(
    absent({ citation: { ...real.source, url: "https://example.com/x" } }),
    "is not a measurement",
    "an uncitable absence",
  );
  // The one that keeps an absence from outliving the gap: this URL is already
  // cited by `lchs-improved-kernel`, so claiming it absent must fail.
  fails(
    absent({ citation: { ...real.source, url: "https://arxiv.org/abs/2303.01029" } }),
    "the row outlived the gap it records",
    "an absence whose paper is already cited on this slot",
  );

  // [7] the register rule, both halves, and it needs its own arms for a reason
  // the other rules do not have. **This closure now has no absent members at
  // all** — `childs-liu-spectral` was the last one and it is authored — so the
  // absence half of [7] has no live subject on the real graph and would pass
  // over nothing forever. The arms below are what keep it a check.
  //
  // The shapes are chosen to be the two mistakes that actually happen: an id
  // that is well-formed and simply has no row (a paper somebody cited before
  // registering it), and a URL the register cannot key on at all (a journal
  // landing page, a PDF host, a search result). The second is the sharper of
  // the two, because `/^https:\/\/arxiv\.org\/abs\//` — everything that stood
  // behind these fields before — accepts it happily.
  fails(
    absent({ citation: { ...real.source, url: "https://arxiv.org/abs/9999.99999" } }),
    "is not in the paper register",
    "an absence citing an arXiv id nobody has registered",
  );
  fails(
    { ...real, source: { ...real.source, url: "https://arxiv.org/abs/9999.99999" } },
    "the enumeration is pinned to a paper the register does not carry",
    "an enumeration pinned to an unregistered paper",
  );
  // Well-formed, on the right host, and not an address the register keys on —
  // the case the old regex could never have caught, since it only ever looked
  // at the prefix.
  fails(
    { ...real, source: { ...real.source, url: "https://arxiv.org/list/quant-ph/recent" } },
    "does not resolve to an arXiv abstract",
    "an enumeration pinned to an arXiv listing page rather than a paper",
  );
});

test("the register rule is exercised by the real closures and not only by mutations", () => {
  // The denominator for [7]. Every arm above builds its own broken closure, so
  // all three would still pass if `unregistered` were never reached on anything
  // real — which is the shape of wrong-reason pass this repository keeps
  // finding. This asserts the rule has live subjects: the enumeration's own
  // source, plus every absent member's citation, are papers the register
  // actually carries.
  let checked = 0;
  const index = new Map(PAPER_REGISTER.papers.map((paper) => [paper.id, paper]));
  for (const closure of SLOT_CLOSURES) {
    for (const url of [
      closure.source.url,
      ...closure.members.filter(isAbsentMember).map((member) => member.citation.url),
    ]) {
      const id = paperIdFromUrl(url);
      assert.ok(id, `${closure.slot}: ${url} is not an address the register can key on`);
      assert.ok(index.has(id), `${closure.slot}: ${id} is not in the paper register`);
      checked += 1;
    }
  }
  assert.ok(checked >= 1, "rule [7] ran against no real URL at all");
});

test("every method a closure pins is reachable from its own slot, by the path a reader takes", () => {
  // The reachability half. It is a different claim from the fan gate in
  // `repository-converge-layout.test.ts`: that one asks whether the figure draws
  // every method the graph *has*, which a fan derived from `methodsRealizing`
  // satisfies by construction and so can never fail on a new method. This asks
  // whether every method the written population names can actually be got to.
  //
  // **Two hops, because since session 121 a folded refinement is not a lane.**
  // The owner's ruling — *"these kinds of refinements can be shown to the user"*
  // on the parent's card rather than as a second line beside it — means
  // `krovi-linear-ode` and `lchs-improved-kernel` are not drawn on this slot's
  // figure at all. Asserting "drawn" would have failed on two members that are
  // perfectly reachable, so the claim is the reader's route instead: a lane on
  // the slot's own figure, or an entry in the Refinements section of a card that
  // lane opens. Both arms carry a denominator, because an assertion that only
  // ever takes the first arm would not notice the second breaking.
  let asLane = 0;
  let asRefinement = 0;
  for (const closure of SLOT_CLOSURES) {
    const figure = slotFigure(LAYER_GRAPH, closure.slot);
    assert.equal(
      figure.empty,
      false,
      `${closure.slot} is pinned closed and its own figure draws nothing`,
    );
    const lanes = new Map(
      figure.lanes.filter((lane) => lane.draws !== null).map((lane) => [lane.draws!, lane]),
    );
    // Every refinement a drawn lane's own card offers, and the parent it hangs
    // off — read through `cardFor`, which is what the page renders.
    const folded = new Map<string, string>();
    for (const drawn of lanes.keys()) {
      const card = cardFor(CARD_INPUT, drawn);
      if (card === null || !("refinements" in card) || !card.refinements.held) continue;
      for (const entry of card.refinements.value) folded.set(entry.link.id, drawn);
    }

    for (const member of closure.members) {
      if (isAbsentMember(member)) continue;
      const lane = lanes.get(member.node);
      if (lane) {
        asLane += 1;
        // Drawn is not reachable: a lane a reader cannot click leads to a method
        // page nothing on the map links to.
        assert.ok(
          lane.href.includes(member.node),
          `${closure.slot}: the lane drawing ${member.node} links to ${lane.href} instead`,
        );
        continue;
      }
      const parent = folded.get(member.node);
      assert.ok(
        parent,
        `${closure.slot}: ${member.node} is neither a lane on its own slot's figure nor a ` +
          "refinement on the card of one — nothing on this slot reaches it",
      );
      asRefinement += 1;
    }
  }
  assert.ok(asLane >= 5, `only ${asLane} pinned methods are lanes`);
  assert.ok(
    asRefinement >= 2,
    `${asRefinement} pinned methods are reached as folded refinements — the second arm of this ` +
      "test has no subject, so it is passing over nothing",
  );
});
