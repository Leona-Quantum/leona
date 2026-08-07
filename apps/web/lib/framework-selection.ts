// The composer's framework picker. The SET comes from the contract; the labels
// and the order are ours, and each is arranged so it cannot silently omit one.
import { FRAMEWORK_VALUES } from "@majorana/contracts-gen/enums";

export type ComposerFramework = (typeof FRAMEWORK_VALUES)[number];

/**
 * Display names. Not derivable — the contract says `pennylane` and the product
 * says "PennyLane" — so they are written here, but as a `Record` keyed by the
 * contract type. A framework added to `Framework` with no label here is a
 * COMPILE error, which is the whole point: the previous hand-written array
 * would simply not have offered it, and an absent option in a dropdown is
 * invisible.
 */
const FRAMEWORK_LABELS: Record<ComposerFramework, string> = {
  qiskit: "Qiskit",
  cirq: "Cirq",
  pennylane: "PennyLane",
  braket: "Amazon Braket",
  qibo: "Qibo",
  qulacs: "Qulacs",
};

/**
 * Display order, which is deliberately NOT the contract's order.
 *
 * `Framework` declares qiskit, pennylane, cirq, … and this picker has always
 * shown qiskit, cirq, pennylane, …. Deriving the order from the contract would
 * have reordered a live dropdown as a side effect of a refactor, which is the
 * kind of change nobody asked for and nobody reviews.
 *
 * A framework missing from this list is not dropped — `orderedFrameworks` appends
 * anything it does not name. So the worst case of forgetting to update it is a
 * new framework appearing last, never a new framework not appearing.
 */
const DISPLAY_ORDER: readonly string[] = [
  "qiskit",
  "cirq",
  "pennylane",
  "braket",
  "qibo",
  "qulacs",
];

function orderedFrameworks(): readonly ComposerFramework[] {
  const ranked = [...FRAMEWORK_VALUES];
  ranked.sort((left, right) => {
    const l = DISPLAY_ORDER.indexOf(left);
    const r = DISPLAY_ORDER.indexOf(right);
    // Unnamed frameworks sort after every named one, keeping the contract's
    // relative order among themselves.
    return (l === -1 ? DISPLAY_ORDER.length : l) - (r === -1 ? DISPLAY_ORDER.length : r);
  });
  return ranked;
}

export const COMPOSER_FRAMEWORKS: readonly { key: ComposerFramework; label: string }[] =
  orderedFrameworks().map((key) => ({ key, label: FRAMEWORK_LABELS[key] }));

export type ArtifactFrameworkHydration = "checking" | "idle" | "loading" | "ready" | "error";

export function canSubmitAfterArtifactHydration(state: ArtifactFrameworkHydration): boolean {
  return state === "idle" || state === "ready";
}

export function frameworkValue(value: string): ComposerFramework | null {
  const normalized = value.trim().toLowerCase().replaceAll(/[\s._-]+/g, "");
  return COMPOSER_FRAMEWORKS.find((framework) => (
    framework.key.replaceAll(/[._-]+/g, "") === normalized
    || framework.label.toLowerCase().replaceAll(/[\s._-]+/g, "") === normalized
  ))?.key ?? null;
}

export function hydrateArtifactFramework(
  current: ComposerFramework,
  selectorTouched: boolean,
  artifactFramework: string,
): { framework: ComposerFramework; error: string | null } {
  const parsed = frameworkValue(artifactFramework);
  if (parsed === null) {
    return {
      framework: current,
      error: `Unsupported artifact framework: ${artifactFramework}`,
    };
  }
  return { framework: selectorTouched ? current : parsed, error: null };
}

export function hydrateConversationFramework(
  current: ComposerFramework,
  selectorTouched: boolean,
  persistedFramework: string | null | undefined,
): ComposerFramework {
  const parsed = persistedFramework ? frameworkValue(persistedFramework) : null;
  return !selectorTouched && parsed ? parsed : current;
}
