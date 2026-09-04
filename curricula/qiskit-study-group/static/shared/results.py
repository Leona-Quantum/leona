"""Pure helpers for reading Qiskit `counts` dictionaries.

A `StatevectorSampler` result gives you a `counts` dict: bitstrings mapped to
how many of your shots landed on them. These helpers turn that dict into
probabilities, pick out the outcomes that matter, and check whether an
observed count falls in the band you predicted — nothing here imports
Qiskit, so you can test it without building a circuit first.
"""

from __future__ import annotations


def probabilities(counts: dict[str, int], shots: int) -> dict[str, float]:
    """Convert a `counts` dict into a probability for each outcome.

    `shots` is passed separately rather than summed from `counts` so the
    caller can pass the shot count they asked the sampler for, even when an
    outcome with zero occurrences is missing from `counts` entirely.

    Raises `ValueError` if `shots` is not positive.
    """
    if shots <= 0:
        raise ValueError(f"shots must be positive, got {shots}")
    return {outcome: count / shots for outcome, count in counts.items()}


def top_outcomes(counts: dict[str, int], k: int) -> list[tuple[str, int]]:
    """Return the `k` most frequent outcomes as `(bitstring, count)` pairs.

    Ties break by bitstring, ascending, so the result is deterministic
    regardless of the dict's insertion order. Returns fewer than `k` pairs
    if `counts` has fewer than `k` distinct outcomes.
    """
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return ranked[:k]


def within_band(count: int, shots: int, p: float, tolerance: float) -> bool:
    """Check whether an observed `count` is within `tolerance` of `p * shots`.

    This is the checkpoint helper: sampling fluctuates, so a checkpoint
    should assert a band around the expected count, never an exact number.
    `tolerance` is a fraction of `shots` (for example `0.1` for +/-10% of
    the shot count), not a fraction of the expected count.
    """
    expected = p * shots
    margin = tolerance * shots
    return abs(count - expected) <= margin
