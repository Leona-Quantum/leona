"""A published catalogue entry's circuit size, derived on read (R1).

Pure, like `catalog_estimate.py` and `catalog_read_model.py`: no sqlalchemy, no
ORM rows, no settings. The route loads the record and calls in here.

**Nothing is stored**, on the same terms and for the same reason as the estimate
beside it: a stored resource profile and a published circuit are two things that
can disagree, and the one a visitor is looking at is the circuit. The roadmap's
R1 sketch proposed computing these at manifest-generation time and storing them
in the record blob; that was written before E4 settled the question, and storing
them would also have grown the browse-list projection — already 911 KB of a 2 MB
Vercel data-cache ceiling — with numbers that cost microseconds to recompute.

**What this is not.** It is not an estimate and it is not carried inside one.
These five numbers are properties of the circuit alone: they do not move when the
hardware assumptions or the synthesis precision do. So there is no assumption-set
identity here and no ordering rule to enforce — the whole listing is rankable by
depth, which is exactly what `CatalogEstimateList` must never allow for cost.

The interesting branch is again the one that produces no numbers. An entry with
no circuit is not a zero-depth circuit, and an entry whose circuit cannot be read
is a data defect rather than a small circuit; both come back with `present=False`
and a reason, so neither can render as a row of zeros.
"""

from __future__ import annotations

from typing import Any

from majorana_contracts import CatalogEntryProfile, CatalogProfileList
from majorana_openqasm.portable import portable_circuit_metrics

_NO_CIRCUIT_REASON = (
    "This entry carries no portable circuit, so there is nothing to measure. "
    "Literature and operator records describe a construction without pinning a "
    "gate sequence; a resource profile needs the sequence."
)


def _absent(slug: str, reason: str) -> CatalogEntryProfile:
    return CatalogEntryProfile(slug=slug, present=False, reason=reason)


def profile_for_record(
    record: dict[str, Any] | None,
    slug: str,
) -> CatalogEntryProfile:
    """Measure one published record's circuit, or say why it cannot be measured.

    Every failure is a *stated* outcome rather than an exception reaching the
    client, matching `estimate_for_record`: on this page a 500 and a refusal look
    the same to a visitor and mean opposite things.

    Unlike the estimate, nothing about the circuit's *contents* can refuse. An
    operation this stack cannot name still has a width and still occupies a
    layer, so it is measured; only a record whose shape cannot be read at all
    comes back absent.
    """
    portable = (record or {}).get("portableCircuit")
    if not isinstance(portable, dict):
        return _absent(slug, _NO_CIRCUIT_REASON)

    try:
        metrics = portable_circuit_metrics(portable)
    except ValueError as exc:
        # A malformed circuit is not an empty one. Say so plainly rather than
        # let a shape problem read as a very small circuit.
        return _absent(slug, f"This entry's circuit could not be read: {exc}")

    return CatalogEntryProfile(
        slug=slug,
        present=True,
        qubits=metrics.qubits,
        depth=metrics.depth,
        gate_count=metrics.gate_count,
        two_qubit_gate_count=metrics.two_qubit_gate_count,
        measurement_count=metrics.measurement_count,
    )


def profile_list_for_records(
    records: list[tuple[str, dict[str, Any] | None]],
) -> CatalogProfileList:
    """Measure a whole listing.

    The same function produces a row here and the object behind the detail page,
    so a list row and the entry it links to cannot disagree about the same
    circuit. There is no projection step because there is nothing to project: a
    profile is already five numbers.
    """
    return CatalogProfileList(
        profiles=[profile_for_record(record, slug) for slug, record in records]
    )
