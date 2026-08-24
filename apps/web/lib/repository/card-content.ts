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
  ownStretchName,
  refinementsOf,
  routeOf,
  type LayerCitation,
  type LayerContract,
  type LayerCorpusEntry,
  repetitionOf,
  type LayerGraph,
  type LayerMethod,
  type LayerNode,
  type LoopClosure,
  type MethodExampleRun,
} from "./layers.ts";
import type { PaperRegister } from "./papers.ts";
import type { StateVocabulary } from "./states.ts";
import { parseTheory, type TheoryMark, type TheorySpan } from "./theory-marks.ts";

/** Why a section is empty. See the block above — the two are not one fact. */
export type CardGap = "none-recorded" | "no-field-yet";

/** A section's content, or the reason there is none. */
export type CardValue<T> = { readonly held: true; readonly value: T } | {
  readonly held: false;
  readonly gap: CardGap;
  /**
   * Why the field is empty, in this locale, when the record says so.
   *
   * **A gap note that says nothing is what this replaces.** `noneFound` — the
   * owner's own *"none found yet"* — is right when nobody has looked, and it is
   * the wrong sentence on a record where somebody looked at every source and
   * wrote down what they found. `backward-euler` has an implementations entry
   * for exactly that reason: Dong, Li and Xue set the off-diagonal Padé cases
   * aside two sections before their first experiment. A reader seeing "None
   * found yet." there is being told the opposite of what the record knows.
   *
   * Read off `LayerMethod.absences`, which validation has already proved is only
   * ever set on a field that is genuinely empty — so this can never contradict a
   * value beside it.
   */
  readonly reason?: string;
};

const held = <T,>(value: T): CardValue<T> => ({ held: true, value });
const missing = <T,>(gap: CardGap, reason?: string): CardValue<T> =>
  reason === undefined ? { held: false, gap } : { held: false, gap, reason };

/**
 * The declared reason for a field being empty, in the card's locale.
 *
 * Keyed exactly as an author writes it — `cost`, `example.text` — so the lookup
 * and the declaration cannot drift apart into two spellings of one field name.
 *
 * **Exported for the same reason `exampleRunNote` is.** The method's own page
 * (`components/repository-layers.tsx`) reads the node directly rather than through
 * a card, so it needs this lookup too — and a second copy of "which key does an
 * author type" is exactly the drift the keying comment above is about.
 */
export function absenceOf(method: LayerMethod, field: string, ja: boolean): string | undefined {
  const absence = method.absences?.[field];
  if (absence === undefined) return undefined;
  return ja ? absence.reasonJa : absence.reason;
}

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

/**
 * `stated`, but carrying the researched reason when the field is empty.
 *
 * Split from `stated` rather than folded into it because most fields have no
 * `absences` key and passing `undefined` at every call site would read as if they
 * might. The two that do — `cost` here, `implementations` below — say so at the
 * call.
 */
function statedOr(value: string | undefined, reason: string | undefined): CardValue<string> {
  return value !== undefined && value.trim() !== "" ? held(value) : missing("none-recorded", reason);
}

/** A node reduced to what a card draws for it: a name and a way to reach it. */
export interface CardLink {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly href: string;
}

/**
 * One end of a hop, as a reader meets it: the state's **label**, with its id
 * kept for the addresses that need one.
 *
 * **A pair rather than a bare id, and that shape is the fix.** These two fields
 * were one `string` holding the id, and both renderers printed it — so the card
 * showed a reader `ground-state-problem ⟶ parameterized-circuit` where the
 * method's own page, three clicks away, showed *Hamiltonian whose ground state
 * is wanted ⟶ Parameterised circuit family* off `stateLabel()`. In `ja` it was
 * worse than inconsistent: the slugs are English, every state carries a
 * `labelJa`, and none of it reached the card.
 *
 * Swapping the printed string would have fixed today's two call sites and left
 * the next one free to make the same mistake. A pair cannot be printed by
 * accident — `{hop.from}` stops compiling — so the id survives exactly where an
 * id belongs (`data-hop`, React keys, tests) and the label is what reaches a
 * reader.
 */
export interface CardState {
  readonly id: string;
  readonly label: string;
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
  readonly from: CardState;
  readonly to: CardState;
  /** The slot filling this hop, or null when the method does the work itself. */
  readonly via: CardLink | null;
  /**
   * What the method does on the hop it closes itself, where the record says —
   * and `null` everywhere else, including on every hop a slot fills.
   *
   * Read off the same `hops[method.id]` entry as `theory`, through the one
   * reader in `converge-layout.ts`, so the card and the map can never disagree
   * about what this stretch is called. The component falls back to
   * `ownStepName` when it is null, which is the standing phrase and says
   * nothing about the algorithm — that is the state this field exists to
   * shrink, hop by hop, exactly as `theory` above it does.
   *
   * Not a `CardValue`: an unnamed stretch already draws a phrase, so there is no
   * gap for the card to report. "None recorded" under a line that reads *the
   * method itself* would be the card telling a reader it has nothing, directly
   * beneath the something it just drew.
   */
  readonly ownName: string | null;
  /** True when the state after this hop came from `through`, not the slot's contract. */
  readonly narrowed: boolean;
  /**
   * The mathematics of this hop, split into runs, with the approximations and
   * assumptions marked inside it.
   *
   * **One value where session 114 had three**, and the parse happens here rather
   * than in the component for the reason this whole module exists: a distinction
   * drawn inside JSX is one the census cannot count. The component receives runs
   * and paints them; whether a hop marks an approximation is a question this
   * file can answer.
   */
  readonly theory: CardValue<readonly TheorySpan[]>;
  /**
   * How many times this hop is walked, where a source says — and `null` where
   * none does.
   *
   * **Chrome, like `narrowed`, and for the same reason.** It is not a
   * `CardValue`: `repeats` is written only where a source states a multiplicity,
   * and `layers.ts` is explicit that absent means *no source we read said this
   * step runs more than once* and never *it runs once*. A section reading "none
   * found yet" under every unrepeated hop would print that non-claim 85 times
   * and turn an absence into a search nobody ran.
   */
  readonly repetition: CardRepetition | null;
}

/**
 * A step's multiplicity, as the source states it, resolved to one locale.
 *
 * The same record `repository-layers.tsx` badges on the node page — the count,
 * the closure, and why it turns that many times — carried here because until now
 * **the card was the one surface that said nothing about it at all**, measured
 * across canvas, card and node page in `W12-what-the-map-cannot-say.md`. It is on
 * 9 methods, nearly twice as many as `refines`, and a reader deciding between two
 * ways of filling a slot is usually deciding on exactly this number.
 */
export interface CardRepetition {
  readonly count: string;
  /** `coherent` or `measured`. What one turn costs, which is the other fact. */
  readonly closure: LoopClosure;
  readonly note: string;
}

/**
 * One thing a method needs that does not move its route along — and how many
 * times it needs it.
 *
 * **`repeats` keys a step, and 5 of its 8 records key a `feeds` step rather
 * than a hop.** Measured against `routeOf`: only `time-marching-usva`,
 * `qsvt-matrix-inversion` and `qsvt-transform` repeat something that is drawn as
 * a hop. HHL's `state-preparation` and `hamiltonian-simulation`, and all three
 * readouts' `state-preparation`, are
 * ingredients. `W12` proposed drawing the count "beside the lane's name" on the
 * assumption it sat on the chain; putting it only there would have reached 3 of
 * the records and left the five most expensive loops on this map — every
 * readout's ε^-2, HHL's two κ's — exactly as invisible as before.
 *
 * (7 of 10 until session 118: `backward-euler`'s and the trapezoidal rule's
 * `quantum-linear-solve` were two of the seven, and the owner ruled that
 * ingredient off the map. The argument is unchanged — the majority still key a
 * feed — and the two counts survive as prose on those records' `conditions`.)
 *
 * So *Requires* is a list of pairs rather than a list of links.
 */
export interface CardIngredient {
  readonly link: CardLink;
  readonly repetition: CardRepetition | null;
  /**
   * The mathematics of this ingredient **in this route**, when a source states
   * it — the same `hops` note a chain hop carries, read with the same key.
   *
   * **Added because the argument `IngredientList`'s doc comment already makes
   * for `repeats` is the same argument, and it was only half applied.** That
   * comment records the surprise: *"7 of the 10 records key a `feeds` step
   * rather than a hop… A count drawn only on the chain would have left every one
   * of them exactly where it was — nowhere."* `hops` is keyed exactly as
   * `repeats` is, `validateLayerGraph` accepts a feed step as a key, and the
   * chain was the only reader — so a note written about an ingredient rendered
   * on no surface at all.
   *
   * It is not a hypothetical: `hhl-qpe-inversion` delegates all three of its
   * steps as ingredients, so its route draws one segment and every sentence
   * about preparing $|b\rangle$ $O(\kappa)$ times, and about the conditional
   * evolution that is rebuilt with it, has nowhere else to go. That is the hop
   * where the route's dominant cost lives.
   */
  readonly theory: CardValue<readonly TheorySpan[]>;
}

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
   * The two halves of `refines` — chrome for the DRAWN relation, and (since
   * s121) a section for the folded one. Two owner rulings, in order:
   *
   * Session 113: *"just make it clear what the difference is, and it should
   * show up in UI in clear way without cluttering"* — which made the relation
   * chrome, not a section, because a "Narrower versions: none found yet" line
   * on all 58 methods that have none would be 58 statements about a search
   * nobody ran.
   *
   * Session 121 superseded HALF of that: *"these kinds of refinements can
   * exist within the LCHS card within its own section … until there is
   * actually a difference that we can represent in the map itself for the
   * user."* A refinement with `sameInternalsAsParent` no longer draws a lane
   * at all, so the parent's card is now the ONLY surface that shows it beside
   * what it narrows — that is what earns it a real section (`refinements`
   * below). The chrome keeps carrying what it always carried: the child card's
   * own back-link, and the drawn (non-folded) narrower versions.
   *
   * **What is different is still answered by the child's own words, not by a
   * copy.** The section entry reads the child node's `summary` and
   * `potentialPath` directly — nothing is restated, so nothing can drift.
   */
  readonly refines: CardLink | null;
  /** Narrower versions that DRAW — folded ones live in `refinements` instead. */
  readonly refinedBy: readonly CardLink[];
  /**
   * Folded refinements: same internals as this method, better analysis —
   * each entry the child's own lede plus what would earn it a path of its own.
   * `none-recorded` is the honest empty (the field exists; the corpus records
   * no fold here), same as `example`/`implementations` since session 114.
   */
  readonly refinements: CardValue<readonly CardRefinementEntry[]>;
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
  readonly ingredients: CardValue<readonly CardIngredient[]>;
  /**
   * **Both now read a field, and the copy a reader sees changed with them.**
   *
   * Until session 114 these were `CardValue<never>` — permanently `no-field-yet`,
   * because nothing anywhere could hold them. The owner signed both models off
   * in §2 (*"Say yes and I build it."* — *"yes."*), so the fields exist, and an
   * empty one now honestly reports `none-recorded`: we built the place to put
   * it and nobody has written one yet. That is a different sentence from *we
   * have not built the place*, and the whole point of keeping two gap words is
   * that the reader can tell them apart.
   */
  readonly example: CardValue<CardExample>;
  readonly implementations: CardValue<readonly CardImplementation[]>;
  /**
   * How many of this method's cited papers report numerics or a hardware run.
   *
   * **The worklist behind an empty Implementations section**, and derived rather
   * than authored — the paper register already carries `reports` per paper, read
   * from its abstract and recorded with the basis beside it. 25 of the 63
   * methods cite a paper reporting simulation; 3 cite one reporting hardware.
   *
   * Without this, an empty section says "none found yet" and a reader takes it
   * for a verdict on the literature. With it, the section says nobody has
   * written the entries *and* that there is something to write, which is what
   * `W5-card-spec.md` means by the empty card being a worklist rather than a
   * gap report. Absent when no cited paper has been read for it — never zero,
   * because zero is a count and this would be an absence of one.
   */
  readonly implementationLeads: CardValue<CardImplementationLeads>;
}

/**
 * One folded refinement on its parent's card (s121, W17): the link, the
 * child's own lede, and the child's own note on what granular research would
 * give it a drawable path. Both prose strings are READ off the child node,
 * never copied into a second home.
 */
export interface CardRefinementEntry {
  readonly link: CardLink;
  readonly summary: string;
  readonly potentialPath: string;
}

/** A worked example, its pseudocode, or both. */
export interface CardExample {
  readonly text: string | null;
  /**
   * Where the run in `text` is reported, and what kind of run it is — one line,
   * localised. `null` when there is no prose.
   *
   * **Rendered, not merely stored.** `MethodExample.run` exists to make a negative
   * account unwritable, and it would do that job as pure validation data — but it
   * also carries the fact a reader most needs and is likeliest to get wrong. All
   * three runs in the graph are classical simulations, and a section headed
   * "Example" with numbers under it reads as *this ran on a quantum computer*
   * unless something on the card says otherwise. A field that validates and
   * renders nowhere is how that stays invisible.
   */
  readonly runNote: string | null;
  /**
   * Why there is no worked run, when the record says so — the half of
   * `absences` that a section-level gap note can never reach.
   *
   * **Four of the graph's first six declared absences are exactly this case**,
   * and all four were invisible until this field existed: a method with
   * pseudocode and no prose has a HELD Example section, so the section-level gap
   * note never draws and the reason had nowhere to go. The pseudocode was
   * hiding the account of the missing half.
   */
  readonly textReason: string | null;
  readonly pseudocode: string | null;
}

/**
 * Which branch of `W5-card-spec.md`'s implementations tree an entry came from.
 *
 * **The classification stamp of ruling `27267f`, and the thing that makes the
 * record join safe.** Once a repository record's runnable variant appears in
 * this list beside a hand-written paper reproduction, the two are
 * indistinguishable without a stamp — and claiming a corpus scaffold reproduced
 * a paper is exactly the kind of provenance error the register exists to stop.
 *
 * `authored` is the first two branches (an implementation from a paper, or an
 * independent derivation of one), which are written on the node by hand.
 * `record` is the third — *"implementations that are not from a paper but have
 * been run"* — which is a repository record's code variant, joined rather than
 * re-typed.
 */
export type CardImplementationOrigin =
  | { readonly kind: "authored" }
  | {
      readonly kind: "record";
      readonly slug: string;
      readonly href: string;
      /** The record's own verification status, verbatim. Never paraphrased here. */
      readonly status: string;
      readonly provenance: string;
    };

/** One implementation, with the owner's five sub-sections. */
export interface CardImplementation {
  readonly id: string;
  readonly label: string;
  readonly papers: readonly LayerCitation[];
  readonly origin: CardImplementationOrigin;
  /** The five, in his order, each held or absent. Ordered so the card cannot reorder them. */
  readonly sections: ReadonlyArray<{
    readonly id: ImplementationSectionId;
    readonly value: CardValue<string>;
  }>;
}

export const IMPLEMENTATION_SECTIONS = ["about", "methods", "data", "code", "results"] as const;

export type ImplementationSectionId = (typeof IMPLEMENTATION_SECTIONS)[number];

/** What the register says the cited papers report. See `implementationLeads`. */
export interface CardImplementationLeads {
  readonly simulation: number;
  readonly hardware: number;
  /**
   * Cited papers with **no** `reports` row — nobody has read them for this.
   *
   * Carried because `simulation: 0` alone is ambiguous in the one direction that
   * matters. Until 2026-08-12 every populated row in the register was an
   * abstract read, so zero always meant *"the abstracts did not mention
   * numerics"* and silence was the honest response. Full-text reads changed
   * that: zero now means one of two very different things — **every cited paper
   * has been read and none reports a run**, which is a finding and the section's
   * final answer, or **nobody has looked**, which is a worklist item. This is
   * the number that tells them apart.
   */
  readonly unread: number;
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
  readonly from: CardState;
  readonly to: CardState;
  /**
   * What the method does across those two states, where the record says — and
   * `null` where nothing has been recorded, in which case the panel draws the
   * standing phrase.
   *
   * The same value the map draws on this stretch's lane, through the same
   * reader (`ownStretchName`). A reader who clicks the phrase on the canvas
   * must read that phrase back on the card, which is the promise `ownStepName`
   * made in its own comment and which only held while both surfaces printed one
   * hardcoded string.
   */
  readonly ownName: string | null;
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
  /**
   * The paper register, for the worklist behind an empty Implementations
   * section. See `MethodCard.implementationLeads`.
   *
   * **Required, not optional with a fallback.** An optional register would
   * default every card to "no leads" wherever a caller forgot it, and that is
   * indistinguishable from a method whose papers genuinely report nothing —
   * a correct-looking fallback hiding a path that never runs. Required makes a
   * caller that has not been updated a compile error instead.
   */
  readonly register: PaperRegister;
}

/** The layer-graph page for a node. The card never replaces this — it links to it. */
export function nodePageHref(id: string): string {
  return `/repository/layers/${id}`;
}

/**
 * A state id and the label a reader should see for it.
 *
 * **Falls back to the id rather than to an empty string**, because a state the
 * vocabulary does not hold is a graph error `validateLayerGraph` already
 * refuses, and a blank end of a hop would hide it on the one surface where it
 * would otherwise be obvious. The fallback is the loud one on purpose.
 */
function stateRef(vocabulary: StateVocabulary, id: string, ja: boolean): CardState {
  const state = vocabulary.states.find((entry) => entry.id === id);
  return { id, label: state === undefined ? id : ja ? state.labelJa : state.label };
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

function listOrGap<T>(items: readonly T[]): CardValue<readonly T[]> {
  return items.length === 0 ? missing("none-recorded") : held(items);
}

/**
 * The multiplicity recorded for one step of a method, resolved to one locale.
 *
 * One reader for both places a step is drawn — the hop and the ingredient — so
 * the two cannot disagree about what the record says, and a step that moves from
 * `steps`-as-hop to `steps`-as-feed keeps its count without anything being
 * edited here.
 */
function repetitionFor(
  method: LayerMethod,
  stepId: string | null,
  ja: boolean,
): CardRepetition | null {
  if (stepId === null) return null;
  const repetition = repetitionOf(method, stepId);
  if (repetition === null) return null;
  return {
    count: ja ? repetition.countJa : repetition.count,
    closure: repetition.closure,
    note: ja ? repetition.noteJa : repetition.note,
  };
}

/**
 * The key a hop's note is filed under.
 *
 * A capability id where a named slot covers the hop, and the **method's own id**
 * for the stretch it closes itself — which is unambiguous because node ids are
 * unique across the whole graph, so a method id can never also be a capability
 * id. See `LayerMethod.hops`.
 */
function hopKey(method: LayerMethod, capabilityId: string | null): string {
  return capabilityId ?? method.id;
}

/**
 * What the register says this method's cited papers report.
 *
 * Read off `reports`, which is authored per paper from its abstract with the
 * basis recorded beside it — never derived from the prose here. Only
 * `"reported"` counts: `"unknown"` on the simulation axis is the register's own
 * way of saying the abstract did not mention numerics, which is not evidence of
 * either answer, and counting it would turn a recorded uncertainty into a lead.
 */
function implementationLeadsOf(
  method: LayerMethod,
  register: PaperRegister,
): CardValue<CardImplementationLeads> {
  const byUrl = new Map(register.papers.map((paper) => [paper.url, paper]));
  const cited = (method.citations ?? []).map((citation) => byUrl.get(citation.url));
  const read = cited.filter((paper) => paper?.reports !== undefined);
  // Absent, not zero. No cited paper has been read for this, so there is no
  // count to report — and "0 papers report numerics" would claim a search.
  if (read.length === 0) return missing("none-recorded");
  // A paper the register does not carry counts as unread rather than being
  // dropped: `check-layer-graph.mjs` proves every citation resolves against the
  // register in the repo, and nothing proves it against the register the page
  // was built from. Silently omitting it would turn a shortfall into a stronger
  // claim, which is the direction this module never lets a count move.
  return held({
    simulation: read.filter((paper) => paper!.reports!.simulation === "reported").length,
    hardware: read.filter((paper) => paper!.reports!.hardware === "reported").length,
    unread: cited.length - read.length,
  });
}

/** The mathematics of one hop, read off `LayerMethod.hops` under `hopKey`. */
function hopNoteOf(
  method: LayerMethod,
  capabilityId: string | null,
  ja: boolean,
): Pick<CardHop, "theory"> {
  const note = method.hops?.[hopKey(method, capabilityId)];
  const source = note === undefined ? undefined : ja ? note.theoryJa : note.theory;
  const prose = stated(source);
  // `stated` decides held-ness off the string, and the parse follows it rather
  // than deciding it again. A note of pure whitespace is not held, and a parse
  // of it would return no spans — two ways to answer one question, which is the
  // shape this module keeps eliminating.
  return {
    theory: prose.held ? held(parseTheory(prose.value)) : missing(prose.gap),
  };
}

/**
 * "Classical simulation · Section 4.3, Figure 2 of arXiv:1910.14596", localised.
 *
 * **Exported because the example is drawn twice.** The card builds it through
 * `CardExample`; the method's own page (`components/repository-layers.tsx`) reads
 * `node.example` straight off the node. Two renderers of one field is how a field
 * comes to appear on one surface and not the other — which is exactly what happened
 * on the first pass of this change, and was only caught by reading the rendered page
 * rather than the diff. One function, both callers.
 */
export function exampleRunNote(run: MethodExampleRun | undefined, ja: boolean): string | null {
  if (run === undefined) return null;
  const kind = {
    simulation: { en: "Classical simulation", ja: "古典計算機によるシミュレーション" },
    hardware: { en: "Run on quantum hardware", ja: "量子ハードウェア上での実行" },
    analytic: { en: "Worked analytic instance", ja: "解析的に追った具体例" },
  }[run.kind];
  // The arXiv id rather than the url: the url is already a link on the card's
  // citation list, and a bare address inside a one-line note is chrome.
  const paper = run.paper.replace(/^https?:\/\/arxiv\.org\/abs\//, "arXiv:");
  return ja ? `${kind.ja}・${paper} ${run.at}` : `${kind.en} · ${run.at} of ${paper}`;
}

function exampleOf(method: LayerMethod, ja: boolean): CardValue<CardExample> {
  const example = method.example;
  if (example === undefined) return missing("none-recorded");
  const text = ja ? example.textJa : example.text;
  // Pseudocode is not localised — see `MethodExample.pseudocode`. It is the same
  // block in both locales on purpose, because its identifiers are the record's
  // own symbols and a translated listing is a second one that drifts.
  return held({
    text: text ?? null,
    // Keyed off `text`, not off `run`: the two are required together by
    // `validateLayerGraph`, and reading `run` independently here would draw a
    // provenance line under nothing on a record that had somehow got past it.
    runNote: text ? exampleRunNote(example.run, ja) : null,
    textReason: text ? null : (absenceOf(method, "example.text", ja) ?? null),
    pseudocode: example.pseudocode ?? null,
  });
}

/**
 * The joined implementations: what the node authored, then what its records run.
 *
 * **Ruling `27267f`, as code.** Before this, the section read `method.implementations`
 * alone and was empty on all 74 methods — while every corpus record carries
 * `codeVariants`, and in all 27 method→record pairs the card rendered
 * "none-recorded" over a record that had code. That was never a research gap.
 * The content was authored; nothing joined it.
 *
 * Authored entries come first and keep their order: they are the two branches of
 * `W5-card-spec.md`'s tree that a person wrote (an implementation from a paper,
 * or an independent derivation of one), and a hand-written reproduction is the
 * more specific claim. Record-derived entries follow, one per runnable variant,
 * carrying `origin: "record"` so the two can never be confused for each other —
 * without that stamp the card would let a corpus scaffold read as a paper
 * reproduction, which is the provenance error the register exists to prevent.
 *
 * The variant's **code is deliberately not inlined**. `LayerCorpusEntry` projects
 * facts about a variant, not its source, and the record page owns the source —
 * see that interface for why the ruling narrows the projection rather than
 * widening it into a second copy.
 */
function implementationsOf(
  method: LayerMethod,
  corpus: readonly LayerCorpusEntry[],
  ja: boolean,
): CardValue<readonly CardImplementation[]> {
  const authored = (method.implementations ?? []).map((entry) => ({
    id: entry.id,
    label: ja ? entry.labelJa : entry.label,
    papers: entry.papers ?? [],
    origin: { kind: "authored" } as const,
    // The five in his order, resolved here rather than in the component, for
    // the reason the whole module exists: a sub-section written as
    // `{x ? <p/> : null}` inside JSX is one the census cannot count, and the
    // gaps inside an implementation are the interesting part of it.
    sections: IMPLEMENTATION_SECTIONS.map((id) => ({
      id,
      value: stated(ja ? entry[`${id}Ja` as const] : entry[id]),
    })),
  }));

  const bySlug = new Map(corpus.map((entry) => [entry.slug, entry]));
  const joined: CardImplementation[] = [];
  for (const slug of entriesFor(method, new Set(bySlug.keys()))) {
    const record = bySlug.get(slug)!;
    for (const variant of record.runnable ?? []) {
      joined.push({
        // Keyed on the pair, because one record can offer the same method
        // several frameworks and one framework can appear under several records.
        id: `record:${slug}:${variant.framework}`,
        label: `${ja ? record.titleJa : record.title} · ${variant.framework}`,
        // Empty on purpose, and a real value rather than a gap: this is the
        // branch the spec calls "not from a paper but has been run".
        papers: [],
        origin: {
          kind: "record",
          slug,
          href: `/repository/${slug}`,
          status: variant.status ?? record.provenance ?? "",
          provenance: record.provenance ?? "",
        },
        sections: IMPLEMENTATION_SECTIONS.map((id) => ({
          id,
          value: stated(
            id === "about"
              ? ja
                ? record.descriptionJa
                : record.description
              : id === "code"
                ? variant.filename ?? variant.framework
                : id === "results"
                  ? record.verification
                  : // `methods` and `data` are the record's own gaps, not this
                    // join's: a repository record states what it is and how it
                    // was checked, and nothing in it describes a procedure or a
                    // dataset. Left absent so the card reports them as missing
                    // rather than inventing a sentence to fill the slot.
                    undefined,
          ),
        })),
      });
    }
  }

  const entries = [...authored, ...joined];
  // The declared reason applies to the AUTHORED half only, and the join is
  // checked first for that reason: a record that supplies a runnable variant has
  // filled the section by another route, so a reason saying "no cited paper
  // implements this" would be true and beside the point.
  if (entries.length === 0) {
    return missing("none-recorded", absenceOf(method, "implementations", ja));
  }
  return held(entries);
}

/**
 * The `refinements` section's entries: this method's folded narrower versions
 * (`sameInternalsAsParent`), each carrying the child's own lede and its own
 * potential-path note. Validation guarantees `potentialPath` exists in both
 * locales whenever the flag is set, so the fallback empty string here is
 * unreachable rather than a silent default.
 */
function refinementEntriesOf(
  graph: LayerGraph,
  method: LayerMethod,
  ja: boolean,
): CardValue<readonly CardRefinementEntry[]> {
  const entries = refinementsOf(graph, method)
    .filter((child) => child.sameInternalsAsParent === true)
    .map((child) => {
      const link = linkFor(graph, child.id, ja);
      if (link === null) return null;
      return {
        link,
        summary: ja ? child.summaryJa : child.summary,
        potentialPath: (ja ? child.potentialPathJa : child.potentialPath) ?? "",
      };
    })
    .filter((entry): entry is CardRefinementEntry => entry !== null && entry.potentialPath !== "");
  return entries.length === 0 ? missing("none-recorded") : held(entries);
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
    from: stateRef(vocabulary, route.states[index] ?? "", ja),
    to: stateRef(vocabulary, route.states[index + 1] ?? "", ja),
    via: segment.capabilityId === null ? null : linkFor(graph, segment.capabilityId, ja),
    // Only on the stretch the method closes itself; a slot-filled hop is named
    // by its slot, which `via` above already carries.
    ownName:
      segment.capabilityId === null ? ownStretchName(method, ja) : null,
    narrowed: segment.narrowed,
    // `none-recorded` now, not `no-field-yet`: `LayerMethod.hops` exists, so an
    // empty slot is a source nobody has read rather than a field nobody has
    // built. The two sentences differ and the reader can only tell them apart
    // because the card keeps them apart.
    ...hopNoteOf(method, segment.capabilityId, ja),
    // Keyed by the same id the hop is filed under, so a hop the method closes
    // itself carries no count — `repeats` names a *step*, and the stretch a
    // method walks alone is not one of its steps.
    repetition: repetitionFor(method, segment.capabilityId, ja),
  }));
  const ingredients = route.feeds
    .map((id) => {
      const link = linkFor(graph, id, ja);
      return link === null
        ? null
        : {
            link,
            repetition: repetitionFor(method, id, ja),
            // Same key, same reader as the chain's — see `CardIngredient.theory`
            // for why a feed's note had no surface before this.
            ...hopNoteOf(method, id, ja),
          };
    })
    .filter((item): item is CardIngredient => item !== null);

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
    // The partition the s121 ruling cut: a narrower version either DRAWS (its
    // own lane, chrome here) or FOLDS (no lane, a full entry in the
    // `refinements` section). One child, one home.
    refinedBy: refinementsOf(graph, method)
      .filter((child) => child.sameInternalsAsParent !== true)
      .map((child) => linkFor(graph, child.id, ja))
      .filter((link): link is CardLink => link !== null),
    refinements: refinementEntriesOf(graph, method, ja),
    contract: contractOf(graph, method, ja),
    whenItApplies: stated(ja ? method.conditionsJa : method.conditions),
    // The researched reason where there is one, not the standing gap note — same
    // key and same reader as the method page's, so the two surfaces cannot say
    // opposite things about one field. `implementations` shipped exactly that
    // disagreement on three methods before it was caught on production.
    cost: statedOr(ja ? method.costJa : method.cost, absenceOf(method, "cost", ja)),
    contested: stated(ja ? method.contestedJa : method.contested),
    trace: hops.length === 0 ? missing("none-recorded") : held(hops),
    ingredients: listOrGap(ingredients),
    papers:
      method.citations === undefined || method.citations.length === 0
        ? missing("none-recorded")
        : held(method.citations),
    records: recordsOf(method, corpus, ja),
    example: exampleOf(method, ja),
    implementations: implementationsOf(method, corpus, ja),
    implementationLeads: implementationLeadsOf(method, input.register),
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
    from: stateRef(vocabulary, from, ja),
    to: stateRef(vocabulary, to, ja),
    ownName: ownStretchName(method, ja),
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
  | "refinements"
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
    // After Performance and before Contested, s121: a folded refinement's whole
    // claim is "same walk, better analysis", which is a performance-adjacent
    // sentence — and like Contested it is commentary on the method's standing
    // rather than part of the recipe above it.
    of("refinements", card.refinements),
    of("contested", card.contested),
    of("implementations", card.implementations),
    of("records", card.records),
  ];
}

/**
 * Every hop of Theory, swept flat, with what its mathematics holds.
 *
 * A second census, deliberately not folded into `cardSections`. The question
 * *"how much of this card is empty"* has two honest answers at two levels:
 * Theory is **held** on all 63 methods because the chain is, and a hop inside it
 * is empty because no source has been read for its mathematics. One number
 * covering both would report a card as fuller than it reads — the top level
 * would say "Theory: held" and the reader would open it and find nothing.
 *
 * **It used to sweep three slots per hop and now sweeps one**, because the two
 * others became marks inside the mathematics on the owner's re-decision. `marks`
 * is what replaced them in the census: an authored hop that marks nothing and an
 * authored hop that marks an approximation are different facts, and after the
 * change there is no other level at which the difference is countable.
 */
export function cardHopNotes(
  card: Card,
): Array<{ hop: string; state: "held" | CardGap; marks: readonly TheoryMark[] }> {
  if (card.kind !== "method" || !card.trace.held) return [];
  return card.trace.value.map((hop, index) => ({
    hop: `${index}:${hop.from}>${hop.to}`,
    state: sectionState({ value: hop.theory }),
    marks: hop.theory.held
      ? hop.theory.value
          .map((span) => span.mark)
          .filter((mark): mark is TheoryMark => mark !== null)
      : [],
  }));
}

/**
 * Every multiplicity this card draws, and **where on it** the reader finds one.
 *
 * A third census, and it exists because the interesting failure here is not an
 * empty section — it is a record the card silently never reaches. `repeats` is
 * keyed by a step, a step is either a hop of the chain or an ingredient, and
 * those are drawn by two different pieces of the panel. A count keyed to a step
 * that is neither would render nowhere at all and no section would report a gap,
 * because no section is missing: `Requires` would be held, `Theory` would be
 * held, and the fact would simply be gone.
 *
 * So the test reads this against the graph's own records rather than against a
 * number typed into it. `place` is carried because it is the part the plan got
 * wrong: `W12` assumed these sat on the chain, and 7 of the 10 are ingredients.
 */
export function cardRepetitions(
  card: Card,
): Array<{ place: "hop" | "ingredient"; step: string; count: string; closure: LoopClosure }> {
  if (card.kind !== "method") return [];
  const found: Array<{
    place: "hop" | "ingredient";
    step: string;
    count: string;
    closure: LoopClosure;
  }> = [];
  if (card.trace.held) {
    for (const hop of card.trace.value) {
      if (hop.repetition === null) continue;
      found.push({
        place: "hop",
        step: hop.via?.id ?? "",
        count: hop.repetition.count,
        closure: hop.repetition.closure,
      });
    }
  }
  if (card.ingredients.held) {
    for (const ingredient of card.ingredients.value) {
      if (ingredient.repetition === null) continue;
      found.push({
        place: "ingredient",
        step: ingredient.link.id,
        count: ingredient.repetition.count,
        closure: ingredient.repetition.closure,
      });
    }
  }
  return found;
}
