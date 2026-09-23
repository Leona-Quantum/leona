"""The `qpu_runs.sweep` document: a Studio parameter sweep run on hardware as
one job (ai-ops 349, "parameter sweeps batched into one task where the
provider allows it").

Shaped and versioned the same way `mitigation.py` shapes `qpu_runs.mitigation`
(migration 0066) — a document written in three steps and never rewritten after
the run finishes — but kept in its OWN column (migration 0075) rather than
folded into `mitigation`. `mitigation` is documented, at the ORM and at the
migration, as noise-mitigation inputs: the ZNE opt-in, a readout calibration
snapshot, folded-circuit counts. A parameter sweep is none of those, and
writing it into that column would either need rewriting what `mitigation`
means or leave the name quietly wrong for every reader who trusts it — the
exact "doc comment that stops matching what changed" trap this codebase has
been bitten by before. `sweep` follows the identical shape instead:

- **At submission, by the API**, when the user swept a Studio parameter to
  hardware: `{"version": 1, "parameter_label": ..., "bindings": [{"label":
  ..., "qasm": ...}, ...]}`. The full per-point programs live on the row, not
  the job payload, for the same reason `qasm` itself does — the worker reads
  every attested value from the row and resubmits from it, never from request
  memory.
- **At submit, by the worker**, with the provider job id: each binding's
  transpiled two-qubit gate count, so a sweep's PUBs can be checked against
  each other the way ZNE's folds are.
- **At completion, by the worker**, with `raw_counts`: every binding's raw
  counts, in binding order.

Unlike ZNE's folds, no one binding is privileged — the scale-1 circuit is the
run's own circuit and the others are perturbations of it, but a sweep's ten
points are ten equally-valid measurements. So `counts` here holds EVERY
binding's counts, including the one `raw_counts` already carries, rather than
the "everything but PUB 0" shape `with_folded_counts` uses: a reader zips
`bindings` and `counts` by index with no off-by-one to remember.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

#: Version of the `qpu_runs.sweep` JSON shape (migration 0075). Bumped when a
#: reader would misread an older document; the web refuses a version it does
#: not know rather than guessing at it — same rule as `MITIGATION_RECORD_VERSION`.
SWEEP_RECORD_VERSION = 1


def requested_sweep_record(
    parameter_label: str, bindings: Sequence[Mapping[str, str]]
) -> dict[str, Any]:
    """The `sweep` document a batch submission starts with, written by the API.

    `bindings` is the request's own list of `{"label", "qasm"}` objects, stored
    verbatim: the worker submits each binding's `qasm` exactly as the client
    built it, the same "resubmit from the row" contract `qasm` itself has.
    """
    return {
        "version": SWEEP_RECORD_VERSION,
        "parameter_label": parameter_label,
        "bindings": [{"label": str(b["label"]), "qasm": str(b["qasm"])} for b in bindings],
    }


def sweep_requested(sweep: Mapping[str, Any] | None) -> bool:
    return (
        isinstance(sweep, Mapping)
        and isinstance(sweep.get("bindings"), list)
        and len(sweep["bindings"]) > 0
    )


def binding_qasms(sweep: Mapping[str, Any] | None) -> tuple[str, ...]:
    """Every binding's QASM, in request order, or empty if this is not a sweep."""
    if not sweep_requested(sweep):
        return ()
    return tuple(str(binding["qasm"]) for binding in sweep["bindings"])  # type: ignore[index]


def merged_after_submit(
    stored: Mapping[str, Any] | None, reported: Mapping[str, Any] | None
) -> dict[str, Any] | None:
    """The row's sweep document with what submit reported added to it.

    Same shape as `mitigation.merged_after_submit`: the user's request
    (`parameter_label`, `bindings`) came from the API, and
    `two_qubit_gate_counts` came from the adapter at submit time. None when
    neither side has anything, so a run that never swept leaves the column
    NULL rather than an empty object.
    """
    if not stored and not reported:
        return None
    merged: dict[str, Any] = {"version": SWEEP_RECORD_VERSION}
    merged.update(dict(stored or {}))
    for key, value in dict(reported or {}).items():
        merged[key] = value
    return merged


def with_binding_counts(
    stored: Mapping[str, Any], pub_counts: Sequence[Mapping[str, int] | None] | None
) -> dict[str, Any]:
    """The document with every binding's counts, or the reason they are missing.

    PUB order is binding order, so `counts[i]` is `bindings[i]`'s measured
    result — including index 0, which duplicates `raw_counts` on purpose (see
    the module docstring for why a sweep keeps the full list rather than the
    "everything but the first" shape ZNE's folded counts use).
    """
    document = dict(stored)
    bindings = document.get("bindings") or []
    received = list(pub_counts or [])
    if len(received) >= len(bindings) and all(
        counts and sum(counts.values()) > 0 for counts in received[: len(bindings)]
    ):
        document["counts"] = [dict(counts) for counts in received[: len(bindings)]]  # type: ignore[arg-type]
    else:
        document["error"] = "the provider returned fewer usable counts than bindings were sent"
    return document


__all__ = [
    "SWEEP_RECORD_VERSION",
    "binding_qasms",
    "merged_after_submit",
    "requested_sweep_record",
    "sweep_requested",
    "with_binding_counts",
]
