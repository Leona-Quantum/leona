// Ordering the browse list by fault-tolerant cost, and refusing to order what
// has no cost (E4).
//
// A pure function rather than a `useMemo` body, because the interesting part of
// it is a *refusal* and a refusal buried in a component is a refusal nobody
// tests. The rule it enforces:
//
//   An entry whose cost this stack cannot state has no position in a cost
//   ranking. Sorting it as 0 puts an unknown cost at the top of a "cheapest
//   first" list. Sorting it as Infinity claims it is the most expensive thing
//   in the catalog. Neither is something the data says, so it comes out of the
//   ordering and is listed separately.
//
// The assumption set does not appear here at all, and that is deliberate: the
// caller holds ONE `CatalogEstimateList`, whose identity covers every row in it,
// so within this function there is nothing to compare across. Making that
// structural is what turns "do not sort across assumption sets" from a rule
// somebody has to remember into one there is no way to break here.
import { isPriced, type RepositoryEstimateSummary } from "./estimate.ts";

export type CostOrder = "catalog" | "cost-asc" | "cost-desc";

export interface CostOrdered<T> {
  /** Entries in the requested order. Identical to the input when order is `catalog`. */
  ordered: T[];
  /** Entries held out of the ranking because they carry no stated cost. */
  unranked: T[];
}

/**
 * Order `entries` by the cost each one's row reports.
 *
 * `costOf` maps an entry to its row, so this stays independent of the entry
 * shape. A missing row is treated exactly like an unpriced one: no cost was
 * stated, whatever the reason.
 *
 * Ties break on a stable key rather than being left to the sort's own
 * stability, so two entries with the same footprint do not swap between renders
 * — 64 of the corpus's entries are Clifford-only 2-qubit circuits that land on
 * identical totals, and a list that reshuffles them on every keystroke reads as
 * a bug.
 */
export function orderByCost<T>(
  entries: readonly T[],
  order: CostOrder,
  costOf: (entry: T) => RepositoryEstimateSummary | undefined,
  keyOf: (entry: T) => string,
): CostOrdered<T> {
  if (order === "catalog") return { ordered: [...entries], unranked: [] };

  const priced: Array<{ entry: T; cost: number }> = [];
  const unranked: T[] = [];
  for (const entry of entries) {
    const row = costOf(entry);
    if (row && isPriced(row.basis) && row.totalPhysicalQubits !== null) {
      priced.push({ entry, cost: row.totalPhysicalQubits });
    } else {
      unranked.push(entry);
    }
  }

  const direction = order === "cost-asc" ? 1 : -1;
  priced.sort(
    (a, b) => (a.cost - b.cost) * direction || keyOf(a.entry).localeCompare(keyOf(b.entry)),
  );
  return { ordered: priced.map((item) => item.entry), unranked };
}
