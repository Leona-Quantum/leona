// Validation boundary for the API's resource-profile responses (R1).
//
// Same contract as ./from-catalog and ./estimate: everything crossing this line
// is untrusted JSON, every field the UI reads without a guard is checked here,
// and a payload that fails is dropped rather than rendered half-formed.
//
// The rule enforced is the one the Python contract enforces on the way out:
// `present` and the presence of the five numbers agree, or there is no profile.
// A payload carrying `present: false` and a depth is not a partially-good
// profile to salvage — it is a disagreement between the two halves of the
// feature, and the safe reading of a disagreement is silence.
//
// **No assumption set here, and its absence is the feature.** A cost is only
// comparable within one set, which is why `parseEstimateList` will not return a
// listing without one. A profile is a property of the circuit: it does not move
// when the hardware or the synthesis precision does, so the whole listing is
// rankable unconditionally and there is nothing to check before sorting.

export interface RepositoryProfile {
  slug: string;
  /** False when the entry carries no portable circuit, or one that could not be read. */
  present: boolean;
  /** Why there is no profile. Non-null exactly when `present` is false. */
  reason: string | null;
  /** Null on every field exactly when `present` is false — never 0, which is a size. */
  qubits: number | null;
  depth: number | null;
  gateCount: number | null;
  twoQubitGateCount: number | null;
  measurementCount: number | null;
}

export interface RepositoryProfileList {
  profiles: RepositoryProfile[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A non-negative integer, or null.
 *
 * Stricter than the estimate parser's `num`, and deliberately: these five are
 * counts. A fractional depth or a negative gate count is not a small error to
 * round — it is a producer this parser has never met, and every one of those
 * values reaches `toLocaleString` and renders as something.
 */
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function parseProfile(payload: unknown): RepositoryProfile | null {
  if (!isRecord(payload)) return null;
  const slug = nonEmptyString(payload.slug);
  if (slug === null || typeof payload.present !== "boolean") return null;

  const reason = nonEmptyString(payload.reason);
  const qubits = count(payload.qubits);
  const depth = count(payload.depth);
  const gateCount = count(payload.gate_count);
  const twoQubitGateCount = count(payload.two_qubit_gate_count);
  const measurementCount = count(payload.measurement_count);
  const numbers = [qubits, depth, gateCount, twoQubitGateCount, measurementCount];

  if (payload.present) {
    // All five, or none of it. A partial profile would render a table with a
    // blank cell where a measurement belongs, which reads as "zero".
    if (numbers.some((value) => value === null) || reason !== null) return null;
    // A real circuit occupies at least one qubit; the producer's own contract
    // says so (`ge=1`). A zero here means something upstream measured nothing
    // and reported success.
    if (qubits === 0) return null;
    // Relationships the five numbers cannot violate and still describe a
    // circuit. Checked here rather than field by field because each value is
    // individually plausible — `gate_count: 1` beside `two_qubit_gate_count: 2`
    // passes every range check and is still not a thing that exists, and the
    // browse list would happily rank it.
    //
    // Not mirrored in the Python contract on purpose: there the five numbers are
    // computed by one function from one step list, so a validator would be
    // checking that arithmetic against itself. Here they arrive as JSON from
    // across a network, which is a different question.
    if (twoQubitGateCount! > gateCount!) return null;
    // Each gate advances the ASAP layering by at most one, and the terminal
    // measurement adds at most one more.
    if (depth! > gateCount! + 1) return null;
    // The portable model's measurement is all-or-nothing over every qubit —
    // there is no per-qubit and no mid-circuit measurement in it — so the count
    // is either none or all of them. Anything between means the producer is not
    // the one this parser was written against.
    if (measurementCount !== 0 && measurementCount !== qubits) return null;
  } else if (numbers.some((value) => value !== null) || reason === null) {
    return null;
  }

  return {
    slug,
    present: payload.present,
    reason,
    qubits,
    depth,
    gateCount,
    twoQubitGateCount,
    measurementCount,
  };
}

export function parseProfileList(payload: unknown): RepositoryProfileList | null {
  if (!isRecord(payload) || !Array.isArray(payload.profiles)) return null;
  const profiles = payload.profiles
    .map(parseProfile)
    .filter((entry): entry is RepositoryProfile => entry !== null);
  return { profiles };
}

/** Index a listing by slug, so a browse row is one lookup rather than a scan. */
export function profilesBySlug(list: RepositoryProfileList | null): Map<string, RepositoryProfile> {
  const index = new Map<string, RepositoryProfile>();
  for (const profile of list?.profiles ?? []) index.set(profile.slug, profile);
  return index;
}
