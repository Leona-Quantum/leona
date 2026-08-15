// Public repository barrel: keeps the import path stable for routes/components
// while the data itself lives in lib/repository/*. Entry content is split into
// per-batch modules so the catalog can grow without one multi-thousand-line file.

import {
  RAW_PUBLIC_REPOSITORY_ENTRIES,
  ADDITIONAL_PUBLIC_REPOSITORY_ENTRIES,
} from "./repository/entries-legacy";
import { GATE_ENTRIES } from "./repository/entries-gates";
import { GATE_ENTRIES_2 } from "./repository/entries-gates-2";
import { ALGORITHM_ENTRIES } from "./repository/entries-algorithms";
import { STATE_OPERATOR_ENTRIES } from "./repository/entries-states-operators";
import { STATE_OPERATOR_ENTRIES_2 } from "./repository/entries-states-operators-2";
import { LITERATURE_EXPANSION_ENTRIES } from "./repository/entries-literature-expansion";
import { ZOO_PARITY_ENTRIES } from "./repository/entries-zoo-parity";
import { CLASSIQ_PARITY_ENTRIES } from "./repository/entries-classiq-parity";
import type {
  PublicRepositoryCodeVariant,
  PublicRepositoryEntry,
  PublicRepositoryFramework,
  PublicRepositoryListEntry,
} from "./repository/types";
import { strongestTier, type VerificationMethodId, type VerificationTier } from "./repository/verification";
// Imported as well as re-exported below: `export … from` re-publishes the name
// without binding it locally, and the list projection here still calls it.
import { deriveVerificationMethods } from "./repository/entry-verification";
import { getPublicRepositoryVariant } from "./repository/entry-variant";
import { deriveTopics } from "./repository/topics";
import { unknownCoverage } from "./repository/coverage";
import { ENTRY_ENRICHMENT } from "./repository/enrichment";
import {
  circuitFramework,
  type PortableCircuit,
  type PortableCircuitGate,
} from "./circuit-frameworks";
import {
  convertCircuitSource,
  generatePortableCircuitCode,
  looksLikeOpenQasm3,
  parseCircuitSource,
} from "./circuit-conversion";

export type {
  PublicRepositoryCategory,
  PublicRepositoryCitation,
  PublicRepositoryClassicalComparison,
  PublicRepositoryCodeVariant,
  PublicRepositoryEntry,
  PublicRepositoryFramework,
  PublicRepositoryListEntry,
  PublicRepositoryStatus,
  PublicRepositoryVariantStatus,
} from "./repository/types";
export {
  PUBLIC_REPOSITORY_CATEGORIES,
  PUBLIC_REPOSITORY_FRAMEWORKS,
} from "./repository/types";
export {
  VERIFICATION_METHODS,
  VERIFICATION_TIERS,
  getVerificationMethod,
  getVerificationTierInfo,
  strongestTier,
  type VerificationMethodId,
  type VerificationMethodInfo,
  type VerificationTier,
  type VerificationTierInfo,
  type VerificationTone,
} from "./repository/verification";
/**
 * Re-exported, not defined here, since 2026-08-15. These three are pure over the
 * entry passed to them and never read the corpus — but this module value-imports
 * every `entries-*.ts` file, so a `"use client"` component importing one of them
 * from here pulled the whole catalog into the browser bundle. Moving the
 * definitions to a leaf and keeping the names here means every server-side caller
 * is untouched while the client can reach the leaf directly. The reasoning, and
 * the numbers, are in `./repository/entry-verification`.
 */
export {
  deriveVerificationMethods,
  entryVerificationMethods,
  entryVerificationTier,
} from "./repository/entry-verification";
/** Same split, same reason — see `./repository/entry-variant`. */
export { getPublicRepositoryVariant } from "./repository/entry-variant";

function replaceLegacyBrand(value: string): string {
  return value
    .replaceAll("Majorana", "Leona Quantum")
    .replaceAll("Nameko", "Nala")
    .replaceAll("Quepo", "Atlas");
}

/**
 * Fields the brand rewrite must not touch.
 *
 * `replaceLegacyBrand` rewrites the substring "Majorana" at every depth of every
 * record. That was safe while the corpus said "Majorana" only as the old product
 * name — measured 2026-08-06, the entries carry zero occurrences, so this has
 * never fired in anger.
 *
 * It stops being safe the moment a record talks about the physics. **Majorana
 * fermions and Majorana zero modes are live terms in this field**, and this is a
 * quantum-computing corpus that the owner intends to populate from papers. A gap
 * reading "no hardware demonstration on Majorana-based qubits" would ship as
 * "...on Leona Quantum-based qubits" — a fabricated claim, in the one field whose
 * entire purpose is honest disclosure — and a citation URL containing the
 * substring would be rewritten into a dead link.
 *
 * So the fields carrying sourced scientific prose are exempt. The exemption is
 * by key name at any depth, which is blunt, and blunt is right here: the cost of
 * missing a rename is an unrewritten legacy brand string in one panel; the cost
 * of rewriting a source's own words is a corpus that misquotes its sources.
 */
const BRAND_REWRITE_EXEMPT_KEYS = new Set([
  "knownGaps",
  "literature",
  // **Added 2026-08-13, the first time this fired in anger.** The comment above
  // predicted the failure exactly and guarded two fields; the corpus then gained
  // a record whose primary source is Kitaev's *Unpaired Majorana fermions in
  // quantum wires*, and every field below carries that title or the physics term
  // — none of which was exempt. `check-paper-register.mjs` caught it, reporting
  // that the entry's source title was "Unpaired Leona Quantum fermions in
  // quantum wires" while the register said "Majorana". A misquoted paper title,
  // on a public page.
  //
  // These are exactly the fields the comment's own principle names — "fields
  // carrying sourced scientific prose" — enumerated rather than left implicit.
  // `sourceUrl` is here for the second reason it gives: a URL containing the
  // substring is rewritten into a dead link.
  // The whole `source` object, matching the `literature` precedent above: after
  // `makeReferenceEntry` the paper's title and URL live at `source.title` and
  // `source.url`, so exempting the flat `sourceTitle`/`sourceUrl` names the
  // author passes in would not reach them. Exempting the container does.
  "source",
  "description",
  "descriptionJa",
  "introduction",
  "introductionJa",
  "explanation",
  "explanationJa",
  "explanationMd",
  "explanationMdJa",
  // **The remaining question is not this list, and should not be answered by
  // growing it.** Each addition is a field somebody noticed; the fields nobody
  // has noticed yet are the ones that will misquote the next source. Whether a
  // rewrite of the old product name should still run at all against a corpus
  // being populated from physics papers — where "Majorana" is a live term — is a
  // question for the owner rather than a set this lane keeps extending.
]);

function normalizePublicRepositoryText(value: unknown): unknown {
  if (typeof value === "string") return replaceLegacyBrand(value);
  if (Array.isArray(value)) return value.map(normalizePublicRepositoryText);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        BRAND_REWRITE_EXEMPT_KEYS.has(key) ? item : normalizePublicRepositoryText(item),
      ]),
    );
  }
  return value;
}


const ALL_RAW_ENTRIES: PublicRepositoryEntry[] = [
  ...RAW_PUBLIC_REPOSITORY_ENTRIES,
  ...ADDITIONAL_PUBLIC_REPOSITORY_ENTRIES,
  ...GATE_ENTRIES,
  ...GATE_ENTRIES_2,
  ...ALGORITHM_ENTRIES,
  ...STATE_OPERATOR_ENTRIES,
  ...STATE_OPERATOR_ENTRIES_2,
  ...LITERATURE_EXPANSION_ENTRIES,
  ...ZOO_PARITY_ENTRIES,
  ...CLASSIQ_PARITY_ENTRIES,
];

export const PUBLIC_REPOSITORY_ENTRIES: PublicRepositoryEntry[] = ALL_RAW_ENTRIES.map((raw) => {
  // `comparisonMetrics` is merged INTO the entry's classical comparison (deep,
  // not replaced) so an enrichment can add a numeric table without restating the
  // prose fields; everything else in the enrichment is a shallow overlay.
  const { comparisonMetrics, ...patch } = ENTRY_ENRICHMENT[raw.slug] ?? {};
  const enriched = { ...raw, ...patch };
  if (comparisonMetrics && enriched.classicalComparison) {
    enriched.classicalComparison = { ...enriched.classicalComparison, metrics: comparisonMetrics };
  }
  const entry = normalizePublicRepositoryText(enriched) as PublicRepositoryEntry;
  return {
    ...entry,
    verificationMethods: deriveVerificationMethods(entry),
    // Classified from the entry's own labels, on the same terms and for the
    // same reason as the line above. See ./repository/topics for the rules.
    topics: entry.topics?.length ? entry.topics : deriveTopics(entry),
    // NOT derived, and the contrast with the two lines above is the point
    // (§3.6). Coverage says what the SOURCE reports; verificationMethods says
    // how Leona checked. Deriving one from the other would manufacture a claim
    // about a paper out of a claim about us. So the only thing that happens
    // here is that an unauthored record is made to say "nobody has checked" in
    // full rather than by omission — `canonicalize` drops undefined-valued
    // keys, and an absent key is indistinguishable from a record predating the
    // field.
    sourceCoverage: entry.sourceCoverage ?? unknownCoverage(),
    // `knownGaps` is deliberately absent from this list. Defaulting it to []
    // would make every record assert "reviewed, declares no gaps" when
    // nobody has looked at them — see the field's doc comment in
    // ./repository/types and knownGapsState() in ./repository/coverage.
  };
});


export function getPublicRepositoryEntry(slug: string): PublicRepositoryEntry | undefined {
  return PUBLIC_REPOSITORY_ENTRIES.find((entry) => entry.slug === slug);
}


const PERSONAL_LIBRARY_FRAMEWORKS: PublicRepositoryFramework[] = ["Qiskit", "PennyLane", "Cirq"];

/**
 * Select the first published framework variant that the personal Library can
 * store today. OpenQASM and future framework-only records remain visible in
 * the catalog, but are not mislabeled as executable Library imports.
 */
export function getPublicRepositoryLibraryVariant(
  entry: PublicRepositoryEntry,
): PublicRepositoryCodeVariant | undefined {
  const candidates = [entry.framework, ...PERSONAL_LIBRARY_FRAMEWORKS];
  return candidates
    .map((framework) => getPublicRepositoryVariant(entry, framework))
    .find((variant) => PERSONAL_LIBRARY_FRAMEWORKS.includes(variant.framework) && (variant.status === "native" || variant.status === "conversion") && Boolean(variant.code));
}
