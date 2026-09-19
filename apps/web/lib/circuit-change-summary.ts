import type { BuilderStep } from "./studio-builder.ts";

/**
 * What changed between two flattened step lists, by gate — the summary shown
 * after "Ask Leona" revises the circuit and a new version loads in place.
 *
 * Ids cannot be compared: the source came back from an agent revision, not an
 * edit that preserved any step's identity, so the only honest comparison is a
 * multiset (bag) diff by gate name — how many of each gate are in the new
 * circuit that weren't in the old one, and vice versa. This intentionally
 * says nothing about which specific gate moved where; it says how many were
 * added and removed, which is what a one-line summary can state truthfully
 * without inventing a correspondence the two circuits don't carry.
 */
export interface CircuitChangeSummary {
  added: Array<{ gate: BuilderStep["gate"]; count: number }>;
  removed: Array<{ gate: BuilderStep["gate"]; count: number }>;
  /** True only when both lists produce the same bag — added and removed are both empty. */
  unchanged: boolean;
}

function gateCounts(steps: readonly BuilderStep[]): Map<BuilderStep["gate"], number> {
  const counts = new Map<BuilderStep["gate"], number>();
  for (const step of steps) counts.set(step.gate, (counts.get(step.gate) ?? 0) + 1);
  return counts;
}

function sortedEntries(counts: Map<BuilderStep["gate"], number>): Array<{ gate: BuilderStep["gate"]; count: number }> {
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([gate, count]) => ({ gate, count }))
    .sort((a, b) => a.gate.localeCompare(b.gate));
}

export function circuitChangeSummary(before: readonly BuilderStep[], after: readonly BuilderStep[]): CircuitChangeSummary {
  const beforeCounts = gateCounts(before);
  const afterCounts = gateCounts(after);
  const gates = new Set([...beforeCounts.keys(), ...afterCounts.keys()]);
  const added = new Map<BuilderStep["gate"], number>();
  const removed = new Map<BuilderStep["gate"], number>();
  for (const gate of gates) {
    const delta = (afterCounts.get(gate) ?? 0) - (beforeCounts.get(gate) ?? 0);
    if (delta > 0) added.set(gate, delta);
    else if (delta < 0) removed.set(gate, -delta);
  }
  const addedEntries = sortedEntries(added);
  const removedEntries = sortedEntries(removed);
  return { added: addedEntries, removed: removedEntries, unchanged: addedEntries.length === 0 && removedEntries.length === 0 };
}
