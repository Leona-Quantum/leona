"""A catalogue entry's fault-tolerant cost, derived on read (E4).

The tests that matter are the ones about the answers with no number in them. A
cost extractor that says "0 magic states" for a circuit it could not read is
worse than one that says nothing, because the zero is indistinguishable from a
cheap circuit — so most of what follows pins the refusals rather than the
arithmetic, which `packages/py/estimation` already covers.

`test_the_published_corpus_costs_the_way_the_notes_say` runs the whole real
manifest through the path a visitor's request takes. Every earlier defect on
this feature was found that way and by nothing else: the corpus writes its
angles as strings, and a parser that only accepts floats returns a confident
refusal for all 120 circuits while looking like caution.
"""

import json
import math
import pathlib

import pytest
from majorana_contracts import ResourceEstimateBasis
from majorana_estimation import GIDNEY_2025

from majorana_api.catalog_estimate import (
    DEFAULT_ROTATION_SYNTHESIS_EPSILON,
    ContradictoryPrecision,
    UnknownAssumptionSet,
    _summarize_assumptions,
    estimate_for_record,
    resolve_assumptions,
)

ASSUMPTIONS = resolve_assumptions(None, None)


def _record(*steps, qubits: int = 2) -> dict:
    return {"portableCircuit": {"qubitCount": qubits, "steps": list(steps)}}


def _gate(name: str, *qubits: int, param=None) -> dict:
    step: dict = {"gate": name, "qubits": list(qubits)}
    if param is not None:
        step["param"] = param
    return step


# --- The four bases ---------------------------------------------------------


def test_a_clifford_circuit_is_exact_and_consumes_nothing():
    result = estimate_for_record(_record(_gate("h", 0), _gate("cx", 0, 1)), "bell", ASSUMPTIONS)

    assert result.basis is ResourceEstimateBasis.EXACT
    assert result.logical.magic_states == 0
    assert result.footprint.factory_qubits == 0
    assert result.reason is None


def test_a_clifford_circuit_states_no_runtime_rather_than_zero_seconds():
    """Both runtime terms are magic-state terms, so a circuit consuming none
    drives both to zero — and a page rendering that says the circuit runs
    instantly. The footprint is real and is still reported."""
    result = estimate_for_record(_record(_gate("h", 0), _gate("cx", 0, 1)), "bell", ASSUMPTIONS)

    assert result.runtime.seconds is None
    assert result.runtime.binding_term == "unstated"
    assert result.footprint.total_physical_qubits > 0


def test_an_arbitrary_rotation_is_estimated_and_says_what_it_cost():
    """The number is real *under* the stated epsilon and moves with it, so the
    epsilon and the share of the T-count it produced both travel with it."""
    result = estimate_for_record(_record(_gate("ry", 0, param="0.3")), "ansatz", ASSUMPTIONS)

    assert result.basis is ResourceEstimateBasis.ESTIMATED
    assert result.assumptions.rotation_synthesis_epsilon == DEFAULT_ROTATION_SYNTHESIS_EPSILON
    assert result.assumptions.t_per_rotation == 60
    assert result.logical.t_count == 60
    assert result.logical.t_from_synthesis == 60
    assert result.logical.synthesis_required == 1


def test_an_unreadable_operation_is_refused_by_name_rather_than_scored_zero():
    result = estimate_for_record(_record(_gate("wibble", 0)), "odd", ASSUMPTIONS)

    assert result.basis is ResourceEstimateBasis.REFUSED
    assert "wibble" in result.reason
    assert result.footprint is None and result.logical is None


def test_no_precision_rescues_an_unreadable_operation():
    """Refusing for lack of an epsilon and refusing for an unnamed gate are
    different failures, and only the first has a cure. A tighter precision must
    not turn the second into a number."""
    circuit = _record(_gate("wibble", 0), _gate("ry", 1, param="0.3"))

    for epsilon in (1e-3, 1e-6, 1e-12):
        result = estimate_for_record(circuit, "odd", resolve_assumptions(None, epsilon))
        assert result.basis is ResourceEstimateBasis.REFUSED


def test_an_entry_with_no_circuit_is_not_reported_as_a_refusal():
    """Nothing was attempted and nothing failed. Rendering these as refusals
    would invent a doubt about 163 literature and operator records that the
    data does not support."""
    result = estimate_for_record({"slug": "literature-only"}, "literature-only", ASSUMPTIONS)

    assert result.basis is ResourceEstimateBasis.NO_CIRCUIT
    assert "no portable circuit" in result.reason
    assert result.logical is None


@pytest.mark.parametrize(
    "portable",
    [
        {"steps": "not-a-list"},
        {"steps": ["not-an-object"]},
        {"qubitCount": 2, "steps": [{"gate": "h", "qubits": ["not-an-index"]}]},
    ],
)
def test_a_malformed_circuit_is_a_stated_refusal_not_a_500(portable):
    """A visitor cannot tell a crash from a refusal, and they mean opposite
    things about the entry."""
    result = estimate_for_record({"portableCircuit": portable}, "broken", ASSUMPTIONS)

    assert result.basis is ResourceEstimateBasis.REFUSED
    assert result.reason


# --- The assumption set is the claim ----------------------------------------


def test_the_precision_is_carried_in_the_identity_so_two_budgets_cannot_be_ranked():
    circuit = _record(_gate("ry", 0, param="0.3"))

    loose = estimate_for_record(circuit, "a", resolve_assumptions(None, 1e-3))
    tight = estimate_for_record(circuit, "a", resolve_assumptions(None, 1e-12))

    assert loose.assumptions.identity != tight.assumptions.identity
    assert tight.logical.t_count > loose.logical.t_count


def test_every_entry_is_costed_under_one_identity_so_the_page_can_be_ordered():
    """The refusal to sort must not become a refusal to be useful: a Clifford
    circuit and a rotation circuit costed under the same call share an identity,
    because the epsilon simply did not bite on the first one."""
    clifford = estimate_for_record(_record(_gate("h", 0)), "a", ASSUMPTIONS)
    rotation = estimate_for_record(_record(_gate("ry", 0, param="0.3")), "b", ASSUMPTIONS)

    assert (
        clifford.assumptions.identity == rotation.assumptions.identity == "gidney-2025@v1+eps=1e-06"
    )


def test_an_unknown_assumption_set_is_refused_rather_than_defaulted():
    """Silently serving superconducting numbers to a caller who asked for
    trapped-ion ones is a wrong answer that looks like a right one."""
    with pytest.raises(UnknownAssumptionSet):
        resolve_assumptions("trapped-ion@v1", None)


def test_the_default_set_resolves_and_the_sourced_one_still_states_no_precision():
    """The epsilon is chosen at this boundary, not in the estimation package —
    that package must keep refusing to pick one for itself."""
    assert resolve_assumptions(None, None).name == GIDNEY_2025.name
    assert GIDNEY_2025.rotation_synthesis_epsilon is None


def test_the_identity_printed_on_the_page_can_be_handed_straight_back():
    """The page prints `gidney-2025@v1+eps=1e-06`, and the API used to 422 on it.

    The registry is keyed by `name@vN` because a built-in set states no precision,
    but what a reader has in front of them is the identity the estimate carries.
    Pasting it back is the obvious thing to try, and the two halves of the feature
    disagreed about the name of the same thing.
    """
    shown = resolve_assumptions(None, None).identity
    assert shown == "gidney-2025@v1+eps=1e-06"

    assert resolve_assumptions(shown, None).identity == shown
    # Restating the same precision is agreement, not a conflict.
    assert resolve_assumptions(shown, 1e-6).identity == shown
    assert (
        resolve_assumptions("composed-trapped-ion@v1+eps=1e-09", None).identity
        == "composed-trapped-ion@v1+eps=1e-09"
    )


def test_two_stated_precisions_that_disagree_are_refused_rather_than_ranked():
    """Neither side may quietly win. An estimate is labelled with its precision,
    so picking one would return a cost under a budget the caller did not choose —
    on a page whose whole argument is that the label is the claim."""
    with pytest.raises(ContradictoryPrecision):
        resolve_assumptions("gidney-2025@v1+eps=1e-06", 1e-9)


def test_a_precision_smuggled_through_the_identity_obeys_the_same_bounds():
    """`epsilon` is bounded at the route; nothing bounded one arriving inside the
    identity string, which would be a second door of a different size on an
    anonymous endpoint."""
    for outside in ("gidney-2025@v1+eps=1e-30", "gidney-2025@v1+eps=0.5"):
        with pytest.raises(ContradictoryPrecision):
            resolve_assumptions(outside, None)


def test_an_identity_whose_suffix_is_not_a_number_is_simply_unknown():
    with pytest.raises(UnknownAssumptionSet):
        resolve_assumptions("gidney-2025@v1+eps=banana", None)


def test_the_second_set_is_reachable_by_name_and_the_default_does_not_move():
    """Adding a set must not change what an unparameterised caller gets.

    Every published number on `/repository` is rendered without naming a set,
    so the default is load-bearing: if it drifted, a page nobody edited would
    start showing different physical qubit counts under a different citation.
    """
    trapped_ion = resolve_assumptions("composed-trapped-ion@v1", None)

    assert trapped_ion.identity == "composed-trapped-ion@v1+eps=1e-06"
    assert resolve_assumptions(None, None).identity == "gidney-2025@v1+eps=1e-06"
    # The two are the pair the ordering refusal exists for.
    assert not trapped_ion.comparable_with(resolve_assumptions(None, None))


def test_the_same_circuit_costed_under_both_sets_carries_two_identities():
    """The refusal is only worth anything if the estimates it guards actually
    differ. Same circuit, same epsilon, different hardware, different answer."""
    circuit = _record(_gate("ry", 0, param="0.3"), _gate("cx", 0, 1))

    superconducting = estimate_for_record(circuit, "a", resolve_assumptions(None, None))
    trapped_ion = estimate_for_record(
        circuit, "a", resolve_assumptions("composed-trapped-ion@v1", None)
    )

    assert superconducting.assumptions.identity != trapped_ion.assumptions.identity
    assert (
        trapped_ion.footprint.total_physical_qubits
        != superconducting.footprint.total_physical_qubits
    )
    # Each estimate carries the citation for the set it was computed under, so a
    # reader who switches sets is told the sourcing changed with it.
    assert "arXiv:2108.12371" in trapped_ion.assumptions.citation
    assert "arXiv:2108.12371" not in superconducting.assumptions.citation


# --- Factories: the number that dominates a small circuit's footprint --------


def test_the_factory_count_moves_the_footprint_and_the_split_stays_visible():
    """For a two-rotation circuit the factories ARE the footprint. A reader
    shown only the total reads a correct number as a broken one."""
    circuit = _record(_gate("ry", 0, param="0.3"), _gate("cx", 0, 1))

    crossover = estimate_for_record(circuit, "a", ASSUMPTIONS)
    single = estimate_for_record(circuit, "a", ASSUMPTIONS, factory_count=1)

    assert crossover.footprint.total_physical_qubits > single.footprint.total_physical_qubits
    assert crossover.runtime.seconds < single.runtime.seconds
    # Same circuit, same distance: only the factory term moved.
    assert crossover.footprint.data_patch_qubits == single.footprint.data_patch_qubits
    assert crossover.distance.code_distance == single.distance.code_distance


def test_no_runtime_field_is_a_value_json_cannot_carry():
    """`inf` serialises to a bare `Infinity` token, which is not JSON and which
    a client renders as a duration."""
    result = estimate_for_record(_record(_gate("ry", 0, param="0.3")), "a", ASSUMPTIONS)

    for value in (result.runtime.seconds, result.runtime.throughput_seconds):
        assert value is None or math.isfinite(value)
    assert math.isfinite(result.runtime.reaction_limited_seconds)
    assert json.dumps(result.model_dump(mode="json"))


# --- Against the real corpus ------------------------------------------------


def _manifest_records() -> list[dict]:
    path = (
        pathlib.Path(__file__).resolve().parents[3] / "services/api/catalog_bootstrap/manifest.json"
    )
    if not path.exists():
        pytest.skip(f"pinned catalog manifest not present at {path}")
    manifest = json.loads(path.read_text())
    records = []
    for item in manifest.get("items", []):
        # `source_blob` IS the canonical JSON of the presentation record — the
        # same bytes catalog_read_model.parse_source_record decodes at read
        # time, so this test sees exactly what the route sees.
        if item.get("source_blob_encoding") != "canonical-json-utf8":
            continue
        parsed = json.loads(item["source_blob"])
        if isinstance(parsed, dict):
            records.append(parsed)
    assert records, "pinned manifest carries no decodable presentation records"
    return records


def test_the_published_corpus_costs_the_way_the_notes_say():
    """Ground the whole path against the real manifest, not against fixtures.

    Two properties, and the second is the one a fixture cannot check: **no
    published entry may be REFUSED**. A refusal here means the corpus contains
    an operation this stack cannot name, and the page would show a careful
    sentence where a cost belongs. That is exactly how the string-angle defect
    presented — every circuit refused, and the output read as caution.
    """
    bases: dict[ResourceEstimateBasis, int] = {basis: 0 for basis in ResourceEstimateBasis}
    refused: list[str] = []
    for record in _manifest_records():
        slug = str(record.get("slug", "?"))
        result = estimate_for_record(record, slug, ASSUMPTIONS)
        bases[result.basis] += 1
        if result.basis is ResourceEstimateBasis.REFUSED:
            refused.append(f"{slug}: {result.reason}")

    assert not refused, "published entries this stack cannot cost:\n" + "\n".join(refused)
    with_circuits = bases[ResourceEstimateBasis.EXACT] + bases[ResourceEstimateBasis.ESTIMATED]
    assert with_circuits > 0, "no published entry carried a costable circuit"
    # The session-70 measurement: 120 circuits, none with a non-trivial exact
    # cost. Asserted as a floor rather than an equality so publishing more
    # entries does not fail the build — the point is that both branches are
    # exercised by real data, not that the corpus is frozen.
    assert bases[ResourceEstimateBasis.EXACT] > 0
    assert bases[ResourceEstimateBasis.ESTIMATED] > 0


def test_adding_a_second_set_moved_no_number_on_the_published_page():
    """The regression a new assumption set could plausibly cause.

    `/repository` renders every cost without naming a set, so the default is
    load-bearing: a drift there would change published physical qubit counts on
    a page nobody edited. 1,307,465 is the number currently on
    `/repository/benchmark-hea-rzry-cz-16q`, read off production in session 74.

    The trapped-ion figure beside it is not a rival estimate to rank against it
    — that is what `comparable_with` refuses — it is the same circuit on
    hardware whose code cycle is 235x slower, which buys the same 2,320 data
    qubits 34x as many factories.
    """
    flagship = next(
        (r for r in _manifest_records() if r.get("slug") == "benchmark-hea-rzry-cz-16q"),
        None,
    )
    assert flagship is not None, "the corpus entry this pins is gone; re-pin, do not delete"

    default = estimate_for_record(flagship, "benchmark-hea-rzry-cz-16q", ASSUMPTIONS)
    assert default.assumptions.identity == "gidney-2025@v1+eps=1e-06"
    assert default.footprint.total_physical_qubits == 1_307_465
    assert default.footprint.factory_qubits == 1_302_825

    trapped_ion = estimate_for_record(
        flagship,
        "benchmark-hea-rzry-cz-16q",
        resolve_assumptions("composed-trapped-ion@v1", None),
    )
    # Same circuit and same code distance: every qubit of the difference is
    # factories, which is the finding, not a coincidence.
    assert trapped_ion.distance.code_distance == default.distance.code_distance
    assert trapped_ion.footprint.data_patch_qubits == default.footprint.data_patch_qubits
    assert trapped_ion.runtime.factory_count > 30 * default.runtime.factory_count


def test_asking_for_factories_a_clifford_circuit_cannot_use_does_not_inflate_it():
    """Reachable from an anonymous query parameter: `?factories=5` on a
    Clifford-only entry reported 975 factory qubits beside `magic_states: 0`."""
    circuit = _record(_gate("h", 0), _gate("cx", 0, 1))

    asked = estimate_for_record(circuit, "bell", ASSUMPTIONS, factory_count=5)

    assert asked.logical.magic_states == 0
    assert asked.footprint.factory_qubits == 0
    assert asked.runtime.factory_count == 0
    assert asked.footprint.total_physical_qubits == (
        estimate_for_record(circuit, "bell", ASSUMPTIONS).footprint.total_physical_qubits
    )


def test_an_exactly_countable_circuit_is_costed_without_a_stated_precision():
    """`t_per_rotation` raises when no epsilon is named, and Python evaluates it
    before `logical_cost` can decide to ignore it — so passing it unconditionally
    refused a circuit for want of a number that circuit never uses."""
    unstated = GIDNEY_2025  # states no rotation_synthesis_epsilon, on purpose

    result = estimate_for_record(_record(_gate("t", 0)), "one-t", unstated)

    assert result.basis is ResourceEstimateBasis.EXACT
    assert result.logical.t_count == 1
    assert result.assumptions.rotation_synthesis_epsilon is None


def test_a_rotation_circuit_still_refuses_when_no_precision_is_stated():
    """The other side of the same line: a circuit that *does* need the number
    must still be refused when nobody named one."""
    result = estimate_for_record(_record(_gate("ry", 0, param="0.3")), "ansatz", GIDNEY_2025)

    assert result.basis is ResourceEstimateBasis.REFUSED
    assert "rotation_synthesis_epsilon" in result.reason


def test_the_unsourced_values_are_disclosed_in_the_citation_the_page_renders():
    """Test where the property is consumed, not where it is written.

    `AssumptionSet.citation` composes the disclosure, but the route never hands
    the page a raw built-in set: it always applies a precision first, and the
    panel reads the DTO rather than the dataclass. So the two places this could
    come undone one layer below itself are `with_rotation_precision`, which
    rebuilds the frozen set, and `_summarize_assumptions`, which copies fields
    across by hand. Both are exercised here.

    Three of `gidney-2025`'s nine values are working allowances rather than
    paper values. The string on `/repository` used to say the source stated its
    assumptions in one place, so a visitor read a citation claiming more
    sourcing than the set had.
    """
    resolved = resolve_assumptions(None, 1e-6)
    summary = _summarize_assumptions(resolved)

    assert resolved.working_allowances == (
        "routing_factor",
        "factory_footprint_logical",
        "t_per_toffoli",
    )
    for allowance in resolved.working_allowances:
        assert allowance in summary.citation, f"{allowance} never reaches the page"
    assert "working allowances" in summary.citation
    # The precision must still be in the identity: the disclosure is additional
    # to that refusal machinery, not a replacement for it.
    assert summary.identity == "gidney-2025@v1+eps=1e-06"
