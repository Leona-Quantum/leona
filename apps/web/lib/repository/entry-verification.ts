import type { PublicRepositoryEntry, PublicRepositoryListEntry } from "./types";
import { strongestTier, type VerificationMethodId, type VerificationTier } from "./verification";

/**
 * How an entry's verification methods are decided — split out of
 * `lib/public-repository.ts` so the browser can reach it without the catalog.
 *
 * ## Why this file exists at all
 *
 * These functions are pure over the entry object handed to them. They never
 * read the corpus. But they used to live in `public-repository.ts`, which
 * value-imports all nine `entries-*.ts` files, and `repository-browser.tsx` is
 * a `"use client"` component. One value import of `entryVerificationMethods`
 * therefore dragged **the entire Atlas catalog into the client bundle** — every
 * slug, title, gate set and citation of ~370 records, shipped to every visitor
 * of `/repository` so the page could classify the rows the server had already
 * sent it.
 *
 * Measured on production before the split: `/repository` shipped **686 KB** of
 * JavaScript against the landing page's 217 KB, and **454 KB of that was one
 * chunk** — 1.6 MB unpacked, almost exactly the combined size of the entry
 * sources. Bundlers cannot tree-shake it away, because `public-repository.ts`
 * builds derived indexes from those arrays at module scope; the work is real,
 * it just has no business happening in a browser.
 *
 * That cost is invisible on a fast machine — it was 9 ms of transfer here — and
 * it is not invisible on a slow one, where the bill is parse and compile on the
 * main thread rather than bytes on the wire. The owner reported the site timing
 * out on someone else's laptop and guessed the Atlas was the reason
 * (ai-ops issue 109). This is a measured part of that.
 *
 * ## The rule this file encodes
 *
 * **A `"use client"` module must not import from `lib/public-repository.ts`.**
 * It is a barrel over the corpus, and reaching through it for one helper costs
 * the whole corpus. Import the leaf instead — this file, `./types`, or
 * `./verification`. `client-catalog-leak.test.ts` enforces it, because nothing
 * else does: the mistake type-checks, passes every test, renders correctly, and
 * is only visible as a number in a bundle nobody was measuring.
 */

/**
 * Per-slug corrections where the keyword derivation below misreads the prose.
 * Audited against each entry's own verification text on 2026-07-16: "documented"
 * or "reviewed" records must not claim simulation-grade methods, and toy-circuit
 * checks are small-instance evidence, not exact verification.
 */
const VERIFICATION_OVERRIDES: Record<string, VerificationMethodId[]> = {
  "ghz-state-pennylane": ["exact_simulation", "invariant_checks"],
  "grover-unstructured-search": ["small_instance", "construction", "research_paper"],
  "shor-period-finding": ["community_submission", "construction", "research_paper"],
  "amplitude-estimation": ["small_instance", "construction", "research_paper"],
  "vqe-ground-state-energy": ["small_instance", "invariant_checks", "research_paper"],
  "quantum-phase-estimation": ["small_instance", "construction", "research_paper"],
  "hhl-linear-systems": ["community_submission", "construction", "research_paper"],
  "quantum-kernel-svm": ["community_submission", "small_instance", "invariant_checks", "research_paper"],
  "quantum-teleportation": ["construction", "research_paper"],
  "shor-code-error-correction": ["construction", "research_paper"],
  "surface-code-memory": ["community_submission", "construction", "research_paper"],
  "swap-gate": ["truth_table", "textbook_citation"],
  "deutsch-jozsa-cirq": ["construction", "textbook_citation"],
  "bernstein-vazirani-qiskit": ["construction", "textbook_citation"],
  "superdense-coding-circuit": ["construction", "textbook_citation"],
};

/**
 * Deterministic classification for entries that predate explicit
 * verificationMethods. The rules key off the entry's own verification prose and
 * provenance; per-slug corrections belong in VERIFICATION_OVERRIDES, not here.
 * scripts/check-repository-data.mjs prints the resulting slug → methods table so
 * the classification stays reviewable.
 */
export function deriveVerificationMethods(entry: PublicRepositoryEntry): VerificationMethodId[] {
  if (entry.verificationMethods?.length) return entry.verificationMethods;
  const override = VERIFICATION_OVERRIDES[entry.slug];
  if (override) return override;

  const text = `${entry.verification} ${entry.verificationDetails.method} ${entry.verificationDetails.result}`.toLowerCase();
  const methods = new Set<VerificationMethodId>();

  if (entry.status === "community_review" || entry.source.kind === "community_submission") {
    methods.add("community_submission");
  }
  if (/unitary|matrix/.test(text)) methods.add("unitary_equivalence");
  if (/truth[ -]table|basis[ -]state action|reversible classical/.test(text)) methods.add("truth_table");
  if (/statevector|state vector|exact state|exact simulation|exact diag|amplitudes match/.test(text)) {
    methods.add("exact_simulation");
  }
  if (/stabilizer/.test(text)) methods.add("stabilizer_simulation");
  if (/analytic|identity|closed form|derivation/.test(text)) methods.add("direct_math");
  if (/statistical|counts|tvd|shots|sampled/.test(text)) methods.add("statistical_counts");
  if (/small[ -]instance|small sizes|tractable size/.test(text)) methods.add("small_instance");
  if (/sub-block|subblock|module|oracle in isolation/.test(text)) methods.add("subblock");
  if (/echo|inverse test|uncompute/.test(text)) methods.add("echo_inverse");
  if (/invariant|contract|conservation|symmetry check|parse/.test(text)) methods.add("invariant_checks");
  if (/construction|specification|spec-aligned|reference implementation/.test(text)) methods.add("construction");
  if (entry.source.kind === "verified_run") {
    methods.add("statistical_counts");
    methods.add("invariant_checks");
  }
  if (entry.literature?.length) methods.add("research_paper");
  if (!methods.size || (methods.size === 1 && methods.has("community_submission"))) {
    // Every curated legacy record cites an official spec/vendor source.
    methods.add("textbook_citation");
  }
  return [...methods];
}

/**
 * The list projection carries `verificationMethods` already, because every
 * published record carries it — so the narrowing below is a guard, not a code
 * path with a behaviour to preserve. It is written as a type narrowing rather
 * than a cast so that widening the projection later cannot silently reintroduce
 * a call to derive on a record that lacks the fields it reads.
 */
export function entryVerificationMethods(
  entry: PublicRepositoryEntry | PublicRepositoryListEntry,
): VerificationMethodId[] {
  if (entry.verificationMethods?.length) return entry.verificationMethods;
  if (!("verificationDetails" in entry)) return [];
  return deriveVerificationMethods(entry);
}

export function entryVerificationTier(entry: PublicRepositoryEntry): VerificationTier {
  return strongestTier(entryVerificationMethods(entry));
}
