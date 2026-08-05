// Ordering the browse list by a derived number, and refusing to order what has
// none (R1, extending E4's rule to circuit structure).
//
// One entry point rather than two, because the alternative was a dispatch in the
// component body deciding which of `orderByCost` and a profile sort to call —
// and the interesting half of both is a *refusal*, which is exactly the thing
// that must not live where nobody exercises it.
//
// The rule is E4's, unchanged and now applied to three more numbers:
//
//   An entry whose depth this stack cannot state has no position in a depth
//   ranking. Sorting it as 0 puts an unmeasured circuit at the top of a
//   "shallowest first" list. Sorting it as Infinity claims it is the deepest
//   thing in the catalog. Neither is something the data says, so it comes out
//   of the ordering and is listed separately.
//
// **Why cost needs an assumption set here and structure does not.** A cost is
// comparable only within one set, which `orderByCost` makes structural by taking
// a single `CatalogEstimateList`. Depth, width and two-qubit count are properties
// of the circuit: they do not move when the hardware or the synthesis precision
// does. So there is nothing to compare across, and no identity to check before
// ranking — a difference worth stating, because "these two sorts work the same
// way" is the assumption that would eventually put a cost sort back on a mixed
// listing.
import { orderByCost, type CostOrder, type CostOrdered } from "./estimate-order.ts";
import type { RepositoryEstimateSummary } from "./estimate.ts";
import type { RepositoryProfile } from "./profile.ts";

/** Orders that rank on the derived resource profile rather than on cost. */
export const PROFILE_ORDERS = [
  "qubits-asc",
  "qubits-desc",
  "depth-asc",
  "depth-desc",
  "two-qubit-asc",
  "two-qubit-desc",
] as const;

export type ProfileOrder = (typeof PROFILE_ORDERS)[number];
export type BrowseOrder = CostOrder | ProfileOrder;

export type { CostOrdered };

/** Which measurement each profile order reads. Exhaustive by construction. */
const PROFILE_METRIC: Record<ProfileOrder, (profile: RepositoryProfile) => number | null> = {
  "qubits-asc": (profile) => profile.qubits,
  "qubits-desc": (profile) => profile.qubits,
  "depth-asc": (profile) => profile.depth,
  "depth-desc": (profile) => profile.depth,
  "two-qubit-asc": (profile) => profile.twoQubitGateCount,
  "two-qubit-desc": (profile) => profile.twoQubitGateCount,
};

export function isProfileOrder(order: BrowseOrder): order is ProfileOrder {
  return (PROFILE_ORDERS as readonly string[]).includes(order);
}

export interface BrowseOrderInputs<T> {
  /** The entry's cost row, when the API supplied a listing. */
  costOf: (entry: T) => RepositoryEstimateSummary | undefined;
  /** The entry's derived profile, when the API supplied one. */
  profileOf: (entry: T) => RepositoryProfile | undefined;
  /** Stable tie-break key. */
  keyOf: (entry: T) => string;
}

/**
 * Order `entries` by whichever derived number `order` names.
 *
 * Ties break on a stable key rather than on the sort's own stability, for the
 * reason E4 found: 64 of the corpus's entries are Clifford-only 2-qubit circuits
 * that land on identical numbers, and a list that reshuffles them on every
 * keystroke reads as a bug. That matters more here than it did for cost —
 * `depth` collides far harder than a physical qubit count does.
 */
export function orderEntries<T>(
  entries: readonly T[],
  order: BrowseOrder,
  { costOf, profileOf, keyOf }: BrowseOrderInputs<T>,
): CostOrdered<T> {
  if (!isProfileOrder(order)) return orderByCost(entries, order, costOf, keyOf);

  const metricOf = PROFILE_METRIC[order];
  const measured: Array<{ entry: T; metric: number }> = [];
  const unranked: T[] = [];
  for (const entry of entries) {
    const profile = profileOf(entry);
    // `present` and a number must BOTH hold. A profile that says present and
    // carries no depth cannot reach here — the parser drops it — but reading
    // only one of the two would make this function depend on that, and the
    // parser is a different file with a different reason to change.
    const metric = profile?.present ? metricOf(profile) : null;
    if (metric === null || metric === undefined) unranked.push(entry);
    else measured.push({ entry, metric });
  }

  const direction = order.endsWith("-desc") ? -1 : 1;
  measured.sort(
    (a, b) => (a.metric - b.metric) * direction || keyOf(a.entry).localeCompare(keyOf(b.entry)),
  );
  return { ordered: measured.map((item) => item.entry), unranked };
}

/**
 * Keep only entries whose circuit was measured.
 *
 * The one filter R1 ships, and the reason it is this one: `present` is a
 * distinction the *data* makes — 163 of 283 published entries are literature and
 * operator records that pin no gate sequence — so it needs no boundary anybody
 * had to choose. A "depth under N" control would need an N, and a number picked
 * to make the buckets look even is a claim about the corpus dressed as a filter.
 */
export function withCircuitOnly<T>(
  entries: readonly T[],
  profileOf: (entry: T) => RepositoryProfile | undefined,
): T[] {
  return entries.filter((entry) => profileOf(entry)?.present === true);
}
