/**
 * What a card says, assembled from the layer graph and joined to the corpus.
 *
 * **Assembled here rather than in the component**, because the interesting part
 * of a card is what it does *not* have. The owner's rule is that
 * *"gaps are loud and clear, but terse in text like 'none found yet'"*, and a
 * gap written as `{field} ? <p/> : <EmptyNote/>` inside JSX is a gap nothing can
 * count, sweep or test. Every section below resolves to a `CardValue`, so
 * "how much of this card is empty" is a question with an answer.
 *
 * ---------------------------------------------------------------------------
 * **The two gaps are different facts and the card must not conflate them.**
 *
 * `none-recorded` — the field exists on this record type and is empty for this
 * node. Nobody found it, or nobody has written it down yet. "None found yet" is
 * the honest four words, and it implies a search that came back empty.
 *
 * `no-field-yet` — **nothing anywhere can hold this.** Three of the sections the
 * owner asked for have no field on any type in this repository: the state-to-
 * state theory trace, the approximations and assumptions beside cost, and the
 * implementations tree. `W5-card-spec.md` says so, and says the third needs a
 * data model designed with him before it is built.
 *
 * Printing "none found yet" for those would be a lie in the direction that
 * always survives: it reads as *we looked and the literature is thin*, when what
 * happened is *we have not built the place to put it*. The reader cannot tell
 * those apart, and the second is a to-do on this repository rather than a fact
 * about physics. So they carry a different word.
 * ---------------------------------------------------------------------------
 */
import {
  contractFor,
  entriesFor,
  isCapability,
  isMethod,
  layerNode,
  methodsRealizing,
  refinementsOf,
  routeOf,
  type LayerCitation,
  type LayerContract,
  type LayerCorpusEntry,
  type LayerGraph,
  type LayerMethod,
  type LayerNode,
} from "./layers.ts";
import type { StateVocabulary } from "./states.ts";

/** Why a section is empty. See the block above — the two are not one fact. */
export type CardGap = "none-recorded" | "no-field-yet";

/** A section's content, or the reason there is none. */
export type CardValue<T> = { readonly held: true; readonly value: T } | {
  readonly held: false;
  readonly gap: CardGap;
};

const held = <T,>(value: T): CardValue<T> => ({ held: true, value });
const missing = <T,>(gap: CardGap): CardValue<T> => ({ held: false, gap });

/**
 * A value that is present only when it is non-empty.
 *
 * `""` is not a value. `layers.ts` says every optional prose field is "absent
 * means not stated. Never `""`", and this is the one place that claim is
 * enforced against the rendering rather than against the schema — a field that
 * regressed to the empty string would otherwise draw an empty section with no
 * gap note, which is the one outcome the owner's rule forbids.
 */
function stated(value: string | undefined): CardValue<string> {
  return value !== undefined && value.trim() !== "" ? held(value) : missing("none-recorded");
}

/** A node reduced to what a card draws for it: a name and a way to reach it. */
export interface CardLink {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly href: string;
}

/** One repository record this node names, joined through `LayerNode.entries`. */
export interface CardRecord {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly href: string;
}

/**
 * One hop of the state-to-state chain a method walks — **and the unit Theory
 * fills in.**
 *
 * The owner gave seven card sections and was asked whether the chain is the
 * spine of *Theory* or a section beside it. He took the recommendation: *"Theory
 * renders the chain as its spine, each hop collapsible and empty until the
 * mathematics is written."* The argument he was given, and agreed to, is that
 * this is the only way Theory is honest on day one — the alternative ships one
 * section reading "pending" for as long as it takes to write 63 methods' worth
 * of mathematics, and a section that says "pending" about everything says
 * nothing about anything.
 *
 * The chain is the one structural field at **63/63**. So Theory is *held* from
 * the first day — it holds the states and the slots — and the three things a
 * source would add to a hop are addressed per hop, where they can arrive one at
 * a time.
 *
 * **Approximations and assumptions are here, and not on the method, because he
 * chose the harder of two models.** Session 109 had them as two fields beside
 * cost; session 113 asked for them *"highlighted along the way"* inside the
 * theory. Those are different data models — prose about the method, versus an
 * annotation on a step of the trace — and he confirmed the second. It is the
 * same argument `layers.ts` makes for `through`, `via` and `repeats`: a method
 * does not approximate, it approximates *something*, and a field on the node
 * leaves the reader guessing which of three hops the approximation was made at.
 */
export interface CardHop {
  readonly from: string;
  readonly to: string;
  /** The slot filling this hop, or null when the method does the work itself. */
  readonly via: CardLink | null;
  /** True when the state after this hop came from `through`, not the slot's contract. */
  readonly narrowed: boolean;
  /** The mathematics of this hop, as a source states it. */
  readonly theory: CardValue<string>;
  /** What is approximated *at this hop*, not somewhere in the method. */
  readonly approximations: CardValue<string>;
  /** What this hop assumes, likewise. */
  readonly assumptions: CardValue<string>;
}

/** The three things a source can add to a hop. Ordered as the card draws them. */
export const HOP_SLOTS = ["theory", "approximations", "assumptions"] as const;

export type HopSlotId = (typeof HOP_SLOTS)[number];

export interface CardContract {
  readonly from: string;
  readonly to: string;
  readonly takes: string;
  readonly returns: string;
}

interface CardCommon {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  /** Where the full record lives. **Always present**, and that is the point. */
  readonly pageHref: string;
  readonly contract: CardValue<CardContract>;
  readonly papers: CardValue<readonly LayerCitation[]>;
  /** The join: repository records that document this node. */
  readonly records: CardValue<readonly CardRecord[]>;
}

export interface MethodCard extends CardCommon {
  readonly kind: "method";
  readonly realizes: CardLink | null;
  /**
   * The two halves of `refines`, and why neither is a `CardValue`.
   *
   * The owner, session 113: *"why do LCHS and LCHS improve kernel break down to
   * the same thing, they clearly have different implementation so something at
   * least has to change right?"* — and his answer to the write-up: *"just make it
   * clear what the difference is, and it should show up in UI in clear way
   * without cluttering."*
   *
   * The chain is identical **on purpose**: what the improved-kernel paper changes
   * is the kernel inside `lchs-kernel-identity`, a parameter of the construction
   * rather than a different construction, which is why the duplicate-path gate
   * exempts a declared refinement. So the data is right and the *drawing* was
   * silent — the reader saw two identical lanes and nothing said they were
   * related, let alone how.
   *
   * **Chrome, not a section, and that is the "without cluttering" half.** Every
   * other thing on this card is a `CardValue` because it is *content the corpus
   * might hold and might not have found yet* — "none found yet" is a claim about
   * a search. A refinement edge is not that. It is a structural relation the
   * graph is the whole authority on, `refinementsOf`/`alternativesTo` are already
   * a partition of the siblings, and a card printing "none found yet" under
   * *Narrower versions* on all 58 methods that have none would be 58 statements
   * about a search nobody ran. So it draws where it exists and nothing where it
   * does not — the same call `repository-layers.tsx` already made for `refines`
   * on the node page.
   *
   * **What is different is answered by following the link, not by a second copy
   * of the answer.** `lchs-improved-kernel`'s own lede already opens with the
   * kernel, its decay rate and what it replaces. A `differsBy` field here would
   * restate that one click away from the sentence it was copied from, and the two
   * would drift the first time either was edited.
   */
  readonly refines: CardLink | null;
  /** Narrower versions of this one. Empty is the common case and draws nothing. */
  readonly refinedBy: readonly CardLink[];
  readonly whenItApplies: CardValue<string>;
  /** *Performance*, on the card. `cost` is what the graph calls the field it reads. */
  readonly cost: CardValue<string>;
  readonly contested: CardValue<string>;
  /**
   * **Theory**: the chain the method walks, and the place its mathematics lands.
   *
   * Structural and therefore populated — `routeOf` computes it, 63/63. See
   * `CardHop` for why the mathematics, the approximations and the assumptions
   * are addressed per hop rather than per method.
   */
  readonly trace: CardValue<readonly CardHop[]>;
  /** *Requires*: what it needs that does not move the route along. */
  readonly ingredients: CardValue<readonly CardLink[]>;
  /**
   * The two the owner asked for that nothing can hold yet.
   *
   * Kept as fields rather than left out so the card *says* they are coming: an
   * absent section is indistinguishable from a section nobody thought of, and
   * `W5-card-spec.md` is explicit that these are wanted and undesigned.
   *
   * `theoryTrace`, `approximations` and `assumptions` used to be here beside
   * them and are **gone from this level on purpose** — the first is now the
   * `trace` above (Theory *is* the chain), and the other two are annotations on
   * a hop. All three were the owner's own re-decision; see `CardHop`.
   */
  readonly example: CardValue<never>;
  readonly implementations: CardValue<never>;
}

/**
 * Whether the repository covers this process, and why not when it does not.
 *
 * The owner asked for **three** answers: covered (and here is the folder), not
 * covered yet, or *deliberately not a repository thing, for this stated reason*
 * — his example being *"just a naming convention for a class of problems"*.
 *
 * **The third is unreachable today**, because no field holds a reason, and a
 * three-valued answer with an unreachable third value is a two-valued answer
 * wearing a third label. So `deliberate` is typed and never produced, and the
 * card prints which of the two it can actually distinguish. When the field
 * exists this becomes reachable and the card needs no other change.
 */
export type CoverageAnswer = "covered" | "not-yet" | "deliberate";

export interface ProcessCard extends CardCommon {
  readonly kind: "process";
  readonly whyALayer: CardValue<string>;
  readonly filledBy: CardValue<readonly CardLink[]>;
  /** Methods whose route makes this process unnecessary. */
  readonly bypassedBy: CardValue<readonly CardLink[]>;
  readonly coverage: CoverageAnswer;
  /** The classical column the owner asked for beside `bypasses`. No field yet. */
  readonly classicalEquivalents: CardValue<never>;
}

/**
 * The card for the stretch of a route **no named slot covers**.
 *
 * The owner, session 113: *"I am seeing some blank processes — i would like them
 * labeled… Blank processes should be separately clickable than the parent
 * process."*
 *
 * What he is seeing is `routeOf`'s trailing segment: the part of a route the
 * method performs itself, which has been drawn with no name since session 104
 * and, until now, with no click target of any kind. **57 of the 63 methods carry
 * exactly one** (none carries two); 14 of those are drawn *after* a named step,
 * which is when it reads as a hole rather than as the body of the line it is on,
 * and **4 of the 14 sit immediately after `hamiltonian-simulation`** — which is
 * the spot he named.
 *
 * It is not a hole. `layers.ts:911` is explicit: *"a real process with a page,
 * not a hole."* But it is also not nothing to do — a hop with no slot is a hop
 * the vocabulary has no word for, and `W5-card-spec.md` says the empty card is a
 * **worklist** rather than a gap report:
 *
 * > *"While populating 'what would have to exist to connect them', we may come
 * > across papers that provide the connections and fill it into another one of
 * > the cards!"*
 *
 * So this card says the three things a reader needs and nothing else: which two
 * states it runs between, which method is doing the work, and that no slot
 * covers it yet. `?card=` addresses it as `own:<methodId>` — see `ownCardId`.
 */
export interface OwnStepCard {
  readonly kind: "own-step";
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  /** The method's page — the same "always present" promise the other cards make. */
  readonly pageHref: string;
  /** The method performing this stretch. Never null: the id is built from it. */
  readonly method: CardLink;
  /** The slot the method fills, so the reader can climb back out. */
  readonly realizes: CardLink | null;
  /** The state it starts from and the state it must reach. */
  readonly from: string;
  readonly to: string;
  /** The method's own contract, which is the closest thing to a contract this has. */
  readonly contract: CardValue<CardContract>;
  /**
   * What a named slot here would have to promise — the worklist entry.
   *
   * Derived, not authored: it is exactly the two states above, and writing it as
   * a field would be a second copy of them that goes stale the first time a
   * contract is edited. The component composes the sentence from `from`/`to`.
   */
  readonly slotWanted: true;
}

export type Card = MethodCard | ProcessCard | OwnStepCard;

/**
 * `?card=` for the stretch a method performs itself.
 *
 * **Prefixed rather than the method's own id**, because the two are different
 * things at the same address otherwise: `?card=lchs-route` is the method, and
 * the hop inside it that `lchs-route` does personally is not the method. This is
 * the same distinction `converge-layout.ts` records when it refuses the segment a
 * node id — *"its id would be the method's, so `?open=` could not tell 'open the
 * method' from 'open the piece of the method that is the method'"*.
 *
 * A **method id, not an address**, and that is a measurement rather than a
 * preference: no method has two of these segments, so the method names it
 * uniquely, and a method id survives the figure being opened differently while a
 * dotted address does not.
 */
const OWN_CARD_PREFIX = "own:";

export function ownCardId(methodId: string): string {
  return `${OWN_CARD_PREFIX}${methodId}`;
}

/** The method an `own:` card names, or null when the id is not one. */
export function methodOfOwnCard(id: string): string | null {
  return id.startsWith(OWN_CARD_PREFIX) ? id.slice(OWN_CARD_PREFIX.length) : null;
}

interface CardInput {
  readonly graph: LayerGraph;
  readonly vocabulary: StateVocabulary;
  readonly corpus: readonly LayerCorpusEntry[];
  readonly locale: "en" | "ja";
}

/** The layer-graph page for a node. The card never replaces this — it links to it. */
export function nodePageHref(id: string): string {
  return `/repository/layers/${id}`;
}

function linkFor(graph: LayerGraph, id: string, ja: boolean): CardLink | null {
  const node = layerNode(graph, id);
  if (node === null) return null;
  return {
    id,
    label: ja ? node.labelJa : node.label,
    summary: ja ? node.summaryJa : node.summary,
    href: nodePageHref(id),
  };
}

function contractOf(graph: LayerGraph, node: LayerNode, ja: boolean): CardValue<CardContract> {
  const resolved = contractFor(graph, node);
  if (resolved === null) return missing("none-recorded");
  const c: LayerContract = resolved.contract;
  return held({
    from: c.from,
    to: c.to,
    takes: ja ? c.takesJa : c.takes,
    returns: ja ? c.returnsJa : c.returns,
  });
}

function recordsOf(
  node: LayerNode,
  corpus: readonly LayerCorpusEntry[],
  ja: boolean,
): CardValue<readonly CardRecord[]> {
  const bySlug = new Map(corpus.map((entry) => [entry.slug, entry]));
  const slugs = entriesFor(node, new Set(bySlug.keys()));
  if (slugs.length === 0) return missing("none-recorded");
  return held(
    slugs.map((slug) => {
      const entry = bySlug.get(slug)!;
      return {
        slug,
        title: ja ? entry.titleJa : entry.title,
        description: ja ? entry.descriptionJa : entry.description,
        href: `/repository/${slug}`,
      };
    }),
  );
}

function listOrGap(items: readonly CardLink[]): CardValue<readonly CardLink[]> {
  return items.length === 0 ? missing("none-recorded") : held(items);
}

function methodCard(input: CardInput, method: LayerMethod): MethodCard {
  const { graph, vocabulary, corpus } = input;
  const ja = input.locale === "ja";
  const route = routeOf(graph, vocabulary, method);
  // The chain, read off `routeOf` rather than off `steps`. They are not the same
  // list: `steps` is everything the method names, and `routeOf` is the part of it
  // that moves the route along — the rest are `feeds`, which is the ingredients
  // section below. Reading both from `steps` would put every ingredient in the
  // chain and every hop in the ingredients.
  const hops: CardHop[] = route.segments.map((segment, index) => ({
    from: route.states[index] ?? "",
    to: route.states[index + 1] ?? "",
    via: segment.capabilityId === null ? null : linkFor(graph, segment.capabilityId, ja),
    narrowed: segment.narrowed,
    // **`no-field-yet`, per hop, and the word matters.** Nothing on `LayerMethod`
    // holds a hop's mathematics, its approximations or its assumptions — the
    // owner asked for all three and confirmed they belong *on the hop*, and the
    // field is the next piece of work rather than a search that came back empty.
    // The card must not say "none found yet" about a place nobody has built.
    theory: missing("no-field-yet"),
    approximations: missing("no-field-yet"),
    assumptions: missing("no-field-yet"),
  }));
  const ingredients = route.feeds
    .map((id) => linkFor(graph, id, ja))
    .filter((link): link is CardLink => link !== null);

  return {
    kind: "method",
    id: method.id,
    label: ja ? method.labelJa : method.label,
    summary: ja ? method.summaryJa : method.summary,
    pageHref: nodePageHref(method.id),
    realizes: linkFor(graph, method.realizes, ja),
    // Read off the graph in both directions rather than off a field on this node.
    // `refines` is written on the *narrower* method, so "what narrows me" is a
    // scan — `refinementsOf` — and there is no second place the back-link could
    // drift from. It is the same argument `bypassedBy` makes on the process card.
    refines: method.refines === undefined ? null : linkFor(graph, method.refines, ja),
    refinedBy: refinementsOf(graph, method)
      .map((child) => linkFor(graph, child.id, ja))
      .filter((link): link is CardLink => link !== null),
    contract: contractOf(graph, method, ja),
    whenItApplies: stated(ja ? method.conditionsJa : method.conditions),
    cost: stated(ja ? method.costJa : method.cost),
    contested: stated(ja ? method.contestedJa : method.contested),
    trace: hops.length === 0 ? missing("none-recorded") : held(hops),
    ingredients: listOrGap(ingredients),
    papers:
      method.citations === undefined || method.citations.length === 0
        ? missing("none-recorded")
        : held(method.citations),
    records: recordsOf(method, corpus, ja),
    example: missing("no-field-yet"),
    implementations: missing("no-field-yet"),
  };
}

function processCard(input: CardInput, capability: LayerNode): ProcessCard {
  const { graph, corpus } = input;
  const ja = input.locale === "ja";
  if (!isCapability(capability)) throw new Error(`${capability.id} is not a capability`);
  const filledBy = methodsRealizing(graph, capability.id)
    .map((method) => linkFor(graph, method.id, ja))
    .filter((link): link is CardLink => link !== null);
  // Read off the graph rather than off a field on this node: `bypasses` is
  // written on the *method* that makes the process unnecessary, so the answer to
  // "what makes me unnecessary" is a scan, and there is no second place it could
  // drift from.
  const bypassedBy = graph.nodes
    .filter((node): node is LayerMethod => isMethod(node) && (node.bypasses ?? []).includes(capability.id))
    .map((method) => linkFor(graph, method.id, ja))
    .filter((link): link is CardLink => link !== null);
  const records = recordsOf(capability, corpus, ja);

  return {
    kind: "process",
    id: capability.id,
    label: ja ? capability.labelJa : capability.label,
    summary: ja ? capability.summaryJa : capability.summary,
    pageHref: nodePageHref(capability.id),
    contract: contractOf(graph, capability, ja),
    whyALayer: stated(ja ? capability.whyALayerJa : capability.whyALayer),
    filledBy: listOrGap(filledBy),
    bypassedBy: listOrGap(bypassedBy),
    papers:
      capability.citations === undefined || capability.citations.length === 0
        ? missing("none-recorded")
        : held(capability.citations),
    records,
    coverage: records.held ? "covered" : "not-yet",
    classicalEquivalents: missing("no-field-yet"),
  };
}

function ownStepCard(input: CardInput, method: LayerMethod): OwnStepCard | null {
  const { graph, vocabulary } = input;
  const ja = input.locale === "ja";
  const route = routeOf(graph, vocabulary, method);
  // Located rather than assumed. A method with no own segment has no such card,
  // and saying so here — instead of building an empty one — is what keeps
  // `?card=own:<id>` from resolving for the six methods that delegate the whole
  // way across.
  const index = route.segments.findIndex((segment) => segment.capabilityId === null);
  if (index === -1) return null;
  const from = route.states[index];
  const to = route.states[index + 1];
  if (from === undefined || to === undefined) return null;
  const link = linkFor(graph, method.id, ja);
  if (link === null) return null;
  return {
    kind: "own-step",
    id: ownCardId(method.id),
    label: ja ? method.labelJa : method.label,
    summary: ja ? method.summaryJa : method.summary,
    pageHref: nodePageHref(method.id),
    method: link,
    realizes: linkFor(graph, method.realizes, ja),
    from,
    to,
    contract: contractOf(graph, method, ja),
    slotWanted: true,
  };
}

/** The card for a node, or null when the id names nothing the graph holds. */
export function cardFor(input: CardInput, id: string): Card | null {
  // The `own:` form first: it is a prefix on a method id, so asking the graph
  // about the raw string would miss it, and stripping the prefix unconditionally
  // would let `?card=own:` resolve to whatever a bare id resolves to.
  const ownOf = methodOfOwnCard(id);
  if (ownOf !== null) {
    const method = layerNode(input.graph, ownOf);
    return method !== null && isMethod(method) ? ownStepCard(input, method) : null;
  }
  const node = layerNode(input.graph, id);
  if (node === null) return null;
  return isMethod(node) ? methodCard(input, node) : processCard(input, node);
}

/**
 * Whether `?card=` can open this id — the predicate the route hands `parseCardId`.
 *
 * Exported so the route does not have to know that a card id is *sometimes* a
 * node id and sometimes a prefixed one. Before this, the route's predicate was
 * `layerNode(graph, id) !== null` written out at the call site, which is a
 * second, simpler model of what a card id is — and the simpler one would have
 * counted every `own:` link as dropped while the panel below it opened fine.
 */
export function cardExists(input: CardInput, id: string): boolean {
  return cardFor(input, id) !== null;
}

/**
 * Every section a card can draw. Written out so a heading is a **type error**
 * rather than an `undefined` on the map, in both locales at once.
 *
 * Ten of these are the owner's own section list from `OWNER_TODO` §2, answered
 * in full during session 114. The rest — `contract`, `between`, `no-slot`,
 * `why-a-layer`, `filled-by`, `bypassed-by`, `classical-equivalents` — belong to
 * the other two card kinds, which he did not respecify.
 */
export type CardSectionId =
  | "when-it-applies"
  | "input"
  | "theory"
  | "output"
  | "requires"
  | "example"
  | "performance"
  | "contested"
  | "implementations"
  | "records"
  | "contract"
  | "between"
  | "no-slot"
  | "why-a-layer"
  | "filled-by"
  | "bypassed-by"
  | "classical-equivalents";

/** One section: what it is, and what it holds. */
export interface CardSection {
  readonly id: CardSectionId;
  readonly value: CardValue<unknown>;
}

/** What a section resolved to — held, or which of the two gaps. */
export function sectionState(section: { value: CardValue<unknown> }): "held" | CardGap {
  return section.value.held ? "held" : section.value.gap;
}

/**
 * Every section on a card, **in the order the card draws them.**
 *
 * ## This list is the order, and it was not before
 *
 * Until session 114 this function and `map-card-panel.tsx` were two independent
 * lists of the same sections in two different orders, and the panel did not
 * import this one. The census the tests read said `contract, papers, records,
 * when-it-applies, trace, …`; the reader saw `contract, when-it-applies, trace,
 * …` with papers and records last. Neither was wrong, because nothing claimed
 * they were the same list — which means a section could have been dropped from
 * the drawing entirely and the census would have gone on counting it.
 *
 * That mattered the moment the owner answered §2, because **his answer is an
 * order**. So the panel now renders *from* this array. There is one list, the
 * order is a fact a test can read, and a section that leaves the card leaves
 * here.
 *
 * ## The order is his, and the two additions are his too
 *
 * His seven were Input, Theory, Output, Requires, Example, Performance,
 * Implementations. *When it applies* is first because he made it its own
 * section — *"okay, it's own section. can be expanded upon in requires
 * section"* — and it is what tells a reader whether to keep reading. *Where the
 * claim is contested* sits after Performance because he kept it out of it:
 * a disputed complexity belongs in Performance, a disputed condition does not,
 * and he called this section *"the best thing on the surface"*.
 *
 * **Papers are deliberately not here.** He was asked whether a reference list
 * should be an eighth section and said *"confirm, it isn't needed for papers to
 * be their own section"*, so the card carries them as a plain list below the
 * sections — chrome, like the way onward. They are 63/63 and cannot be a gap.
 */
export function cardSections(card: Card): readonly CardSection[] {
  const of = (id: CardSectionId, value: CardValue<unknown>): CardSection => ({ id, value });
  // The own-step card is short on purpose and says so: which two states, the
  // method's own contract, and that no slot covers the stretch. `no-slot` is
  // listed here rather than hardcoded in the panel — it was the one section the
  // census could not see, which is precisely the shape of the bug above.
  if (card.kind === "own-step") {
    return [
      { id: "between", value: held(`${card.from} → ${card.to}`) },
      of("contract", card.contract),
      of("no-slot", missing("none-recorded")),
    ];
  }
  if (card.kind === "process") {
    return [
      of("contract", card.contract),
      of("why-a-layer", card.whyALayer),
      of("filled-by", card.filledBy),
      of("bypassed-by", card.bypassedBy),
      of("classical-equivalents", card.classicalEquivalents),
      of("records", card.records),
    ];
  }
  // **Input and Output are one field read twice, not two fields.** A contract is
  // `takes`/`returns` on one record; splitting it into two sections is a change
  // to how it is *drawn*, and giving each half its own `CardValue` would be two
  // answers to "is the contract recorded" that could disagree.
  return [
    of("when-it-applies", card.whenItApplies),
    of("input", card.contract),
    of("theory", card.trace),
    of("output", card.contract),
    of("requires", card.ingredients),
    of("example", card.example),
    of("performance", card.cost),
    of("contested", card.contested),
    of("implementations", card.implementations),
    of("records", card.records),
  ];
}

/**
 * The three slots inside every hop of Theory, swept flat.
 *
 * A second census, deliberately not folded into `cardSections`. The question
 * *"how much of this card is empty"* now has two honest answers at two levels:
 * Theory is **held** on all 63 methods because the chain is, and every hop
 * inside it is empty because no field holds a hop's mathematics yet. One number
 * covering both would report a card as fuller than it reads — the top level
 * would say "Theory: held" and the reader would open it and find nothing.
 */
export function cardHopSlots(
  card: Card,
): Array<{ hop: string; id: HopSlotId; state: "held" | CardGap }> {
  if (card.kind !== "method" || !card.trace.held) return [];
  return card.trace.value.flatMap((hop, index) =>
    HOP_SLOTS.map((id) => ({
      hop: `${index}:${hop.from}>${hop.to}`,
      id,
      state: sectionState({ value: hop[id] }),
    })),
  );
}
