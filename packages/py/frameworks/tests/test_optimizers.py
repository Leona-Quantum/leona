import ast
import math
import sys
from pathlib import Path

import pytest
from qiskit import QuantumCircuit
from qiskit.quantum_info import Operator

from majorana_contracts import (
    CircuitOptimizationRequest,
    SynthesisRequest,
)
from majorana_contracts.enums import (
    CircuitCompiler,
    CircuitOptimizationGate,
    SynthesisConnectivity,
)
from majorana_frameworks import optimizer_kernel
from majorana_frameworks import optimizers
from majorana_frameworks.optimizers import (
    CircuitOptimizationError,
    build_synthesis_kernel_payload,
    optimize_circuit,
    synthesis_candidates_from_kernel,
)


def _request(compiler: str, operations: list[dict], *, level: int = 3):
    return CircuitOptimizationRequest.model_validate(
        {
            "compiler": compiler,
            "qubit_count": 2,
            "optimization_level": level,
            "operations": operations,
        }
    )


def _operator(operations) -> Operator:
    circuit = QuantumCircuit(2)
    for operation in operations:
        gate = operation.gate.value if hasattr(operation, "gate") else operation["gate"]
        qubits = operation.qubits if hasattr(operation, "qubits") else operation["qubits"]
        angle = (
            operation.angle_radians
            if hasattr(operation, "angle_radians")
            else operation.get("angle_radians")
        )
        method = getattr(circuit, gate.lower())
        if angle is None:
            method(*qubits)
        else:
            method(angle, *qubits)
    return Operator(circuit)


@pytest.mark.parametrize("compiler", ["qiskit", "cirq", "pytket", "pennylane"])
def test_general_compilers_reduce_a_numeric_studio_circuit(compiler):
    result = optimize_circuit(
        _request(
            compiler,
            [
                {"gate": "H", "qubits": [0]},
                {"gate": "H", "qubits": [0]},
                {"gate": "RX", "qubits": [1], "angle_radians": 0.2},
                {"gate": "RX", "qubits": [1], "angle_radians": 0.3},
                {"gate": "CX", "qubits": [0, 1]},
                {"gate": "CX", "qubits": [0, 1]},
            ],
        )
    )

    assert [(operation.gate.value, operation.qubits) for operation in result.operations] == [
        ("RX", [1])
    ]
    assert result.operations[0].angle_radians == pytest.approx(0.5)
    assert result.before.gate_count == 6
    assert result.after.gate_count == 1
    assert result.compiler_version
    assert result.equivalence == "unitary_up_to_global_phase"


def test_bqskit_runs_a_bounded_synthesis_pipeline_and_returns_studio_gates():
    operations = [
        {"gate": "H", "qubits": [0]},
        {"gate": "H", "qubits": [0]},
        {"gate": "RX", "qubits": [1], "angle_radians": 0.2},
        {"gate": "RX", "qubits": [1], "angle_radians": 0.3},
        {"gate": "CX", "qubits": [0, 1]},
        {"gate": "CX", "qubits": [0, 1]},
    ]

    result = optimize_circuit(_request("bqskit", operations, level=3))

    assert result.after.gate_count < result.before.gate_count
    assert _operator(operations).equiv(_operator(result.operations))
    assert {operation.gate.value for operation in result.operations} <= {
        "H",
        "X",
        "Y",
        "Z",
        "S",
        "T",
        "RX",
        "RY",
        "RZ",
        "CX",
        "CZ",
        "SWAP",
    }


def test_the_control_plane_half_imports_no_compiler_sdk():
    """The guarantee ai-ops#186's option A actually bought, pinned.

    `services/api/Dockerfile` builds ONE image and `deploy.yml` runs both
    `majorana-api` and `majorana-worker` from it, so a single top-level
    `import qiskit` added to `optimizers.py` would put a compiler stack back
    into both credentialed processes — silently, and without touching a
    pyproject, which is where anybody would look. The count that move was made
    on: 121 packages in that image with the compilers in a runtime extra, 87
    without, and 87 is exactly what `dev` resolved to before the lane existed.

    Read as source rather than by importing, because an import that succeeds
    here proves only that this machine's dev group has the SDK — which it does.
    """

    tree = ast.parse(Path(optimizers.__file__).read_text(encoding="utf-8"))
    forbidden = {"qiskit", "qiskit_aer", "cirq", "pennylane", "pytket", "pyzx", "bqskit"}
    imported: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.extend(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None:
            imported.append(node.module.split(".")[0])
    assert sorted(set(imported) & forbidden) == []


def test_the_sandbox_kernel_imports_only_the_standard_library_at_module_scope():
    """The kernel is executed in a rootfs where no `majorana_*` package exists.

    A module-scope `from majorana_contracts import ...` would not fail here —
    this machine has it — it would fail inside the sandbox, on a user's run,
    as a ModuleNotFoundError with no line of ours in the traceback. So the
    check is on the text, and it is why the kernel redeclares `Gate` and
    `Compiler` instead of importing them.
    """

    tree = ast.parse(Path(optimizer_kernel.__file__).read_text(encoding="utf-8"))
    module_scope = [node for node in tree.body if isinstance(node, (ast.Import, ast.ImportFrom))]
    names: list[str] = []
    for node in module_scope:
        if isinstance(node, ast.Import):
            names.extend(alias.name.split(".")[0] for alias in node.names)
        elif node.module is not None and node.level == 0:
            names.append(node.module.split(".")[0])
    assert [name for name in names if name.startswith("majorana")] == []
    assert [name for name in names if name not in sys.stdlib_module_names] == []


def test_the_kernel_redeclares_the_contract_enums_without_drifting():
    """`Gate` and `Compiler` are copies, and a copy is a thing that drifts.

    Nothing else compares them: the payload crosses a process boundary as
    strings, so a renamed member would surface as `compiler_failed` on a
    user's run rather than as a failure here.
    """

    assert {gate.name: gate.value for gate in optimizer_kernel.Gate} == {
        gate.name: gate.value for gate in CircuitOptimizationGate
    }
    assert {name.name: name.value for name in optimizer_kernel.Compiler} == {
        name.name: name.value for name in CircuitCompiler
    }
    assert {name.name: name.value for name in optimizer_kernel.Connectivity} == {
        name.name: name.value for name in SynthesisConnectivity
    }


def test_pyzx_runs_its_clifford_t_optimizer_and_lowers_back_to_studio_gates():
    result = optimize_circuit(
        _request(
            "pyzx",
            [
                {"gate": "H", "qubits": [0]},
                {"gate": "H", "qubits": [0]},
                {"gate": "T", "qubits": [1]},
                {"gate": "T", "qubits": [1]},
                {"gate": "CX", "qubits": [0, 1]},
                {"gate": "CX", "qubits": [0, 1]},
            ],
        )
    )

    assert len(result.operations) == 1
    assert result.operations[0].gate.value == "RZ"
    assert result.operations[0].qubits == [1]
    assert result.operations[0].angle_radians == pytest.approx(math.pi / 2)


def test_terminal_measurements_are_preserved_outside_the_compiler():
    result = optimize_circuit(
        _request(
            "qiskit",
            [
                {"gate": "X", "qubits": [0]},
                {"gate": "X", "qubits": [0]},
                {"gate": "M", "qubits": [0]},
                {"gate": "M", "qubits": [1]},
            ],
        )
    )

    assert [operation.gate.value for operation in result.operations] == ["M", "M"]
    assert result.after.measurement_count == 2
    assert any("preserved" in warning for warning in result.warnings)


def test_pyzx_refuses_rotations_outside_exact_clifford_t_angles():
    with pytest.raises(CircuitOptimizationError) as raised:
        optimize_circuit(_request("pyzx", [{"gate": "RZ", "qubits": [0], "angle_radians": 0.123}]))

    assert raised.value.code == "pyzx_requires_clifford_t"


@pytest.mark.parametrize("compiler", ["qiskit", "cirq", "pytket", "pennylane", "pyzx", "bqskit"])
def test_compiler_adapters_preserve_a_representative_unitary_up_to_global_phase(compiler):
    operations = [
        {"gate": "H", "qubits": [0]},
        {"gate": "T", "qubits": [0]},
        {"gate": "CX", "qubits": [0, 1]},
        {"gate": "RZ", "qubits": [1], "angle_radians": math.pi / 4},
        {"gate": "RX", "qubits": [0], "angle_radians": math.pi / 2},
        {"gate": "CZ", "qubits": [0, 1]},
    ]

    result = optimize_circuit(_request(compiler, operations))

    assert _operator(operations).equiv(_operator(result.operations))


def test_qiskit_materializes_an_elided_output_wire_permutation():
    operations = [
        {"gate": "H", "qubits": [0]},
        {"gate": "SWAP", "qubits": [0, 1]},
        {"gate": "RX", "qubits": [0], "angle_radians": 0.2},
    ]

    result = optimize_circuit(_request("qiskit", operations))

    assert _operator(operations).equiv(_operator(result.operations))
    assert result.operations[-1].gate.value == "SWAP"


def test_pyzx_refuses_a_rewrite_its_exact_equality_check_rejects():
    with pytest.raises(CircuitOptimizationError) as raised:
        optimize_circuit(
            _request(
                "pyzx",
                [
                    {"gate": "SWAP", "qubits": [0, 1]},
                    {"gate": "RX", "qubits": [0], "angle_radians": math.pi / 2},
                ],
            )
        )

    assert raised.value.code == "compiler_equivalence_check_failed"


def test_bqskit_refuses_circuits_beyond_its_synthesis_budget():
    request = CircuitOptimizationRequest.model_validate(
        {
            "compiler": "bqskit",
            "qubit_count": 9,
            "optimization_level": 1,
            "operations": [{"gate": "H", "qubits": [0]}],
        }
    )

    with pytest.raises(CircuitOptimizationError) as raised:
        optimize_circuit(request)

    assert raised.value.code == "bqskit_budget_exceeded"


def test_pyzx_says_so_plainly_when_the_extra_is_not_installed(monkeypatch):
    """PyZX is the one compiler a deployed image may legitimately not have.

    It lives in `majorana-frameworks`'s `zx` extra rather than `optimizers`,
    because it declares `ipywidgets` and so drags ipython, pexpect and
    ptyprocess into the single image `services/api/Dockerfile` builds and
    `deploy.yml` runs both the api and the worker from. Measured: `uv sync
    --all-packages --frozen --no-dev` installs 151 packages with pyzx in
    `optimizers` and 129 with it out, and 21 of the 22 removed are that stack.

    So the adapter has to survive its own absence with a sentence a caller can
    act on. Without the guard the failure is a bare `ModuleNotFoundError`
    escaping `optimize_circuit`, which is a 500 rather than a refusal — and the
    difference only ever shows up in production, because every test environment
    installs the extra through the root dev group.
    """
    monkeypatch.setitem(sys.modules, "pyzx", None)

    with pytest.raises(CircuitOptimizationError) as raised:
        optimize_circuit(_request("pyzx", [{"gate": "H", "qubits": [0]}]))

    assert raised.value.code == "compiler_unavailable"


# --- Targeted synthesis (proposal 3): coupling-map generation, routing, and the
# multi-compiler batch entrypoint. ---------------------------------------------


def test_coupling_map_for_all_to_all_is_no_constraint():
    assert optimizer_kernel._coupling_map_for_target(4, "all_to_all") is None
    assert optimizer_kernel._coupling_map_for_target(4, None) is None


def test_coupling_map_for_line_is_a_simple_chain():
    edges = optimizer_kernel._coupling_map_for_target(4, "line")
    undirected = {tuple(sorted(edge)) for edge in edges}
    assert undirected == {(0, 1), (1, 2), (2, 3)}


def test_coupling_map_for_grid_and_heavy_hex_are_connected_and_sized_correctly():
    for connectivity in ("grid", "heavy_hex"):
        for qubit_count in (5, 6, 9, 13):
            edges = optimizer_kernel._coupling_map_for_target(qubit_count, connectivity)
            nodes = {node for edge in edges for node in edge}
            assert nodes == set(range(qubit_count)), connectivity
            # Connected: BFS from node 0 over the undirected edge set reaches every node.
            undirected = {tuple(sorted(edge)) for edge in edges}
            adjacency: dict[int, set[int]] = {node: set() for node in nodes}
            for left, right in undirected:
                adjacency[left].add(right)
                adjacency[right].add(left)
            seen = {0}
            frontier = [0]
            while frontier:
                node = frontier.pop()
                for neighbor in adjacency[node]:
                    if neighbor not in seen:
                        seen.add(neighbor)
                        frontier.append(neighbor)
            assert seen == nodes, connectivity


def test_coupling_map_for_target_is_deterministic():
    first = optimizer_kernel._coupling_map_for_target(7, "heavy_hex")
    second = optimizer_kernel._coupling_map_for_target(7, "heavy_hex")
    assert first == second


def _operator_n(qubit_count: int, operations) -> Operator:
    """`_operator`, generalized to an arbitrary qubit count (that helper
    hardcodes 2, which every existing test in this file happens to use)."""

    circuit = QuantumCircuit(qubit_count)
    for operation in operations:
        gate = operation.gate.value if hasattr(operation, "gate") else operation["gate"]
        qubits = operation.qubits if hasattr(operation, "qubits") else operation["qubits"]
        angle = (
            operation.angle_radians
            if hasattr(operation, "angle_radians")
            else operation.get("angle_radians")
        )
        method = getattr(circuit, gate.lower())
        if angle is None:
            method(*qubits)
        else:
            method(angle, *qubits)
    return Operator(circuit)


def test_route_onto_target_inserts_swaps_and_preserves_the_unitary():
    """A CX between qubits 0 and 3 is not adjacent on a line -- the router MUST
    add SWAPs, and the restored logical ordering must make the routed circuit
    exactly the original unitary (not merely 'some permutation of it')."""

    operations = [
        optimizer_kernel.Op(gate=optimizer_kernel.Gate.H, qubits=[0]),
        optimizer_kernel.Op(gate=optimizer_kernel.Gate.CX, qubits=[0, 3]),
        optimizer_kernel.Op(gate=optimizer_kernel.Gate.CX, qubits=[1, 2]),
    ]
    coupling_map = optimizer_kernel._coupling_map_for_target(4, "line")

    routed = optimizer_kernel._route_onto_target(4, operations, coupling_map)

    assert any(op.gate is optimizer_kernel.Gate.SWAP for op in routed)
    assert _operator_n(4, operations).equiv(_operator_n(4, routed))
    # Routing produced an operation touching two non-adjacent line qubits nowhere:
    line_edges = {tuple(sorted(edge)) for edge in coupling_map}
    for op in routed:
        if len(op.qubits) == 2:
            assert tuple(sorted(op.qubits)) in line_edges


@pytest.mark.parametrize("compiler", ["qiskit", "cirq", "pytket", "pennylane", "pyzx", "bqskit"])
def test_every_compiler_supports_a_line_target_via_the_uniform_router(compiler):
    """Every compiler in the lane can represent EVERY connectivity target,
    because routing is applied uniformly to each compiler's own output rather
    than requiring six separate device-aware compile flows (see
    `_route_onto_target`'s docstring). Only pre-existing per-compiler capacity
    limits (unrelated to connectivity) narrow this."""

    payload = {
        "qubit_count": 4,
        "optimization_level": 3,
        "connectivity": "line",
        "compilers": [compiler],
        "operations": [
            {"gate": "H", "qubits": [0], "angle_radians": None},
            {"gate": "CX", "qubits": [0, 3], "angle_radians": None},
            {"gate": "CX", "qubits": [1, 2], "angle_radians": None},
        ],
    }

    result = optimizer_kernel.synthesize_operations(payload)

    assert result["ok"] is True
    assert result["results"][compiler]["ok"] is True, result["results"][compiler]


def test_synthesize_operations_reports_bqskit_budget_exceeded_without_stopping_the_batch():
    payload = {
        "qubit_count": 9,
        "optimization_level": 3,
        "connectivity": "all_to_all",
        "compilers": ["qiskit", "bqskit"],
        "operations": [{"gate": "H", "qubits": [i], "angle_radians": None} for i in range(9)],
    }

    result = optimizer_kernel.synthesize_operations(payload)

    assert result["ok"] is True
    assert result["results"]["qiskit"]["ok"] is True
    assert result["results"]["bqskit"]["ok"] is False
    assert result["results"]["bqskit"]["code"] == "bqskit_budget_exceeded"


def test_synthesize_operations_defaults_to_every_compiler():
    payload = {
        "qubit_count": 1,
        "optimization_level": 3,
        "operations": [{"gate": "H", "qubits": [0], "angle_radians": None}],
    }

    result = optimizer_kernel.synthesize_operations(payload)

    assert set(result["results"]) == {name.value for name in optimizer_kernel.Compiler}


# --- The control-plane half: payload building and per-compiler assembly -------


def _synthesis_request(operations, *, connectivity="all_to_all", qubit_count=2):
    return SynthesisRequest.model_validate(
        {
            "qubit_count": qubit_count,
            "operations": operations,
            "target": {"connectivity": connectivity},
            "objective": "two_qubit_count",
        }
    )


def test_build_synthesis_kernel_payload_strips_measurements_and_lists_every_compiler():
    request = _synthesis_request(
        [
            {"gate": "H", "qubits": [0]},
            {"gate": "CX", "qubits": [0, 1]},
            {"gate": "M", "qubits": [0]},
            {"gate": "M", "qubits": [1]},
        ]
    )

    payload = build_synthesis_kernel_payload(request, connectivity=SynthesisConnectivity.LINE)

    assert payload["connectivity"] == "line"
    assert payload["optimization_level"] == 3
    assert [op["gate"] for op in payload["operations"]] == ["H", "CX"]
    assert set(payload["compilers"]) == {name.value for name in CircuitCompiler}


def test_synthesis_candidates_from_kernel_categorizes_every_outcome():
    request = _synthesis_request([{"gate": "H", "qubits": [0]}, {"gate": "H", "qubits": [0]}])
    kernel_result = {
        "ok": True,
        "results": {
            "qiskit": {"ok": True, "version": "2.5.2", "operations": []},
            "bqskit": {"ok": False, "code": "bqskit_budget_exceeded", "message": "too big"},
            "pyzx": {"ok": False, "code": "compiler_internal_error", "message": "boom"},
        },
    }

    candidates = synthesis_candidates_from_kernel(request, kernel_result)
    by_compiler = {c.compiler.value: c for c in candidates}

    assert by_compiler["qiskit"].status == "succeeded"
    assert by_compiler["qiskit"].after.gate_count == 0  # H, H cancels
    assert by_compiler["qiskit"].after.t_count == 0
    assert by_compiler["bqskit"].status == "unsupported"
    assert by_compiler["bqskit"].reason == "too big"
    assert by_compiler["pyzx"].status == "failed"
    assert by_compiler["pyzx"].reason == "boom"
    # Only the three compilers present in kernel_result["results"] are returned.
    assert set(by_compiler) == {"qiskit", "bqskit", "pyzx"}


def test_synthesis_candidates_from_kernel_counts_t_gates():
    request = _synthesis_request([{"gate": "T", "qubits": [0]}, {"gate": "T", "qubits": [0]}])
    kernel_result = {
        "ok": True,
        "results": {
            "qiskit": {
                "ok": True,
                "version": "2.5.2",
                "operations": [
                    {"gate": "T", "qubits": [0], "angle_radians": None},
                    {"gate": "T", "qubits": [0], "angle_radians": None},
                ],
            },
        },
    }

    candidates = synthesis_candidates_from_kernel(request, kernel_result)

    assert candidates[0].before.t_count == 2
    assert candidates[0].after.t_count == 2


def test_synthesis_candidates_from_kernel_raises_on_a_whole_request_failure():
    request = _synthesis_request([{"gate": "H", "qubits": [0]}])
    kernel_result = {"ok": False, "code": "target_unsupported", "message": "unknown connectivity"}

    with pytest.raises(CircuitOptimizationError) as raised:
        synthesis_candidates_from_kernel(request, kernel_result)

    assert raised.value.code == "target_unsupported"
