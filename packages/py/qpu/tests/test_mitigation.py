"""Readout correction and zero-noise extrapolation, natively (ai-ops 361, option 1).

Three kinds of check, and what each can and cannot see:

- **Against Mitiq's numbers**, through `fixtures/mitigation-parity.json`, which
  `scripts/mitiq_parity.py --write` generated from Mitiq 1.1.0. Mitiq cannot be
  installed into this workspace (the script's docstring has the measurement), so
  CI holds our code to Mitiq's stored output, and `mitiq_parity.py --check` is
  what re-derives that output from Mitiq itself.
- **Against the transpiler**, on a fake IBM backend: the folds have to survive
  `optimization_level=1`, and the control below shows that without barriers
  they do not.
- **Against the definitions**, where no second implementation is needed: a fold
  implements the same unitary as the circuit, and the projection satisfies the
  optimality conditions of a Euclidean projection onto the simplex.
"""

from __future__ import annotations

import json
import math
import sys
import types
from pathlib import Path

import pytest

from majorana_qpu import IbmRuntimeProvider, QpuJobRequest
from majorana_qpu import mitigation
from majorana_qpu.ibm import _pub_counts, _transpile_pubs

FIXTURE = json.loads(
    (Path(__file__).resolve().parent / "fixtures" / "mitigation-parity.json").read_text()
)
TOL = FIXTURE["tolerances"]

BELL = (
    'OPENQASM 3.0; include "stdgates.inc"; qubit[2] q; bit[2] c; '
    "h q[0]; cx q[0], q[1]; c = measure q;"
)
GHZ3 = (
    'OPENQASM 3.0; include "stdgates.inc"; qubit[3] q; bit[3] c; '
    "h q[0]; cx q[0], q[1]; cx q[1], q[2]; rz(0.4) q[2]; c = measure q;"
)


def _loads(qasm: str):
    from qiskit import qasm3

    return qasm3.loads(qasm)


def _fake_backend():
    from qiskit_ibm_runtime.fake_provider import FakeManilaV2

    return FakeManilaV2()


# ---------------------------------------------------------------------------
# The shared fixture: our Python against Mitiq's numbers and against itself
# ---------------------------------------------------------------------------


def test_the_fixture_was_generated_by_mitiq():
    assert FIXTURE["mitiq_version"] == "1.1.0"
    assert FIXTURE["generated_by"] == "scripts/mitiq_parity.py --write"
    # Every section has cases; an empty section would make every loop below
    # pass vacuously.
    for section in ("readout", "extrapolation", "distribution", "fold", "fold_compiled"):
        assert FIXTURE[section], section


@pytest.mark.parametrize("case", FIXTURE["readout"], ids=lambda case: case["name"])
def test_readout_correction_matches_mitiq(case):
    quasi = mitigation.readout_corrected_quasi(case["counts"], case["bits"])
    assert max(map(abs, _diff(quasi, case["mitiq"]["quasi"]))) <= TOL["algebra"]
    assert max(map(abs, _diff(quasi, case["leona"]["quasi"]))) <= TOL["twin"]


@pytest.mark.parametrize("case", FIXTURE["readout"], ids=lambda case: case["name"])
def test_projection_matches_mitiq_and_is_no_farther_than_it(case):
    quasi = case["leona"]["quasi"]
    projected = mitigation.closest_probability_distribution(quasi)
    assert max(map(abs, _diff(projected, case["mitiq"]["projected"]))) <= TOL["projection"]
    assert max(map(abs, _diff(projected, case["leona"]["projected"]))) <= TOL["twin"]
    # Ours is the exact minimiser; Mitiq's is SLSQP's stopping point. Ours may
    # never be the farther of the two.
    assert math.dist(projected, quasi) <= math.dist(case["mitiq"]["projected"], quasi) + 1e-12


def test_at_least_one_readout_case_needs_the_projection():
    """Otherwise the projection tests above would pass with the projection
    replaced by the identity."""
    assert any(min(case["mitiq"]["quasi"]) < 0 for case in FIXTURE["readout"])


@pytest.mark.parametrize("case", FIXTURE["extrapolation"], ids=lambda case: str(case["values"]))
def test_extrapolation_matches_mitiq_factories(case):
    richardson = mitigation.richardson_zero_noise(case["scales"], case["values"])
    linear = mitigation.linear_zero_noise(case["scales"], case["values"])
    assert abs(richardson - case["mitiq"]["richardson"]) <= TOL["algebra"]
    assert abs(linear - case["mitiq"]["linear"]) <= TOL["algebra"]
    assert abs(richardson - case["leona"]["richardson"]) <= TOL["twin"]
    assert abs(linear - case["leona"]["linear"]) <= TOL["twin"]


@pytest.mark.parametrize("case", FIXTURE["distribution"], ids=lambda case: case["name"])
@pytest.mark.parametrize("method", ["richardson", "linear"])
def test_distribution_extrapolation_matches_mitiq(case, method):
    counts_by_scale = [(scale, counts) for scale, counts in case["counts_by_scale"]]
    result = mitigation.extrapolate_distribution(counts_by_scale, method)
    for key, expected in case["mitiq"][method]["distribution"].items():
        assert abs(result["distribution"][key] - expected) <= TOL["algebra"]
    assert abs(result["clipped_mass"] - case["mitiq"][method]["clipped_mass"]) <= TOL["algebra"]
    assert math.isclose(sum(result["distribution"].values()), 1.0, abs_tol=1e-12)


def test_the_overshoot_case_actually_overshoots():
    """The clip is exercised: Richardson puts probability below zero on it."""
    overshoot = next(case for case in FIXTURE["distribution"] if "overshoot" in case["name"])
    assert overshoot["mitiq"]["richardson"]["clipped_mass"] > 0


@pytest.mark.parametrize("program", FIXTURE["fold"], ids=lambda program: program["name"])
@pytest.mark.parametrize("scale", ["3", "5"])
def test_folding_uses_the_same_gates_as_mitiq_fold_global(program, scale):
    """Mitiq folds through Cirq, which regroups commuting gates, so the check is
    the multiset of gates (name, qubits, parameters) rather than their order;
    `mitiq_parity.py --check` also compares the two circuits' unitaries."""
    folded = mitigation.fold_global(_loads(program["qasm"]), int(scale))
    entries = []
    for instruction in folded.data:
        if instruction.operation.name in {"barrier", "measure"}:
            continue
        entries.append(
            [
                instruction.operation.name,
                [folded.find_bit(qubit).index for qubit in instruction.qubits],
                [round(float(param), 9) for param in instruction.operation.params],
            ]
        )
    entries.sort(key=json.dumps)
    assert entries == program["mitiq"][scale]


def _parity_script():
    """`scripts/mitiq_parity.py`, for its compile settings only. It imports Mitiq
    inside functions, never at module level, so loading it here needs none."""
    import importlib.util

    path = Path(__file__).resolve().parents[4] / "scripts" / "mitiq_parity.py"
    spec = importlib.util.spec_from_file_location("mitiq_parity", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("program", FIXTURE["fold_compiled"], ids=lambda program: program["name"])
def test_folding_the_compiled_circuit_matches_mitiq_and_keeps_every_pair(program):
    """Mitiq's `fold_global` on the same compiled circuit is the oracle for the
    gate multiset; basis translation afterwards must then leave each physical
    pair's two-qubit gates exactly scale times as many."""
    script = _parity_script()
    isa, target = script.compile_for_parity(program["qasm"])
    # The compiled circuit is the one Mitiq folded, or the rest proves nothing.
    assert script._operation_multiset(isa) == program["mitiq"]["isa"]
    base = script._physical_pairs(isa)
    for scale in ("3", "5"):
        assert (
            script._operation_multiset(mitigation.fold_global(isa, int(scale)))
            == (program["mitiq"][scale])
        )
        translated = mitigation.fold_compiled(isa, int(scale), target)
        assert script._physical_pairs(translated) == {
            pair: int(scale) * count for pair, count in base.items()
        }


def test_the_compiled_parity_programs_include_one_that_was_routed():
    triangle = next(p for p in FIXTURE["fold_compiled"] if p["name"] == "routed triangle")
    assert sum(1 for gate in triangle["mitiq"]["isa"] if len(gate[1]) == 2) > 3


def _diff(left, right):
    assert len(left) == len(right)
    return [a - b for a, b in zip(left, right, strict=True)]


# ---------------------------------------------------------------------------
# Against the definitions
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("qasm", [BELL, GHZ3])
@pytest.mark.parametrize("scale", [1, 3, 5])
def test_a_fold_implements_the_circuit_it_folds(qasm, scale):
    from qiskit.quantum_info import Operator

    circuit = _loads(qasm)
    folded = mitigation.fold_global(circuit, scale)
    assert Operator(folded.remove_final_measurements(inplace=False)).equiv(
        Operator(circuit.remove_final_measurements(inplace=False))
    )
    # Same measurements, same bits, still last.
    assert folded.count_ops()["measure"] == circuit.count_ops()["measure"]
    assert all(
        instruction.operation.name == "measure"
        for instruction in folded.data[-circuit.num_qubits :]
    )


@pytest.mark.parametrize("scale", [0, 2, 4, -1, 3.0])
def test_only_odd_integer_scale_factors_fold(scale):
    with pytest.raises(ValueError):
        mitigation.fold_global(_loads(BELL), scale)


@pytest.mark.parametrize(
    ("qasm", "code"),
    [
        (
            'OPENQASM 3.0; include "stdgates.inc"; qubit[1] q; bit[1] c; '
            "c[0] = measure q[0]; x q[0];",
            "mid_circuit_measurement",
        ),
        (
            'OPENQASM 3.0; include "stdgates.inc"; qubit[1] q; bit[1] c; '
            "h q[0]; reset q[0]; c[0] = measure q[0];",
            "non_unitary_operation",
        ),
        (
            'OPENQASM 3.0; include "stdgates.inc"; qubit[1] q; h q[0];',
            "no_measurement",
        ),
        (
            'OPENQASM 3.0; include "stdgates.inc"; input float theta; qubit[1] q; bit[1] c; '
            "rx(theta) q[0]; c[0] = measure q[0];",
            "unbound_parameters",
        ),
        (
            'OPENQASM 3.0; include "stdgates.inc"; qubit[2] q; bit[1] c; '
            "c[0] = measure q[0]; c[0] = measure q[1];",
            "bit_measured_twice",
        ),
        ("not a program", "unparsable"),
    ],
)
def test_circuits_zne_cannot_fold_are_refused_with_a_reason(qasm, code):
    refusal = mitigation.zne_refusal(qasm)
    assert refusal is not None and refusal.code == code
    assert str(refusal)


def test_a_foldable_circuit_is_not_refused():
    assert mitigation.zne_refusal(BELL) is None
    assert mitigation.zne_refusal(GHZ3) is None


def test_the_projection_meets_the_simplex_projection_conditions():
    """Without Mitiq: a Euclidean projection onto the probability simplex is
    p_i = max(q_i + t, 0) for one shift t, with the p summing to 1. Checked on
    a quasi-distribution with several negative entries."""
    quasi = [0.62, 0.31, 0.12, -0.02, -0.01, -0.03, 0.005, 0.005]
    assert math.isclose(sum(quasi), 1.0)
    projected = mitigation.closest_probability_distribution(quasi)
    assert math.isclose(sum(projected), 1.0, abs_tol=1e-12)
    assert min(projected) >= 0
    shifts = {round(p - q, 12) for p, q in zip(projected, quasi, strict=True) if p > 0}
    assert len(shifts) == 1
    (shift,) = shifts
    assert all(q + shift <= 1e-12 for p, q in zip(projected, quasi, strict=True) if p == 0)


def test_a_probability_distribution_projects_to_itself():
    distribution = [0.5, 0.25, 0.125, 0.125]
    assert mitigation.closest_probability_distribution(distribution) == distribution


def test_readout_correction_refuses_a_qubit_that_reads_wrong_half_the_time():
    with pytest.raises(ValueError):
        mitigation.readout_corrected_quasi(
            {"0": 10, "1": 10},
            [{"clbit": 0, "prob_meas1_prep0": 0.5, "prob_meas0_prep1": 0.1}],
        )


def test_richardson_weights_for_one_three_five():
    """15/8, -5/4, 3/8: the weights the UI's "can overshoot" warning is about."""
    for index, weight in enumerate((15 / 8, -5 / 4, 3 / 8)):
        values = [0.0, 0.0, 0.0]
        values[index] = 1.0
        assert math.isclose(mitigation.richardson_zero_noise([1, 3, 5], values), weight)


# ---------------------------------------------------------------------------
# Against the transpiler, on a fake IBM backend
# ---------------------------------------------------------------------------


TRIANGLE = (
    # Three CXs around a triangle: no line of qubits can hold all three pairs,
    # so FakeManilaV2 (a five-qubit line) has to route it with SWAPs.
    'OPENQASM 3.0; include "stdgates.inc"; qubit[3] q; bit[3] c; '
    "h q[0]; cx q[0], q[1]; cx q[1], q[2]; cx q[0], q[2]; rz(0.3) q[2]; c = measure q;"
)


def _physical_pairs(circuit):
    """Each two-qubit gate's physical qubits, in order, as a multiset."""
    from collections import Counter

    return Counter(
        tuple(circuit.find_bit(qubit).index for qubit in instruction.qubits)
        for instruction in circuit.data
        if instruction.operation.num_qubits == 2 and instruction.operation.name != "barrier"
    )


def _measured_qubits(circuit):
    return [
        (
            circuit.find_bit(instruction.qubits[0]).index,
            circuit.find_bit(instruction.clbits[0]).index,
        )
        for instruction in circuit.data
        if instruction.operation.name == "measure"
    ]


@pytest.mark.parametrize("qasm", [GHZ3, TRIANGLE], ids=["ghz3", "routed-triangle"])
def test_every_scale_runs_the_same_physical_pairs_exactly_one_three_and_five_times(qasm):
    """Greptile P1 on PR 970. The 3x and 5x circuits are folded from the
    compiled circuit, so each physical pair's two-qubit gates, SWAPs included,
    run exactly 3 and 5 times as often as at scale 1, and nothing else runs."""
    backend = _fake_backend()

    pubs, record = _transpile_pubs(_loads(qasm), backend, zne=True)

    base, three, five = (_physical_pairs(pub) for pub in pubs)
    assert base
    assert three == {pair: 3 * count for pair, count in base.items()}
    assert five == {pair: 5 * count for pair, count in base.items()}
    assert record["zne"]["two_qubit_gates"] == [
        sum(base.values()),
        3 * sum(base.values()),
        5 * sum(base.values()),
    ]
    # Read out through the same physical qubits into the same bits at every scale.
    assert _measured_qubits(pubs[0]) == _measured_qubits(pubs[1]) == _measured_qubits(pubs[2])


def test_the_triangle_really_is_routed():
    """Without this the test above could pass on a circuit that needed no SWAPs,
    which is the case where folding before compilation was harmless."""
    from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager

    isa = generate_preset_pass_manager(backend=_fake_backend(), optimization_level=1).run(
        _loads(TRIANGLE)
    )
    assert sum(_physical_pairs(isa).values()) > 3


def test_the_folds_stay_in_the_backends_instruction_set_and_implement_the_circuit():
    """sx+ is not native on IBM's machines; basis translation alone brings it
    back, and the folded circuit still implements exactly what scale 1 does."""
    from qiskit.quantum_info import Operator

    backend = _fake_backend()
    pubs, _ = _transpile_pubs(_loads(TRIANGLE), backend, zne=True)
    for pub in pubs:
        for instruction in pub.data:
            name = instruction.operation.name
            if name == "barrier":
                continue
            qargs = tuple(pub.find_bit(qubit).index for qubit in instruction.qubits)
            assert backend.target.instruction_supported(name, qargs), (name, qargs)
    reference = Operator(pubs[0].remove_final_measurements(inplace=False))
    for pub in pubs[1:]:
        assert Operator(pub.remove_final_measurements(inplace=False)).equiv(reference)


def test_folding_the_logical_circuit_would_have_mixed_pairs():
    """The measurement behind the fix, kept as a regression anchor: the logical
    3x fold, compiled with the scale-1 layout pinned, runs a different pair
    multiset on the routed triangle than 3 x scale 1. Seeded, because routing
    is stochastic and the point is that it CAN differ, not that it always does."""
    from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager

    backend = _fake_backend()
    circuit = _loads(TRIANGLE)
    isa = generate_preset_pass_manager(
        backend=backend, optimization_level=1, seed_transpiler=11
    ).run(circuit)
    layout = list(isa.layout.initial_index_layout(filter_ancillas=True))
    logical_fold = generate_preset_pass_manager(
        backend=backend, optimization_level=1, initial_layout=layout, seed_transpiler=0
    ).run(mitigation.fold_global(circuit, 3))
    base = _physical_pairs(isa)
    assert _physical_pairs(logical_fold) != {pair: 3 * count for pair, count in base.items()}


def test_without_barriers_the_transpiler_undoes_the_fold():
    """The control for the barriers: the same G G+ G with no barrier between the
    copies is cancelled back to G's gate count by an optimiser at level 1, so a
    fold without barriers would not survive anyone recompiling it."""
    from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager

    backend = _fake_backend()
    body = _loads(GHZ3).remove_final_measurements(inplace=False)
    unprotected = body.copy()
    unprotected.compose(body.inverse(), inplace=True)
    unprotected.compose(body, inplace=True)
    unprotected.measure_all()

    compiled_plain = generate_preset_pass_manager(backend=backend, optimization_level=1).run(
        _loads(GHZ3)
    )
    compiled_unprotected = generate_preset_pass_manager(backend=backend, optimization_level=1).run(
        unprotected
    )

    assert mitigation.two_qubit_gate_count(compiled_unprotected) == (
        mitigation.two_qubit_gate_count(compiled_plain)
    )


# ---------------------------------------------------------------------------
# The calibration snapshot
# ---------------------------------------------------------------------------


def test_the_snapshot_records_the_physical_qubit_each_bit_was_read_from():
    from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager

    backend = _fake_backend()
    isa = generate_preset_pass_manager(
        backend=backend, optimization_level=1, initial_layout=[4, 3]
    ).run(_loads(BELL))

    snapshot = mitigation.readout_calibration(isa, backend)

    assert snapshot["register"] == "c"
    assert [bit["clbit"] for bit in snapshot["bits"]] == [0, 1]
    assert [bit["qubit"] for bit in snapshot["bits"]] == [4, 3]
    properties = backend.properties()
    for bit in snapshot["bits"]:
        assert bit["source"] == "backend_properties"
        assert (
            bit["prob_meas1_prep0"]
            == properties.qubit_property(bit["qubit"], "prob_meas1_prep0")[0]
        )
        assert (
            bit["prob_meas0_prep1"]
            == properties.qubit_property(bit["qubit"], "prob_meas0_prep1")[0]
        )
    # Asymmetric on this backend, which is why both directions are kept.
    assert any(bit["prob_meas1_prep0"] != bit["prob_meas0_prep1"] for bit in snapshot["bits"])


def test_without_properties_the_snapshot_falls_back_to_the_symmetric_target_error():
    from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager

    backend = _fake_backend()
    isa = generate_preset_pass_manager(backend=backend, optimization_level=1).run(_loads(BELL))

    class NoProperties:
        target = backend.target

        def properties(self):
            raise RuntimeError("not reported")

    snapshot = mitigation.readout_calibration(isa, NoProperties())

    for bit in snapshot["bits"]:
        assert bit["source"] == "target_measure_error"
        assert bit["prob_meas1_prep0"] == bit["prob_meas0_prep1"]
        assert bit["prob_meas1_prep0"] == backend.target["measure"][(bit["qubit"],)].error


@pytest.mark.parametrize(
    "broken",
    [
        ("circuit", "text"),
        None,
    ],
)
def test_the_snapshot_never_raises(broken):
    assert mitigation.readout_calibration(broken, _fake_backend()) is None


def test_a_bit_nobody_measured_has_no_snapshot():
    from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager

    qasm = (
        'OPENQASM 3.0; include "stdgates.inc"; qubit[2] q; bit[2] c; '
        "h q[0]; cx q[0], q[1]; c[0] = measure q[0];"
    )
    backend = _fake_backend()
    isa = generate_preset_pass_manager(backend=backend, optimization_level=1).run(_loads(qasm))
    assert mitigation.readout_calibration(isa, backend) is None


# ---------------------------------------------------------------------------
# The stored document
# ---------------------------------------------------------------------------


def test_the_submit_merge_keeps_the_request_and_adds_what_was_reported():
    stored = mitigation.requested_zne_record()
    reported = {
        "version": 1,
        "readout": {"register": "c", "bits": []},
        "zne": {"scale_factors": [1, 3, 5], "folding": "global", "two_qubit_gates": [2, 6, 10]},
    }
    merged = mitigation.merged_after_submit(stored, reported)
    assert merged["zne"] == {
        "scale_factors": [1, 3, 5],
        "folding": "global",
        "two_qubit_gates": [2, 6, 10],
    }
    assert merged["readout"] == reported["readout"]
    assert mitigation.merged_after_submit(None, None) is None
    # A run without ZNE still gets its calibration recorded.
    assert "zne" not in mitigation.merged_after_submit(None, {"version": 1, "readout": {}})


def test_folded_counts_are_stored_by_scale_and_raw_counts_are_not_copied():
    stored = mitigation.requested_zne_record()
    document = mitigation.with_folded_counts(
        stored, [{"00": 500, "11": 524}, {"00": 450, "11": 574}, {"00": 420, "11": 604}]
    )
    assert document["zne"]["counts"] == {
        "3": {"00": 450, "11": 574},
        "5": {"00": 420, "11": 604},
    }
    assert "1" not in document["zne"]["counts"]
    assert stored["zne"].get("counts") is None  # the input is not mutated


@pytest.mark.parametrize(
    "pubs",
    [None, [{"0": 1}], [{"0": 1}, None, {"0": 1}], [{"0": 1}, {"0": 0, "1": 0}, {"0": 1}]],
)
def test_a_job_missing_a_folded_circuit_says_so_instead_of_extrapolating(pubs):
    document = mitigation.with_folded_counts(mitigation.requested_zne_record(), pubs)
    assert "counts" not in document["zne"]
    assert document["zne"]["error"]


# ---------------------------------------------------------------------------
# The adapter: what a ZNE submission sends, on a fake backend
# ---------------------------------------------------------------------------

OPEN = {"MAJORANA_QPU_SUBMIT_ENABLED": "true"}


def _install_runtime(monkeypatch, backend):
    """Replace IBM's service and sampler; transpile for real on a fake backend."""
    seen: dict[str, object] = {}

    class FakeService:
        def __init__(self, **kwargs):
            seen["service_built"] = True

        def least_busy(self, *, operational, simulator):
            return backend

    class FakeSampler:
        def __init__(self, *, mode):
            self.options = types.SimpleNamespace(default_shots=None)

        def run(self, pubs):
            seen["pubs"] = list(pubs)
            seen["shots"] = self.options.default_shots
            return types.SimpleNamespace(job_id=lambda: "job-zne", status=lambda: "QUEUED")

    runtime = types.ModuleType("qiskit_ibm_runtime")
    runtime.QiskitRuntimeService = FakeService
    runtime.SamplerV2 = FakeSampler
    monkeypatch.setitem(sys.modules, "qiskit_ibm_runtime", runtime)
    return seen


def test_a_zne_submission_is_one_job_of_three_circuits(monkeypatch):
    backend = _fake_backend()
    seen = _install_runtime(monkeypatch, backend)
    request = QpuJobRequest(
        device_id="ibm.open_plan", shots=512, qasm=GHZ3, source_fingerprint="f", zne=True
    )

    record = IbmRuntimeProvider("tok", environ=OPEN).submit(request)

    assert len(seen["pubs"]) == 3
    assert seen["shots"] == 512  # per circuit
    gates = record.mitigation["zne"]["two_qubit_gates"]
    assert gates == [mitigation.two_qubit_gate_count(pub) for pub in seen["pubs"]]
    assert gates[1] == 3 * gates[0] and gates[2] == 5 * gates[0]
    assert len(record.mitigation["readout"]["bits"]) == 3


def test_a_submission_without_zne_sends_one_circuit_and_still_records_calibration(monkeypatch):
    backend = _fake_backend()
    seen = _install_runtime(monkeypatch, backend)
    request = QpuJobRequest(device_id="ibm.open_plan", shots=64, qasm=BELL, source_fingerprint="f")

    record = IbmRuntimeProvider("tok", environ=OPEN).submit(request)

    assert len(seen["pubs"]) == 1
    assert "zne" not in record.mitigation
    assert [bit["clbit"] for bit in record.mitigation["readout"]["bits"]] == [0, 1]


def test_an_unfoldable_zne_submission_raises_before_ibm_is_contacted(monkeypatch):
    seen = _install_runtime(monkeypatch, _fake_backend())
    request = QpuJobRequest(
        device_id="ibm.open_plan",
        shots=64,
        qasm='OPENQASM 3.0; include "stdgates.inc"; qubit[1] q; bit[1] c; '
        "c[0] = measure q[0]; x q[0];",
        source_fingerprint="f",
        zne=True,
    )
    with pytest.raises(mitigation.ZneUnsupported):
        IbmRuntimeProvider("tok", environ=OPEN).submit(request)
    assert "service_built" not in seen
    assert "pubs" not in seen


def test_poll_reads_every_pub_in_order():
    def pub(counts):
        register = types.SimpleNamespace(get_counts=lambda: counts)
        return types.SimpleNamespace(data=types.SimpleNamespace(c=register))

    result = [pub({"00": 10}), pub({"00": 8, "11": 2}), pub({"11": 10})]
    assert _pub_counts(result) == [{"00": 10}, {"00": 8, "11": 2}, {"11": 10}]
    assert _pub_counts(object()) is None
