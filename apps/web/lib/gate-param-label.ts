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
