"""Leona's native mitigation numbers against Mitiq's, on the same inputs.

The owner's ruling on ai-ops 361 (option 1): *"Write both techniques directly,
and use Mitiq only in tests to check that our numbers match its numbers."* This
script is where Mitiq runs. Nothing else in the repository imports it, and
`packages/py/qpu/tests/test_no_runtime_mitiq.py` fails if anything does.

Run it in an isolated environment, never in the workspace's:

    uv run --isolated --no-project --python 3.12 \\
        --with mitiq==1.1.0 --with qiskit==2.5.2 --with qiskit-aer==0.17.2 \\
        --with ply==3.11 --with qiskit-qasm3-import==0.6.0 --with openqasm3==1.0.1 \\
        --with-editable packages/py/qpu \\
        python scripts/mitiq_parity.py --check

`--check` recomputes every number with Mitiq, compares it with our Python
implementation and with the committed fixture, prints the largest difference of
each kind, and exits non-zero if any exceeds its tolerance. `--write` regenerates
`packages/py/qpu/tests/fixtures/mitigation-parity.json` from Mitiq. The fixture
is what CI holds our code to without Mitiq present: `tests/test_mitigation.py`
checks the Python twin against it and `apps/web/lib/qpu-mitigation.test.ts`
checks the TypeScript that the product actually displays.

## Why Mitiq is not a dev dependency

It cannot be one without changing what the worker runs. Mitiq 1.1.0 (the latest,
2026-09-22) requires `numpy<2.3.0`, `scipy<=1.17.1` and `cirq-core<1.7.0`, while
`majorana-verification`, a runtime dependency of the worker, requires
`numpy>=2.5.3`. uv resolves ONE lock for the whole workspace: adding Mitiq to the
`dev` group would move the production image's numpy and scipy backwards, and a
separate group declared as conflicting with `dev` does not resolve at all
(measured: "majorana-evals depends on numpy>=2.5.3 and mitiq==1.1.0 depends on
numpy>=2.0.0,<2.3.0"). The pins above are therefore the whole of Mitiq's
footprint, and they live in this docstring, not in any lockfile. `--with ply` and
`--with qiskit-aer` are what Mitiq's Qiskit conversion imports (its own
`[qiskit]` extra would also pull an older qiskit-ibm-runtime), and the two qasm3
packages are what `qiskit.qasm3.loads` needs, at the versions uv.lock has. Pin `mitiq`
exactly: PyPI also carries a `mitiq==0.0.0` with no dependencies, which a loose
constraint can resolve to.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "packages"
    / "py"
    / "qpu"
    / "tests"
    / "fixtures"
    / "mitigation-parity.json"
)

# Tolerances, per quantity, and why each is what it is.
#
# - Linear algebra and closed-form fits agree to rounding: Mitiq builds the full
#   2^n x 2^n matrix and pseudo-inverts it, and fits with numpy.polyfit, where we
#   apply per-bit 2x2 inverses and a Lagrange sum. Different operation orders, the
#   same numbers to about 1e-12.
# - The projection does NOT agree to rounding, by construction. Ours is the exact
#   Euclidean projection (Smolin-Gambetta-Smith); Mitiq's minimises the same
#   distance with scipy's SLSQP from a clipped start, and stops when the distance
#   stops improving by more than SLSQP's default ftol of 1e-6. Near a minimum the
#   distance is flat to first order, so a point whose distance is within 1e-6 of
#   the best can sit about sqrt(2 * d * 1e-6) away from it (d, the distance, is a
#   few hundredths here): a few 1e-4. Measured on these cases: 1.05e-4 at worst.
#   So the check is two-sided: ours must be within PROJECTION_TOL of Mitiq's
#   point, AND no farther from the quasi-distribution than Mitiq's point is (ours
#   is the minimiser, so being farther would be a bug in ours).
ALGEBRA_TOL = 1e-9
PROJECTION_TOL = 1e-3
# Our Python and our TypeScript run the same arithmetic in the same order, so
# the shared fixture holds them to each other at rounding level.
TWIN_TOL = 1e-12

READOUT_CASES = [
    {
        "name": "one qubit, asymmetric",
        "counts": {"0": 912, "1": 112},
        "bits": [{"clbit": 0, "prob_meas1_prep0": 0.02, "prob_meas0_prep1": 0.06}],
    },
    {
        "name": "bell pair, measured on two noisy qubits",
        "counts": {"00": 470, "01": 31, "10": 27, "11": 496},
        "bits": [
            {"clbit": 0, "prob_meas1_prep0": 0.0158, "prob_meas0_prep1": 0.0548},
            {"clbit": 1, "prob_meas1_prep0": 0.0122, "prob_meas0_prep1": 0.0316},
        ],
    },
    {
        # Zero counts on outcomes the correction pushes below zero: the case the
        # projection exists for.
        "name": "three qubits, correction goes negative",
        "counts": {"000": 480, "111": 470, "001": 40, "110": 34},
        "bits": [
            {"clbit": 0, "prob_meas1_prep0": 0.0702, "prob_meas0_prep1": 0.1226},
            {"clbit": 1, "prob_meas1_prep0": 0.03, "prob_meas0_prep1": 0.08},
            {"clbit": 2, "prob_meas1_prep0": 0.01, "prob_meas0_prep1": 0.02},
        ],
    },
    {
        # Bits listed out of order on purpose: the correction must key on each
        # entry's `clbit`, not on its position in the list.
        "name": "two qubits, bits listed out of order",
        "counts": {"00": 700, "01": 100, "10": 150, "11": 74},
        "bits": [
            {"clbit": 1, "prob_meas1_prep0": 0.05, "prob_meas0_prep1": 0.09},
            {"clbit": 0, "prob_meas1_prep0": 0.01, "prob_meas0_prep1": 0.03},
        ],
    },
]

EXTRAPOLATION_CASES = [
    {"scales": [1, 3, 5], "values": [0.8, 0.6, 0.45]},
    {"scales": [1, 3, 5], "values": [0.97, 0.91, 0.86]},
    {"scales": [1, 3, 5], "values": [0.1, 0.25, 0.33]},
    {"scales": [1, 3, 5], "values": [0.5, 0.5, 0.5]},
    {"scales": [1, 3, 5], "values": [0.02, 0.09, 0.2]},
]

DISTRIBUTION_CASES = [
    {
        "name": "bell pair decaying toward uniform",
        "counts_by_scale": [
            [1, {"00": 460, "01": 40, "10": 44, "11": 480}],
            [3, {"00": 390, "01": 118, "10": 121, "11": 395}],
            [5, {"00": 340, "01": 170, "10": 176, "11": 338}],
        ],
    },
    {
        # An outcome that grows with noise extrapolates below zero: the clip.
        "name": "outcome that overshoots below zero",
        "counts_by_scale": [
            [1, {"0": 1000, "1": 24}],
            [3, {"0": 900, "1": 124}],
            [5, {"0": 830, "1": 194}],
        ],
    },
]

FOLD_PROGRAMS = [
    {
        "name": "bell",
        "qasm": 'OPENQASM 3.0; include "stdgates.inc"; qubit[2] q; bit[2] c; '
        "h q[0]; cx q[0], q[1]; c = measure q;",
    },
    {
        "name": "three qubits with phases",
        "qasm": 'OPENQASM 3.0; include "stdgates.inc"; qubit[3] q; bit[3] c; '
        "h q[0]; s q[1]; cx q[0], q[1]; rz(0.3) q[1]; t q[2]; cx q[1], q[2]; "
        "ry(1.1) q[0]; cz q[0], q[2]; x q[1]; c = measure q;",
    },
]


#: Programs folded AFTER compilation, the way the adapter folds them
#: (`mitigation.fold_compiled`). The triangle cannot sit on a line of qubits, so
#: compiling it adds SWAPs: the case Greptile's P1 on PR 970 was about.
COMPILED_FOLD_PROGRAMS = [
    *FOLD_PROGRAMS,
    {
        "name": "routed triangle",
        "qasm": 'OPENQASM 3.0; include "stdgates.inc"; qubit[3] q; bit[3] c; '
        "h q[0]; cx q[0], q[1]; cx q[1], q[2]; cx q[0], q[2]; rz(0.3) q[2]; c = measure q;",
    },
]

#: How the parity programs are compiled: IBM's basis on a line with exactly as
#: many qubits as the program, seeded so the same qiskit gives the same circuit
#: here and in CI. Not a fake backend: that would put qiskit-ibm-runtime in the
#: isolated environment, and a line is what forces the routing.
COMPILE_BASIS = ["rz", "sx", "x", "cx"]
COMPILE_SEED = 11


def compile_for_parity(qasm: str):
    """(ISA circuit, its Target) for one parity program."""
    from qiskit import qasm3
    from qiskit.transpiler import CouplingMap, Target
    from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager

    circuit = qasm3.loads(qasm)
    coupling = CouplingMap.from_line(circuit.num_qubits)
    isa = generate_preset_pass_manager(
        basis_gates=COMPILE_BASIS,
        coupling_map=coupling,
        optimization_level=1,
        seed_transpiler=COMPILE_SEED,
    ).run(circuit)
    target = Target.from_configuration(
        basis_gates=[*COMPILE_BASIS, "measure"], coupling_map=coupling
    )
    return isa, target


def _physical_pairs(circuit) -> dict[str, int]:
    pairs: Counter = Counter()
    for instruction in circuit.data:
        if instruction.operation.num_qubits == 2 and instruction.operation.name != "barrier":
            pairs[",".join(str(circuit.find_bit(qubit).index) for qubit in instruction.qubits)] += 1
    return dict(sorted(pairs.items()))


def _mitiq_index(ours: int, width: int) -> int:
    """Qiskit keys put classical bit 0 rightmost; Mitiq's probability vectors put
    qubit 0 first (most significant). Reverse the bits to move between them."""
    return int(format(ours, f"0{width}b")[::-1], 2)


def mitiq_readout(case: dict) -> dict:
    import numpy as np
    from mitiq.rem.inverse_confusion_matrix import (
        closest_positive_distribution,
        generate_tensored_inverse_confusion_matrix,
    )

    width = len(case["bits"])
    by_clbit = {int(bit["clbit"]): bit for bit in case["bits"]}
    # Mitiq's confusion matrix per qubit: columns prepared, rows read, the same
    # A = [[1 - p(1|0), p(0|1)], [p(1|0), 1 - p(0|1)]] ours uses. Listed in
    # qubit order, which is kron order, which is Mitiq's bit order.
    matrices = []
    for clbit in range(width):
        p10 = by_clbit[clbit]["prob_meas1_prep0"]
        p01 = by_clbit[clbit]["prob_meas0_prep1"]
        matrices.append(np.array([[1 - p10, p01], [p10, 1 - p01]]))
    inverse = generate_tensored_inverse_confusion_matrix(width, matrices)
    shots = sum(case["counts"].values())
    measured = np.zeros(1 << width)
    for key, count in case["counts"].items():
        measured[_mitiq_index(int(key, 2), width)] = count / shots
    quasi_mitiq = inverse @ measured
    projected_mitiq = np.array(closest_positive_distribution(quasi_mitiq))
    order = [_mitiq_index(index, width) for index in range(1 << width)]
    return {
        "quasi": [float(quasi_mitiq[i]) for i in order],
        "projected": [float(projected_mitiq[i]) for i in order],
    }


def mitiq_extrapolation(case: dict) -> dict:
    from mitiq.zne.inference import LinearFactory, RichardsonFactory

    return {
        "richardson": float(RichardsonFactory.extrapolate(case["scales"], case["values"])),
        "linear": float(LinearFactory.extrapolate(case["scales"], case["values"])),
    }


def mitiq_distribution(case: dict) -> dict:
    """Mitiq extrapolates one expectation value at a time, so a distribution is
    each outcome's probability through its factory, then the same clip and
    renormalisation ours applies. The composition is ours; every fit is Mitiq's."""
    from mitiq.zne.inference import LinearFactory, RichardsonFactory

    scales = [scale for scale, _ in case["counts_by_scale"]]
    shares = []
    for _, counts in case["counts_by_scale"]:
        shots = sum(counts.values())
        shares.append({key: count / shots for key, count in counts.items()})
    outcomes = sorted({key for share in shares for key in share})
    result = {}
    for method, factory in (("richardson", RichardsonFactory), ("linear", LinearFactory)):
        raw = {
            key: float(factory.extrapolate(scales, [share.get(key, 0.0) for share in shares]))
            for key in outcomes
        }
        kept = {key: max(value, 0.0) for key, value in raw.items()}
        total = sum(kept.values())
        result[method] = {
            "distribution": {key: value / total for key, value in kept.items()},
            "clipped_mass": -sum(value for value in raw.values() if value < 0),
        }
    return result


def _operation_multiset(circuit) -> list[list]:
    """Every gate as [name, qubit indices, parameters rounded], barriers and
    measurements left out, sorted. Mitiq folds through Cirq, which reorders
    commuting gates into moments, so sequences differ while the gates do not."""
    entries = []
    for instruction in circuit.data:
        name = instruction.operation.name
        if name in {"barrier", "measure"}:
            continue
        qubits = [circuit.find_bit(qubit).index for qubit in instruction.qubits]
        params = [round(float(param), 9) for param in instruction.operation.params]
        entries.append([name, qubits, params])
    return sorted(entries, key=lambda entry: json.dumps(entry))


def mitiq_fold(program: dict) -> dict:
    from mitiq.zne.scaling import fold_global as mitiq_fold_global
    from qiskit import qasm3

    circuit = qasm3.loads(program["qasm"])
    return {str(scale): _operation_multiset(mitiq_fold_global(circuit, scale)) for scale in (3, 5)}


def mitiq_fold_compiled(program: dict) -> dict:
    """Mitiq's `fold_global` on the COMPILED circuit: the gate multiset our
    `fold_global` must produce before `fold_compiled` translates the basis."""
    from mitiq.zne.scaling import fold_global as mitiq_fold_global

    isa, _ = compile_for_parity(program["qasm"])
    return {
        "isa": _operation_multiset(isa),
        **{str(scale): _operation_multiset(mitiq_fold_global(isa, scale)) for scale in (3, 5)},
    }


def mitiq_numbers() -> dict:
    return {
        "readout": [{**case, "mitiq": mitiq_readout(case)} for case in READOUT_CASES],
        "extrapolation": [
            {**case, "mitiq": mitiq_extrapolation(case)} for case in EXTRAPOLATION_CASES
        ],
        "distribution": [
            {**case, "mitiq": mitiq_distribution(case)} for case in DISTRIBUTION_CASES
        ],
        "fold": [{**program, "mitiq": mitiq_fold(program)} for program in FOLD_PROGRAMS],
        "fold_compiled": [
            {**program, "mitiq": mitiq_fold_compiled(program)} for program in COMPILED_FOLD_PROGRAMS
        ],
    }


def leona_numbers() -> dict:
    """What OUR Python computes for the same inputs, stored beside Mitiq's.

    This half of the fixture is what makes it shared: the TypeScript test holds
    the browser's numbers to these at TWIN_TOL, and the Python test holds the
    twin to them too, so a change to either language that the other did not
    make fails on the side that changed.
    """
    from majorana_qpu import mitigation as ours

    readout = []
    for case in READOUT_CASES:
        quasi = ours.readout_corrected_quasi(case["counts"], case["bits"])
        readout.append({"quasi": quasi, "projected": ours.closest_probability_distribution(quasi)})
    extrapolation = [
        {
            "richardson": ours.richardson_zero_noise(case["scales"], case["values"]),
            "linear": ours.linear_zero_noise(case["scales"], case["values"]),
        }
        for case in EXTRAPOLATION_CASES
    ]
    distribution = []
    for case in DISTRIBUTION_CASES:
        counts_by_scale = [(scale, counts) for scale, counts in case["counts_by_scale"]]
        distribution.append(
            {
                method: ours.extrapolate_distribution(counts_by_scale, method)
                for method in ("richardson", "linear")
            }
        )
    return {"readout": readout, "extrapolation": extrapolation, "distribution": distribution}


def _max_diff(left, right) -> float:
    return max((abs(a - b) for a, b in zip(left, right, strict=True)), default=0.0)


def compare_with_ours(numbers: dict) -> list[tuple[str, float, float]]:
    """(label, measured difference, tolerance) for every comparison."""
    import math

    from majorana_qpu import mitigation as ours

    rows: list[tuple[str, float, float]] = []
    for case in numbers["readout"]:
        quasi = ours.readout_corrected_quasi(case["counts"], case["bits"])
        projected = ours.closest_probability_distribution(quasi)
        rows.append(
            (
                f"readout quasi: {case['name']}",
                _max_diff(quasi, case["mitiq"]["quasi"]),
                ALGEBRA_TOL,
            )
        )
        rows.append(
            (
                f"projection: {case['name']}",
                _max_diff(projected, case["mitiq"]["projected"]),
                PROJECTION_TOL,
            )
        )
        ours_distance = math.dist(projected, quasi)
        mitiq_distance = math.dist(case["mitiq"]["projected"], quasi)
        print(
            f"info: Mitiq's projection is {mitiq_distance - ours_distance:.3e} farther from "
            f"the quasi-distribution than ours ({case['name']})"
        )
        # Positive would mean ours is FARTHER from the quasi-distribution than
        # Mitiq's numerical answer, which the exact minimiser cannot be.
        rows.append(
            (
                f"projection distance, ours minus Mitiq's: {case['name']}",
                max(ours_distance - mitiq_distance, 0.0),
                1e-12,
            )
        )
    for case in numbers["extrapolation"]:
        for method, function in (
            ("richardson", ours.richardson_zero_noise),
            ("linear", ours.linear_zero_noise),
        ):
            value = function(case["scales"], case["values"])
            rows.append(
                (
                    f"{method}: {case['values']}",
                    abs(value - case["mitiq"][method]),
                    ALGEBRA_TOL,
                )
            )
    for case in numbers["distribution"]:
        counts_by_scale = [(scale, counts) for scale, counts in case["counts_by_scale"]]
        for method in ("richardson", "linear"):
            result = ours.extrapolate_distribution(counts_by_scale, method)
            expected = case["mitiq"][method]
            keys = sorted(expected["distribution"])
            rows.append(
                (
                    f"{method} distribution: {case['name']}",
                    max(
                        _max_diff(
                            [result["distribution"][key] for key in keys],
                            [expected["distribution"][key] for key in keys],
                        ),
                        abs(result["clipped_mass"] - expected["clipped_mass"]),
                    ),
                    ALGEBRA_TOL,
                )
            )
    from qiskit import qasm3

    for program in numbers["fold"]:
        circuit = qasm3.loads(program["qasm"])
        for scale in ("3", "5"):
            mine = _operation_multiset(ours.fold_global(circuit, int(scale)))
            rows.append(
                (
                    f"fold x{scale} gates differ from Mitiq's: {program['name']}",
                    0.0 if mine == program["mitiq"][scale] else 1.0,
                    0.0,
                )
            )
    for program in numbers["fold_compiled"]:
        isa, target = compile_for_parity(program["qasm"])
        rows.append(
            (
                f"compiled circuit differs from the one Mitiq folded: {program['name']}",
                0.0 if _operation_multiset(isa) == program["mitiq"]["isa"] else 1.0,
                0.0,
            )
        )
        base = _physical_pairs(isa)
        for scale in ("3", "5"):
            mine = _operation_multiset(ours.fold_global(isa, int(scale)))
            rows.append(
                (
                    f"compiled fold x{scale} gates differ from Mitiq's: {program['name']}",
                    0.0 if mine == program["mitiq"][scale] else 1.0,
                    0.0,
                )
            )
            translated = _physical_pairs(ours.fold_compiled(isa, int(scale), target))
            expected = {pair: int(scale) * count for pair, count in base.items()}
            rows.append(
                (
                    f"compiled fold x{scale} runs other physical pairs than {scale} x scale 1: "
                    f"{program['name']}",
                    0.0 if translated == expected else 1.0,
                    0.0,
                )
            )
    return rows


def unitary_parity() -> list[tuple[str, float, float]]:
    """Our folded circuit and Mitiq's implement the same unitary. Checked only
    when Mitiq is present, since it needs both circuits; the gate multisets
    above are what the fixture can carry."""
    from mitiq.zne.scaling import fold_global as mitiq_fold_global
    from qiskit import qasm3
    from qiskit.quantum_info import Operator

    from majorana_qpu import mitigation as ours

    rows = []
    for program in FOLD_PROGRAMS:
        circuit = qasm3.loads(program["qasm"])
        for scale in (3, 5):
            mine = ours.fold_global(circuit, scale).remove_final_measurements(inplace=False)
            theirs = mitiq_fold_global(circuit, scale).remove_final_measurements(inplace=False)
            same = Operator(mine).equiv(Operator(theirs))
            rows.append(
                (
                    f"fold x{scale} unitary equals Mitiq's: {program['name']}",
                    0.0 if same else 1.0,
                    0.0,
                )
            )
    for program in COMPILED_FOLD_PROGRAMS:
        isa, target = compile_for_parity(program["qasm"])
        for scale in (3, 5):
            theirs = mitiq_fold_global(isa, scale).remove_final_measurements(inplace=False)
            # After basis translation, which is what is sent.
            mine = ours.fold_compiled(isa, scale, target).remove_final_measurements(inplace=False)
            same = Operator(mine).equiv(Operator(theirs))
            rows.append(
                (
                    f"compiled fold x{scale} unitary equals Mitiq's: {program['name']}",
                    0.0 if same else 1.0,
                    0.0,
                )
            )
    return rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true")
    group.add_argument("--write", action="store_true")
    args = parser.parse_args(argv)

    import mitiq

    numbers = mitiq_numbers()
    leona = leona_numbers()
    fresh = json.loads(json.dumps(numbers))
    for section, results in leona.items():
        for case, result in zip(fresh[section], results, strict=True):
            case["leona"] = json.loads(json.dumps(result))
    if args.write:
        document = {
            "generated_by": "scripts/mitiq_parity.py --write",
            "mitiq_version": mitiq.__version__,
            "tolerances": {
                "algebra": ALGEBRA_TOL,
                "projection": PROJECTION_TOL,
                "twin": TWIN_TOL,
            },
            **fresh,
        }
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
        print(f"wrote {FIXTURE} from Mitiq {mitiq.__version__}")

    committed = json.loads(FIXTURE.read_text())
    failures = 0
    # The committed fixture must still be what Mitiq and our Python say, or CI is
    # holding our code to stale numbers. Projections get Mitiq's own tolerance:
    # a different scipy may stop SLSQP at a slightly different point.
    for section in ("readout", "extrapolation", "distribution", "fold", "fold_compiled"):
        if not _close(committed[section], fresh[section]):
            print(f"FIXTURE STALE: section {section!r} differs from a fresh run")
            failures += 1
    rows = compare_with_ours(numbers) + unitary_parity()
    worst: dict[str, float] = Counter()
    for label, difference, tolerance in rows:
        status = "ok  " if difference <= tolerance else "FAIL"
        if difference > tolerance:
            failures += 1
        kind = label.split(":")[0]
        worst[kind] = max(worst[kind], difference)
        print(f"{status} {difference:.3e} (tol {tolerance:.0e})  {label}")
    print(f"\n{len(rows)} comparisons against Mitiq {mitiq.__version__}, {failures} failed")
    for kind, value in sorted(worst.items()):
        print(f"  largest difference, {kind}: {value:.3e}")
    return 1 if failures else 0


def _close(left, right, tolerance: float = ALGEBRA_TOL) -> bool:
    """Structural equality with float tolerance, for a fixture regenerated on a
    different machine whose last bits of rounding differ. Anything under a
    `projected` key compares at PROJECTION_TOL, for the reason given there."""
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(
            _close(left[key], right[key], PROJECTION_TOL if key == "projected" else tolerance)
            for key in left
        )
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(
            _close(a, b, tolerance) for a, b in zip(left, right, strict=True)
        )
    if isinstance(left, int | float) and isinstance(right, int | float):
        if isinstance(left, bool) or isinstance(right, bool):
            return left == right
        return abs(float(left) - float(right)) <= tolerance
    return left == right


if __name__ == "__main__":
    sys.exit(main())
