"""Leona's example Qapps (ai-ops 363) meet every contract a generated Qapp must.

A generated Qapp reaches a visitor only after `handlers.py` has normalised its
schemas, run the UI document guard, the Python safety guard and the usability
check, and smoke-run its program in the sandbox. The examples skip generation,
so nothing in production runs those checks on them. This file does instead, with
the SAME functions and the SAME smoke-input chooser the worker uses, and then
executes each program for real (Qiskit 2.5.2 is in this environment, as it is in
the sandbox) and validates what it returns against its declared output schema.

The physics checks below compare against published numbers, not against this
code's own earlier output, so a wrong integral or a wrong sign fails here.
"""

from __future__ import annotations

import json
import math
import re
import uuid
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException, Response
from majorana_contracts import Scope
from majorana_contracts.enums import Framework, Role
from majorana_sandbox.guard import check_python_code
from majorana_worker.handlers import _qapp_smoke_inputs

from majorana_api.qapp_examples import EXAMPLES, examples_by_key
from majorana_api.qapp_validation import (
    check_qapp_usability,
    normalize_qapp_schema,
    validate_qapp_inputs,
    validate_qapp_ui_document,
)
from majorana_api.routes import qapps as qapp_routes

EXAMPLE_KEYS = [example.key for example in EXAMPLES]


def _run(key: str, inputs: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Execute one example program the way the sandbox does: QAPP_INPUTS and
    QAPP_MAX_QUBITS injected, RESULT read back. Returns (RESULT, namespace)."""
    example = examples_by_key()[key]
    namespace: dict[str, Any] = {
        "QAPP_INPUTS": inputs,
        "QAPP_MAX_QUBITS": example.qubits_estimate,
    }
    exec(compile(example.quantum_source, f"{key}/program.py", "exec"), namespace)  # noqa: S102
    return namespace["RESULT"], namespace


# ------------------------------------------------------------------ the contracts


def test_there_are_exactly_the_four_examples_the_ruling_approved():
    """ai-ops 363 named four: a Bell pair, a Grover search, a QAOA MaxCut
    playground and a hydrogen-molecule VQE sweep. Adding a fifth is a new
    question for the owner, not a quiet extension of this ruling."""
    assert EXAMPLE_KEYS == ["bell_pair", "grover_search", "qaoa_maxcut", "h2_vqe"]


@pytest.mark.parametrize("key", EXAMPLE_KEYS)
def test_schemas_are_already_in_canonical_form(key):
    """Generated schemas are stored AFTER `normalize_qapp_schema`. The examples
    are stored as written, so they must already be what it returns."""
    example = examples_by_key()[key]
    assert normalize_qapp_schema(example.input_schema) == example.input_schema
    assert normalize_qapp_schema(example.output_schema) == example.output_schema


@pytest.mark.parametrize("key", EXAMPLE_KEYS)
def test_ui_document_passes_the_generation_guard_and_usability_check(key):
    example = examples_by_key()[key]
    validate_qapp_ui_document(example.ui_document)
    # Never fatal in generation, but an example has no excuse: it must be clean.
    check_qapp_usability(example.ui_document, example.input_schema)


@pytest.mark.parametrize("key", EXAMPLE_KEYS)
def test_every_input_has_its_own_labelled_control(key):
    """Stricter than `check_qapp_usability`, which (by its own docstring) is
    satisfied by an input's name appearing anywhere, even in a comment. A
    hand-written example can meet the real rule: an element whose id IS the
    input's name, and a <label for> naming it."""
    example = examples_by_key()[key]
    for name in example.input_schema["properties"]:
        assert f'id="{name}"' in example.ui_document, f"no control with id {name}"
        assert re.search(rf'<label\b[^>]*\bfor="{name}"', example.ui_document), (
            f"no label for {name}"
        )


@pytest.mark.parametrize("key", EXAMPLE_KEYS)
def test_program_passes_the_sandbox_safety_guard(key):
    guard = check_python_code(examples_by_key()[key].quantum_source)
    assert guard.ok, guard.reason


@pytest.mark.parametrize("key", EXAMPLE_KEYS)
def test_metadata_fits_what_every_qapp_listing_requires(key):
    example = examples_by_key()[key]
    assert Framework(example.framework) is Framework.QISKIT
    assert 1 <= example.qubits_estimate <= 27
    assert example.title.strip() and example.description.strip()


@pytest.mark.parametrize("end", ["low", "high"])
@pytest.mark.parametrize("key", EXAMPLE_KEYS)
def test_program_runs_at_both_ends_of_its_inputs_and_returns_its_contract(key, end):
    """The worker's own smoke chooser (`_qapp_smoke_inputs`), at the end it uses
    to gate a generation and at the end ai-ops 180 added, followed by the output
    check the worker applies to every visitor execution."""
    example = examples_by_key()[key]
    inputs = _qapp_smoke_inputs(example.input_schema, end=end)
    validate_qapp_inputs(example.input_schema, inputs)
    result, _ = _run(key, inputs)
    validate_qapp_inputs(example.output_schema, result)
    # A visitor's response travels as JSON: no NaN, no infinity.
    json.dumps(result, allow_nan=False)


# ------------------------------------------------------------------ Bell pair


@pytest.mark.parametrize(
    ("state", "zz", "xx"),
    [
        ("phi_plus", 1, 1),
        ("phi_minus", 1, -1),
        ("psi_plus", -1, 1),
        ("psi_minus", -1, -1),
    ],
)
def test_bell_correlations_are_the_textbook_signs(state, zz, xx):
    """<ZZ> and <XX> for the four Bell states. With every shot perfectly
    correlated, the sampled correlation equals the exact one."""
    for basis, expected in (("Z", zz), ("X", xx)):
        result, _ = _run("bell_pair", {"state": state, "basis": basis, "shots": 200})
        assert result["exact_correlation"] == pytest.approx(expected, abs=1e-9)
        assert result["correlation"] == pytest.approx(expected, abs=1e-9)
        assert sum(result["counts"].values()) == 200


def test_bell_reports_all_four_outcomes_even_when_two_never_happen():
    """The page draws one bar per outcome, so a zero must be present as a zero."""
    result, _ = _run("bell_pair", {"state": "psi_plus", "basis": "Z", "shots": 100})
    assert result["probabilities"] == {"00": 0.0, "01": 0.5, "10": 0.5, "11": 0.0}
    assert set(result["counts"]) == {"00", "01", "10", "11"}
    assert result["counts"]["00"] == result["counts"]["11"] == 0


# ------------------------------------------------------------------ Grover


@pytest.mark.parametrize("qubits", [2, 3, 4, 5])
def test_grover_success_follows_the_rotation_formula(qubits):
    """After k iterations the marked item is found with probability
    sin^2((2k + 1) theta), sin(theta) = 1/sqrt(N) (Boyer, Brassard, Hoyer and
    Tapp, 1998). The program simulates the circuit; this is the closed form."""
    marked = 2**qubits - 2
    result, _ = _run(
        "grover_search", {"qubits": qubits, "marked": marked, "iterations": 1, "shots": 64}
    )
    theta = math.asin(1 / math.sqrt(2**qubits))
    expected = [math.sin((2 * k + 1) * theta) ** 2 for k in range(9)]
    assert result["probability_by_iteration"] == pytest.approx(expected, abs=2e-6)
    assert result["marked_bitstring"] == format(marked, f"0{qubits}b")
    # The advertised best count is where the formula peaks within one period.
    first_period = expected[: result["optimal_iterations"] + 2]
    assert first_period.index(max(first_period)) == result["optimal_iterations"]


def test_grover_refuses_a_marked_item_outside_the_search_space():
    with pytest.raises(ValueError, match="from 0 to 7"):
        _run("grover_search", {"qubits": 3, "marked": 9, "iterations": 2, "shots": 10})


# ------------------------------------------------------------------ QAOA MaxCut


def test_qaoa_graphs_drawn_in_the_page_are_the_graphs_the_program_solves():
    """The page carries its own copy of every graph so it can draw one before
    anything has run. That copy must not drift from the program's."""
    document = examples_by_key()["qaoa_maxcut"].ui_document
    match = re.search(r"const GRAPHS = (\{.*?\});\n", document)
    assert match, "the page's GRAPHS literal was not found"
    drawn = json.loads(match.group(1))
    _, namespace = _run("qaoa_maxcut", {"graph": "triangle", "layers": 1, "optimize": False})
    solved = namespace["GRAPHS"]
    assert list(drawn) == list(solved)
    for name, (nodes, edges) in solved.items():
        assert drawn[name]["nodes"] == nodes
        assert [tuple(edge) for edge in drawn[name]["edges"]] == edges
    assert (
        list(drawn) == examples_by_key()["qaoa_maxcut"].input_schema["properties"]["graph"]["enum"]
    )


@pytest.mark.parametrize(
    ("graph", "layers", "ratio"),
    [
        # A ring of n nodes with p < n/2 layers reaches (2p + 1) / (2p + 2) at the
        # optimal angles (Farhi, Goldstone and Gutmann, 2014, the "ring of
        # disagrees"), and cuts every edge once p >= n/2.
        ("square", 1, 3 / 4),
        ("hexagon", 1, 3 / 4),
        ("hexagon", 2, 5 / 6),
        ("hexagon", 3, 1.0),
    ],
)
def test_qaoa_on_rings_reaches_the_published_ratio(graph, layers, ratio):
    result, _ = _run("qaoa_maxcut", {"graph": graph, "layers": layers, "optimize": True})
    assert result["approximation_ratio"] == pytest.approx(ratio, abs=1e-4)


def test_qaoa_with_no_cost_angle_is_a_fair_coin_on_every_node():
    """gamma = 0 leaves the uniform superposition untouched (RX commutes with
    |+>), so each edge is cut half the time. A sign or ordering error in the
    circuit or the cut count shows up here."""
    result, namespace = _run(
        "qaoa_maxcut",
        {"graph": "prism", "layers": 2, "optimize": False, "gamma": 0.0, "beta": 0.7},
    )
    assert result["expected_cut"] == pytest.approx(len(namespace["GRAPHS"]["prism"][1]) / 2)
    assert result["max_cut"] == 7


def test_qaoa_reported_best_answer_really_cuts_what_it_says():
    result, _ = _run("qaoa_maxcut", {"graph": "bowtie", "layers": 2, "optimize": True})
    edges = [(edge["u"], edge["v"]) for edge in result["edges"]]
    for outcome in result["top_outcomes"]:
        groups = outcome["assignment"]
        assert outcome["cut"] == sum(groups[u] != groups[v] for u, v in edges)


# ------------------------------------------------------------------ H2 VQE


def _h2():
    _, namespace = _run("h2_vqe", {"r_min": 0.3, "r_max": 1.5, "points": 3})
    return namespace


def test_h2_integrals_match_the_textbook_worked_example():
    """Szabo and Ostlund's STO-3G H2 example at R = 1.4 bohr, to the four
    decimals the book prints: overlap, core Hamiltonian, and the four distinct
    two-electron integrals over the atomic orbitals."""
    namespace = _h2()
    overlap, core, eri = namespace["ao_integrals"](1.4)
    assert overlap[0, 1] == pytest.approx(0.6593, abs=5e-5)
    assert core[0, 0] == pytest.approx(-1.1204, abs=5e-5)
    assert core[0, 1] == pytest.approx(-0.9584, abs=5e-5)
    assert eri[0, 0, 0, 0] == pytest.approx(0.7746, abs=5e-5)
    assert eri[0, 0, 1, 1] == pytest.approx(0.5697, abs=5e-5)
    assert eri[1, 0, 0, 0] == pytest.approx(0.4441, abs=5e-5)
    assert eri[1, 0, 1, 0] == pytest.approx(0.2970, abs=5e-5)


def test_h2_energies_at_the_textbook_geometry():
    """Hartree-Fock -1.1167 and full CI -1.1373 hartree at R = 1.4 bohr in
    STO-3G (Szabo and Ostlund). VQE is the minimum over the ansatz, which spans
    the full two-state space here, so it must equal full CI."""
    namespace = _h2()
    operator, _ = namespace["hamiltonian"](1.4 / namespace["BOHR_PER_ANGSTROM"])
    assert namespace["energy"](operator, 0.0) == pytest.approx(-1.1167, abs=5e-5)
    assert namespace["exact_energy"](operator) == pytest.approx(-1.1373, abs=5e-5)


def test_h2_operator_gives_the_fully_filled_state_its_real_energy():
    """The pair operator's fourth state, both orbitals doubly filled, is one no
    ansatz here reaches, so no sweep output depends on it. Its energy is still
    part of the operator the docstring calls exact, so it is checked by a route
    that shares nothing with the pair model: all four spin orbitals filled is
    the determinant with AO density P = 2 S^-1, whose energy is
    tr(P h) + 1/2 sum P P [(mn|ls) - 1/2 (ml|ns)] + 1/R."""
    import numpy as np

    namespace = _h2()
    r_bohr = 1.4
    overlap, core, eri = namespace["ao_integrals"](r_bohr)
    density = 2 * np.linalg.inv(overlap)
    coulomb = np.einsum("ls,mnls->mn", density, eri)
    exchange = np.einsum("ls,mlns->mn", density, eri)
    filled = float(
        np.sum(density * core) + 0.5 * np.sum(density * (coulomb - 0.5 * exchange)) + 1 / r_bohr
    )
    operator, _ = namespace["hamiltonian"](r_bohr / namespace["BOHR_PER_ANGSTROM"])
    # |q1 q0> = |11> is index 3.
    assert operator.to_matrix().real[3, 3] == pytest.approx(filled, abs=1e-9)


def test_h2_sweep_finds_the_known_bond_length_and_vqe_matches_exact():
    result, _ = _run("h2_vqe", {"r_min": 0.4, "r_max": 2.5, "points": 12})
    # STO-3G full-CI equilibrium, 0.735 angstrom.
    assert result["equilibrium_in_range"] is True
    assert result["equilibrium_r_angstrom"] == pytest.approx(0.735, abs=2e-3)
    for row in result["curve"]:
        assert row["vqe"] == pytest.approx(row["exact"], abs=1e-6)
        # Hartree-Fock is one state of the ansatz (theta = 0), so it can never be lower.
        assert row["hartree_fock"] >= row["exact"] - 1e-9


def test_h2_dissociates_to_two_hydrogen_atoms():
    """Stretched far apart, the exact energy approaches two STO-3G hydrogen
    atoms (-0.4666 hartree each) while Hartree-Fock does not, which is the
    textbook failure this app is there to show."""
    result, namespace = _run("h2_vqe", {"r_min": 1.2, "r_max": 3.5, "points": 3})
    far = 200.0
    _, core, _ = namespace["ao_integrals"](far)
    atom = core[0, 0] + 1 / far  # remove the other nucleus's pull
    assert atom == pytest.approx(-0.4666, abs=5e-5)
    stretched = result["curve"][-1]
    assert stretched["exact"] == pytest.approx(2 * atom, abs=2e-3)
    assert stretched["hartree_fock"] - stretched["exact"] > 0.2
    assert result["equilibrium_in_range"] is False


def test_h2_refuses_a_range_the_form_does_not_offer():
    with pytest.raises(ValueError, match="r_min"):
        _run("h2_vqe", {"r_min": 0.1, "r_max": 2.5, "points": 5})


# ------------------------------------------------------------------ the routes


def _scope() -> Scope:
    return Scope(user_id=uuid.uuid4(), workspace_id=uuid.uuid4(), role=Role.OWNER)


async def test_the_list_route_names_every_example_and_carries_no_program():
    summaries = await qapp_routes.list_qapp_examples(_scope())
    assert [summary.key for summary in summaries] == EXAMPLE_KEYS
    for summary in summaries:
        assert "quantum_source" not in summary.model_dump()
        assert "ui_document" not in summary.model_dump()


async def test_copying_an_unknown_example_is_a_404_and_writes_nothing():
    session = SimpleNamespace(added=[])
    session.add = session.added.append
    with pytest.raises(HTTPException) as refused:
        await qapp_routes.copy_qapp_example("not-an-example", _scope(), session, Response())
    assert refused.value.status_code == 404
    assert session.added == []


async def test_copying_passes_the_bundle_through_byte_for_byte(monkeypatch):
    captured: dict[str, Any] = {}

    async def create_from_example(scope, session, **fields):
        captured.update(fields)
        raise RuntimeError("stop before building a response")

    monkeypatch.setattr(qapp_routes.qapps_repo, "create_from_example", create_from_example)
    with pytest.raises(RuntimeError, match="stop before"):
        await qapp_routes.copy_qapp_example(
            "grover_search", _scope(), SimpleNamespace(), Response()
        )
    example = examples_by_key()["grover_search"]
    assert captured["quantum_source"] == example.quantum_source
    assert captured["ui_document"] == example.ui_document
    assert captured["input_schema"] == example.input_schema
    assert captured["output_schema"] == example.output_schema
    assert captured["example_key"] == "grover_search"
