/**
 * How a rotation angle is drawn under its gate.
 *
 * `BuilderStep.param` is a free-form string, and it reaches the diagram from
 * three places that agree on nothing: the Studio builder (whatever the user
 * typed, e.g. `pi/2`), generated framework source, and QASM reconstruction —
 * where an angle arrives as however many digits the exporter printed, commonly
 * `0.78539816339744830961`. The diagram draws it as a centred SVG `<text>` in a
 * 52px column with no clipping, so a long angle simply ran over the gates on
 * either side. Rounding at parse time is not an option: that string is spliced
 * verbatim into every framework's generated code, so the *label* is the only
 * safe place to shorten it.
 *
 * Symbolic angles are left alone apart from the existing cosmetic
 * substitutions. `pi/2` is already short, already exact, and already what the
 * user typed; rewriting it as 1.571 would be strictly worse.
 *
 * A numeric angle that IS an exact multiple of π/16 is drawn as that multiple
 * rather than as a decimal, because it is both shorter and exact — `3π/4`, not
 * `2.356`. This matters most for generated ladders: the QPE controlled-power
 * block computes its angles in radians, so opening it listed
 * `CP(2.356194490192345)`, `CP(4.71238898038469)`, `CP(9.42477796076938)`,
 * which are 3π/4, 3π/2 and 3π — a doubling ladder, the entire point of the
 * block, and unreadable as printed. A QASM-imported `0.78539816339744830961`
 * gets the same treatment and becomes `π/4`.
 *
 * This is the ONE place an angle is turned into a label. A second formatter
 * briefly existed beside it in `atlas-worked-example-steps.ts`, added without
 * checking for this one, and the two disagreed: the Atlas figure drew
 * `RY(pi/3)` where Studio's diagram drew `RY(π/3)` for the same step. Any new
 * surface that draws an angle calls this.
 */

/** Digits kept after the point when an angle is drawn as a decimal. */
export const GATE_PARAM_DECIMALS = 3;

/** Hard ceiling on the drawn label, symbolic angles included. */
export const GATE_PARAM_MAX_CHARS = 9;

export function formatGateParam(param: string): string {
  const trimmed = param.trim();
  if (!trimmed) return "";
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(trimmed)) {
    const asPi = piMultiple(numeric);
    if (asPi !== null) return asPi;
    // `parseFloat` of the rounded string drops trailing zeros, so 0.5 stays
    // "0.5" rather than becoming "0.500" — three decimals is a ceiling on
    // precision, not a demand for it.
    const rounded = parseFloat(numeric.toFixed(GATE_PARAM_DECIMALS));
    // Below the rounding floor, report the magnitude instead of a row of zeros:
    // "0.000" reads as an angle of zero, which is a different circuit.
    if (rounded === 0 && numeric !== 0) return numeric > 0 ? "≈0⁺" : "≈0⁻";
    return String(rounded);
  }
  const symbolic = trimmed.replaceAll("pi", "π").replaceAll("*", "");
  return symbolic.length > GATE_PARAM_MAX_CHARS
    ? `${symbolic.slice(0, GATE_PARAM_MAX_CHARS - 1)}…`
    : symbolic;
}

/**
 * A number as an exact multiple of π, or null when it is not one.
 *
 * Only exact multiples of π/16 qualify. Anything else falls through to the
 * decimal path rather than being forced into a fraction it is not: a
 * wrong-looking fraction is worse than an honest decimal, and a reader has no
 * way to tell an approximation from an exact value once it is printed as one.
 */
function piMultiple(value: number): string | null {
  if (value === 0) return null; // "0" is already the shortest exact label.
  const sixteenths = (value / Math.PI) * 16;
  const rounded = Math.round(sixteenths);
  if (rounded === 0 || Math.abs(sixteenths - rounded) > 1e-9) return null;
  const divisor = greatestCommonDivisor(Math.abs(rounded), 16);
  const top = rounded / divisor;
  const bottom = 16 / divisor;
  const numerator = top === 1 ? "π" : top === -1 ? "-π" : `${top}π`;
  return bottom === 1 ? numerator : `${numerator}/${bottom}`;
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}
