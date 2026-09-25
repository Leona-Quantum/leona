"""JavaScript's arithmetic, where Python's differs, for the formulas ported from TS.

The planner's numbers are evaluated in `apps/web/lib/workflow-planner/costs.ts`,
where every number is an IEEE double and nothing raises. Python differs in ways
that would change an answer rather than just its last bit:

- `math.ceil`/`math.floor` return exact `int`s, so `2 ** ceil(x)` becomes exact
  integer arithmetic that JavaScript would round (and `N - M + 1` at N = 1e30
  keeps a 1 JavaScript drops). Here they return floats, and every value in the
  port is a float from the moment it arrives.
- `round()` rounds half to even; `Math.round` rounds half up.
- `math.log2(0)`, `math.asin(2)`, `1.0 / 0.0` and `2.0 ** 2000` raise where
  JavaScript answers -Infinity, NaN, Infinity and Infinity.

What cannot be matched from here: V8 computes `Math.log2`, `Math.log`,
`Math.asin`, `Math.sin` and `**` with its own ports of fdlibm, and Python calls the
platform's libm. Both are within about one unit in the last place of the true
value, so the two can differ in the last bit. The parity test's tolerance is
sized for exactly that (see its module docstring).
"""

from __future__ import annotations

import math

PI = math.pi
SQRT2 = math.sqrt(2.0)
NAN = math.nan
INF = math.inf


def isfinite(x: float | None) -> bool:
    return x is not None and math.isfinite(x)


def ceil(x: float) -> float:
    """`Math.ceil`: a float, and ±Infinity/NaN pass through."""
    return float(math.ceil(x)) if math.isfinite(x) else x


def floor(x: float) -> float:
    """`Math.floor`: a float, and ±Infinity/NaN pass through."""
    return float(math.floor(x)) if math.isfinite(x) else x


def js_round(x: float) -> float:
    """`Math.round`: halves go up (towards +Infinity), not to even.

    `x - floor(x)` is exact for every double below 2**52, and above that every
    double is already an integer, so this never meets the `floor(x + 0.5)` trap
    (0.49999999999999994 + 0.5 rounds to 1.0).
    """
    if not math.isfinite(x):
        return x
    whole = math.floor(x)
    return float(whole + 1 if x - whole >= 0.5 else whole)


def log2(x: float) -> float:
    if math.isnan(x) or x < 0:
        return NAN
    if x == 0:
        return -INF
    if x == INF:
        return INF
    return math.log2(x)


def log(x: float) -> float:
    if math.isnan(x) or x < 0:
        return NAN
    if x == 0:
        return -INF
    if x == INF:
        return INF
    return math.log(x)


def sqrt(x: float) -> float:
    if math.isnan(x) or x < 0:
        return NAN
    return math.sqrt(x)


def asin(x: float) -> float:
    if math.isnan(x) or x < -1 or x > 1:
        return NAN
    return math.asin(x)


def sin(x: float) -> float:
    return math.sin(x) if math.isfinite(x) else NAN


def power(base: float, exponent: float) -> float:
    """`base ** exponent`: overflow is Infinity, not OverflowError."""
    try:
        return math.pow(base, exponent)
    except OverflowError:
        return INF if base > 0 or float(exponent).is_integer() and exponent % 2 == 0 else -INF
    except ValueError:
        return NAN


def js_max(*values: float) -> float:
    """`Math.max`: NaN if any argument is NaN."""
    if any(math.isnan(v) for v in values):
        return NAN
    return max(values)


def number_string(x: float) -> str:
    """`String(x)` for a number, as a formula template needs it.

    Exact for integers below 1e21, which is every value a template takes today
    (Gidney 2025's `Table 5, n = {bits}`). Other values fall back to Python's
    shortest round-trip form with JavaScript's exponent spelling; the parity grid
    would show the day a template needs more than that.
    """
    if math.isfinite(x) and x.is_integer() and abs(x) < 1e21:
        return str(int(x))
    if math.isnan(x):
        return "NaN"
    if math.isinf(x):
        return "Infinity" if x > 0 else "-Infinity"
    text = repr(x)
    if "e" in text:
        mantissa, exponent = text.split("e")
        sign = "-" if exponent.startswith("-") else "+"
        text = f"{mantissa}e{sign}{int(exponent.lstrip('+-'))}"
    return text
