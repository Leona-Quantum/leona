"""R1 — the derived-on-read resource profile, and what it refuses to state.

The arithmetic itself is tested where it lives (`packages/py/openqasm`, against
Qiskit over the published corpus). What is tested here is the product boundary:
which entries get numbers, which get a stated reason instead, and that the two
can never both appear.
"""

import json
import pathlib

import pytest
from majorana_api.catalog_profile import profile_for_record, profile_list_for_records
from pydantic import ValidationError

from majorana_contracts import CatalogEntryProfile


def _gate(name: str, *qubits: int, param: str | None = None) -> dict:
    step: dict = {"gate": name, "qubits": list(qubits)}
    if param is not None:
        step["param"] = param
    return step


def _record(*steps: dict, qubits: int = 2, measure: bool = False) -> dict:
    return {"portableCircuit": {"qubitCount": qubits, "steps": list(steps), "measure": measure}}


def _manifest_records() -> list[dict]:
    path = (
        pathlib.Path(__file__).resolve().parents[3] / "services/api/catalog_bootstrap/manifest.json"
    )
    if not path.exists():
        pytest.skip(f"pinned catalog manifest not present at {path}")
    manifest = json.loads(path.read_text())
    records = []
    for item in manifest.get("items", []):
        if item.get("source_blob_encoding") != "canonical-json-utf8":
            continue
        parsed = json.loads(item["source_blob"])
        if isinstance(parsed, dict):
            records.append(parsed)
    return records


def test_a_published_circuit_is_measured():
    profile = profile_for_record(_record(_gate("h", 0), _gate("cx", 0, 1), measure=True), "bell")

    assert profile.present
    assert profile.reason is None
    assert (profile.qubits, profile.gate_count, profile.two_qubit_gate_count) == (2, 2, 1)
    assert profile.measurement_count == 2
    # h, cx, and the terminal measurement layer.
    assert profile.depth == 3


def test_an_entry_with_no_circuit_states_that_rather_than_measuring_zero():
    """The distinction the whole `present` flag exists for. 163 of the 283
    published entries are literature and operator records with no gate sequence;
    a row of five zeros would state a measurement nobody took, and would sort to
    the top of a "shallowest first" list."""
    profile = profile_for_record({"slug": "amplitude-amplification"}, "amplitude-amplification")

    assert not profile.present
    assert profile.qubits is None and profile.depth is None
    assert "no portable circuit" in (profile.reason or "")


def test_a_record_that_is_not_a_dict_at_all_is_absent_not_an_error():
    """`record=None` is a real state (a non-manifest source). It must not 500."""
    assert not profile_for_record(None, "x").present


def test_a_malformed_circuit_says_so_rather_than_reading_as_a_tiny_one():
    """A shape problem and a small circuit are opposite findings. The reason
    names the parse failure so it reads as a data defect, not a physics result."""
    profile = profile_for_record(
        {"portableCircuit": {"qubitCount": 2, "steps": [{"gate": "h", "qubits": [-1]}]}},
        "broken",
    )

    assert not profile.present
    assert "could not be read" in (profile.reason or "")
    assert profile.gate_count is None


def test_an_operation_this_stack_cannot_name_is_still_measured():
    """The difference from the estimate beside it. An unnameable operation makes
    a *magic-state cost* not exist; the circuit still has a width and a depth,
    and refusing to state them would import a rule from the wrong feature."""
    profile = profile_for_record(_record(_gate("h", 0), _gate("mystery", 0, 1)), "odd")

    assert profile.present
    assert profile.gate_count == 2
    assert profile.two_qubit_gate_count == 1


def test_a_profile_cannot_carry_both_numbers_and_a_reason():
    """Enforced by the contract, not by this module, because it is the invariant
    the UI branches on."""
    with pytest.raises(ValidationError):
        CatalogEntryProfile(slug="x", present=True, reason="nope", qubits=1, depth=0,
                            gate_count=0, two_qubit_gate_count=0, measurement_count=0)  # fmt: skip
    with pytest.raises(ValidationError):
        CatalogEntryProfile(slug="x", present=False, reason="none", qubits=2)


def test_the_list_and_the_detail_agree_for_every_published_entry():
    """One function produces both, so this cannot drift — asserted anyway,
    because "the same function produces both" is a claim about code that a
    refactor can quietly falsify."""
    records = _manifest_records()
    listing = profile_list_for_records(
        [(str(record.get("slug", "?")), record) for record in records]
    )

    assert len(listing.profiles) == len(records)
    for record, row in zip(records, listing.profiles, strict=True):
        assert row == profile_for_record(record, str(record.get("slug", "?")))


def test_every_published_entry_either_measures_or_says_why():
    """No entry may come back present with a missing number, and none may come
    back absent without a reason. Over the real corpus, not a fixture."""
    records = _manifest_records()
    assert records, "pinned manifest holds no records"

    measured = 0
    for record in records:
        slug = str(record.get("slug", "?"))
        profile = profile_for_record(record, slug)
        if profile.present:
            measured += 1
            assert profile.qubits is not None and profile.qubits >= 1, slug
            assert profile.depth is not None, slug
            # A profile that is present but unreadable is the failure this
            # catches: the contract already refuses it, so a defect would arrive
            # as a ValidationError above rather than as a bad number here.
        else:
            assert profile.reason, slug

    # The session-70 corpus measurement: 120 entries carry a portable circuit.
    # A floor, not an equality, so publishing more entries does not fail the
    # build — the point is that the measuring branch is exercised by real data.
    # A floor of 100 until 2026-08-16. The entries this can measure are exactly
    # the ones carrying a portable circuit, which were the 120 width-family
    # members; the owner's ruling on ai-ops issue 116 cut those to 30, so the
    # honest floor is 30 rather than a number the corpus can no longer reach.
    # This is a real reduction in measured coverage, not a relaxed test: the
    # circuits that stopped being measured are the six interpolated widths per
    # family, each derivable from the two that remain.
    assert measured >= 30, f"only {measured} published entries could be measured"


def test_the_corpus_profile_matches_the_shape_the_cost_reports():
    """The two panels a visitor sees side by side. `qubits` here and
    `logical_qubits` there are the same number by construction — the shared
    reader — and this holds them to it over the published corpus rather than
    over a fixture chosen to agree."""
    from majorana_openqasm import portable_circuit_cost

    for record in _manifest_records():
        portable = record.get("portableCircuit")
        if not isinstance(portable, dict):
            continue
        profile = profile_for_record(record, str(record.get("slug", "?")))
        assert profile.present
        assert profile.qubits == portable_circuit_cost(portable).logical_qubits
