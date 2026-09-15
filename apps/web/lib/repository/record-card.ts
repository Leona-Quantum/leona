/**
 * A record, read as the map card reads a method.
 *
 * The 2026-09-10 Atlas pass: the owner asked for *"the entries in the atlas
 * itself to match exactly how the cards look like when clicked into on the
 * map"*. The card's sections are an owner-ruled list in an owner-ruled order
 * (`cardSections` in `card-content.ts`), so the record page draws a subsequence
 * of that list, in that order, and fills each section from the record's own
 * fields:
 *
 * | section          | on a record                                             |
 * |------------------|---------------------------------------------------------|
 * | When it applies  | the introduction — what this is for                     |
 * | Input / Output   | the interface piece, read from both ends like the card   |
 * | Theory           | how it works                                            |
 * | Requires         | the facts: qubits, depth, the matrix, the parameters    |
 * | Example          | the circuit and its measured outcomes                   |
 * | Performance      | circuit structure, fault-tolerant cost, quantum vs classical |
 * | Contested        | the declared gaps                                       |
 * | Implementations  | the record's own code, per framework                    |
 * | In the Atlas     | where the map names it, and the related records         |
 *
 * References sit below the sections, as they do on the card. Refinements,
 * Alternatives and Makes unnecessary have no field on a record and are left
 * out rather than drawn as gaps — the same call the process card makes for the
 * method-only sections.
 *
 * **What is held and what is a gap is decided here, not in the view**, so a
 * test can read it, and so the view cannot draw a section that says nothing:
 * `AtlasSection` discards the body of a section that is not held.
 */
import type { CardGap, CardSectionId } from "./card-content.ts";
import { knownGapsState } from "./coverage.ts";
import { parseCardSection, withCardSection } from "./map-card.ts";
import { isPlaceholderDiagram } from "./placeholder-diagrams.ts";
import type { PublicRepositoryEntry } from "./types.ts";

export type RecordSectionId = Extract<
  CardSectionId,
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
>;

/**
 * The record page's sections, in the card's order. A subsequence of the method
 * card's list — `repository-record-card.test.ts` checks that against
 * `cardSections` itself, so a reorder on the card fails here.
 */
export const RECORD_SECTION_ORDER: readonly RecordSectionId[] = [
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
];

export interface RecordSectionState {
  readonly id: RecordSectionId;
  readonly held: boolean;
  readonly gap?: CardGap;
  /** The record's own reason for the gap, in the reader's language, when it states one. */
  readonly reason?: string;
}

export interface RecordCardInput {
  readonly entry: PublicRepositoryEntry;
  readonly locale: "en" | "ja";
  /** Whether the server found a circuit-structure panel to draw. */
  readonly hasProfile: boolean;
  /** Whether the server found a cost estimate to draw. */
  readonly hasEstimate: boolean;
  /** Whether the map names this record anywhere — `entryLayerPresence`. */
  readonly hasLayers: boolean;
  readonly relatedCount: number;
  /** The two declared reasons a section can be empty, in the reader's language. */
  readonly words: { readonly unreviewed: string; readonly notCircuit: string };
}

const HELD = (id: RecordSectionId): RecordSectionState => ({ id, held: true });
const GAP = (id: RecordSectionId, reason?: string): RecordSectionState =>
  reason === undefined ? { id, held: false, gap: "none-recorded" } : { id, held: false, gap: "none-recorded", reason };

/** Every section of the record page, in order, each resolved to held or to its gap. */
export function recordSections(input: RecordCardInput): readonly RecordSectionState[] {
  const { entry, locale } = input;
  const ja = locale === "ja";
  const introduction = ja ? entry.introductionJa : entry.introduction;
  const explanation = ja ? entry.explanationMdJa ?? entry.explanationJa : entry.explanationMd ?? entry.explanation;
  const gaps = knownGapsState(entry.knownGaps);
  const drawing = entry.visualization;
  return RECORD_SECTION_ORDER.map((id) => {
    switch (id) {
      case "when-it-applies":
        return introduction.trim() === "" ? GAP(id) : HELD(id);
      // The interface piece always answers — "not a pipeline stage" is an
      // answer, and most records give it — so both ends are always held.
      case "input":
      case "output":
        return HELD(id);
      case "theory":
        return explanation.trim() === "" ? GAP(id) : HELD(id);
      case "requires":
        return entry.resources.length + entry.metadata.length === 0 ? GAP(id) : HELD(id);
      case "example":
        if (drawing.wires.length + drawing.operations.length + drawing.outcomes.length === 0) return GAP(id);
        // One of the corpus's three stock placeholder diagrams (§ isPlaceholderDiagram)
        // is not a circuit for this record — it is the schema's default, repeated
        // identically across 177 unrelated records. Held would draw it as if it
        // were this record's own worked example, which is the thing this gate exists
        // to stop; a record's own reason for the gap is the same one the
        // Implementations section already gives for a non-circuit record.
        return isPlaceholderDiagram(drawing) ? GAP(id, input.words.notCircuit) : HELD(id);
      // The comparison is always drawn (the record's own, or the category's
      // standing one), so this section is never a gap; the two server panels
      // join it when the server found them.
      case "performance":
        return HELD(id);
      // "Reviewed and found none" is a statement, and is held. "Nobody has
      // looked" is the gap, and says so in the record's own words.
      case "contested":
        return gaps.kind === "unreviewed" ? GAP(id, input.words.unreviewed) : HELD(id);
      case "implementations":
        return entry.codeVariants.some((variant) => Boolean(variant.code)) ? HELD(id) : GAP(id, input.words.notCircuit);
      case "records":
        return input.hasLayers || input.relatedCount > 0 ? HELD(id) : GAP(id);
      default: {
        const unreachable: never = id;
        return unreachable;
      }
    }
  });
}

/** `?sec=` on a record page, resolved against the record's own list — same rule as the card's. */
export function parseRecordSection(raw: string | string[] | undefined): RecordSectionId | null {
  return parseCardSection(raw, RECORD_SECTION_ORDER);
}

/** The record page's address showing one section — the same parameter the card uses. */
export function recordSectionHref(base: string, section: RecordSectionId): string {
  return withCardSection(base, section);
}
