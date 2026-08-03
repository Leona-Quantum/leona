/** Canonical numeric/π angle accepted by the visual circuit round-trip.
 *
 * Framework observers commonly emit bound floats in scientific notation and
 * QASM commonly emits signed π fractions. Keeping one parser prevents the Code
 * parser, interchange reader, and local draft validator from disagreeing about
 * whether the same rotation is editable.
 */
const GATE_ANGLE = /^-?(?:(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?|(?:(?:\d+(?:\.\d+)?)\*)?pi(?:\/(?:\d+(?:\.\d+)?))?)$/i;

export function parseGateAngle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replaceAll(/\s+/g, "");
  if (!GATE_ANGLE.test(cleaned)) return null;
  const denominator = /\/(\d+(?:\.\d+)?)$/i.exec(cleaned);
  return denominator && Number(denominator[1]) === 0 ? null : cleaned;
}

export function isGateAngle(value: unknown): value is string {
  return parseGateAngle(value) !== null;
}
