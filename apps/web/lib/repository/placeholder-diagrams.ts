/**
 * Whether a record's `visualization` is one of the corpus's three stock
 * placeholder diagrams, rather than a diagram drawn for that record.
 *
 * Three content batches each generated the same three-step wire/operation
 * skeleton for every record in the batch, because the batch has no per-record
 * circuit to draw (a literature reference, an operator definition, a method
 * description) and the schema requires *some* `visualization`. Read literally,
 * a "diagram" that says `encode -> transform -> measure` on every one of 90
 * unrelated algorithms is not a circuit for any of them — it is the schema's
 * default answered by three words, and a reader who does not know that reads
 * it as this record's actual gate sequence.
 *
 * **Matching is exact, not heuristic.** This checks the wire names and the
 * operation labels, in order, against the three known signatures — nothing
 * about qubit indices, tone, wire count, or "looks generic". A record with a
 * genuine circuit can share at most a coincidence of wording with one of
 * these, never the whole ordered signature, so this can only ever under-match
 * (miss a placeholder that was authored differently), never over-match a real
 * diagram into a false placeholder. See
 * `apps/web/lib/repository-placeholder-diagrams.test.ts` for the record types
 * this must and must not match, and
 * `scripts/check-placeholder-diagram-census.mjs` for the corpus-wide count
 * this signature set is pinned against.
 *
 * The three sources, as read from the corpus 2026-09-15:
 *
 * 1. Zoo-parity + Classiq-parity literature entries (`zooEntry` /
 *    `classiqEntry` in `entries-zoo-parity.ts` / `entries-classiq-parity.ts`):
 *    `problem / algorithm / readout`, `encode / transform / measure`.
 * 2. Operator concepts (`operatorEntry` in `entries-literature-expansion.ts`):
 *    `definition / mapping / measurement`, `specify / map / group`.
 * 3. VQE method records (`vqeEntry` in `entries-literature-expansion.ts`):
 *    `hybrid objective / quantum circuit / classical update`,
 *    `prepare / measure H / update θ`.
 */

/** The shape this needs from `PublicRepositoryEntry["visualization"]` — no import required for it. */
export interface PlaceholderDiagramSource {
  readonly wires: readonly string[];
  readonly operations: readonly { readonly label: string }[];
}

interface PlaceholderSignature {
  readonly wires: readonly string[];
  readonly operationLabels: readonly string[];
}

const PLACEHOLDER_SIGNATURES: readonly PlaceholderSignature[] = [
  // Zoo parity + Classiq parity (90 records).
  {
    wires: ["problem", "algorithm", "readout"],
    operationLabels: ["encode", "transform", "measure"],
  },
  // Operator concepts (50 records).
  {
    wires: ["definition", "mapping", "measurement"],
    operationLabels: ["specify", "map", "group"],
  },
  // VQE methods (37 records).
  {
    wires: ["hybrid objective", "quantum circuit", "classical update"],
    operationLabels: ["prepare", "measure H", "update θ"],
  },
];

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * True only for a `visualization` whose wires and operation labels, in order,
 * are exactly one of the three known stock signatures above.
 */
export function isPlaceholderDiagram(
  visualization: PlaceholderDiagramSource | null | undefined,
): boolean {
  if (!visualization || !visualization.wires || !visualization.operations) return false;
  const labels = visualization.operations.map((operation) => operation.label);
  return PLACEHOLDER_SIGNATURES.some(
    (signature) =>
      sameStrings(visualization.wires, signature.wires) && sameStrings(labels, signature.operationLabels),
  );
}
