"""The numbers: `costs.ts`'s arithmetic, written a second time (owner ruling, ai-ops 382).

`apps/web/lib/workflow-planner/costs.ts` is the source of truth. Its module comment
says what a cost model may do (evaluate a formula a paper states, do labelled
arithmetic on it, never supply a constant the source does not state) and why each
model checks the chosen blocks. This file holds ONLY the arithmetic and the control
flow around it. Every word a line or note prints (label, unit, formula text, kind,
source, note, what it counts) is read by id from `planner_data.json`, so it exists
once, in TS.

## Writing a formula here

Transcribe the TS expression in the same evaluation order, with `_jsmath` for every
call that is not `+ - * /`: `a * b ** 3 * c` is `(a * b**3) * c` in both languages,
but `math.ceil` returns an exact int and `round` rounds half to even, and either would
move a number. `tests/test_planner_parity.py` fails on any difference from the TS planner over
the whole grid, and a new TS line with no counterpart here fails its census.

Suggestions (`CostReport.suggestions`) are not ported: they are advice with numbers
formatted into sentences, not cost lines, and the connector returns the lines.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from . import _jsmath as js
from ._data import PlannerData
from .assemble import Stage, chosen_method_for

lg = js.log2

#: `LogicalSummary` keys, in the order `scaling.ts` draws them (`SERIES_KEYS`).
LOGICAL_KEYS = ("logical_qubits", "toffolis", "t_gates", "queries", "serial_depth")


@dataclass
class CostReport:
    lines: list[dict[str, Any]] = field(default_factory=list)
    classical: list[dict[str, Any]] = field(default_factory=list)
    published: list[dict[str, Any]] = field(default_factory=list)
    #: `LOGICAL_KEYS` -> the line standing for that figure, or None.
    logical: dict[str, dict[str, Any] | None] = field(
        default_factory=lambda: dict.fromkeys(LOGICAL_KEYS)
    )
    #: Note ids in `planner_data.json["notes"]`.
    notes: list[str] = field(default_factory=list)


class _Model:
    """One evaluation: the data, the parameter values, and the line builder."""

    def __init__(self, data: PlannerData, params: dict[str, dict[str, Any]]) -> None:
        self.data = data
        self.params = params

    def value(self, key: str) -> float | None:
        """`value()` in TS: a finite number, or None."""
        v = (self.params.get(key) or {}).get("value")
        return float(v) if isinstance(v, int | float) and js.isfinite(float(v)) else None

    def missing(self, *keys: str) -> list[str]:
        return [key for key in keys if self.value(key) is None]

    def line(
        self, line_id: str, value: float | None, missing: list[str] | None = None
    ) -> dict[str, Any]:
        """`line()` in TS: the line's fixed words from the data, its value, and what it lacks.

        A line that lacks a parameter has no value, whatever the arithmetic produced.
        """
        text = self.data.lines[line_id]
        formula = text["formula"]
        if text["formula_template"] is not None:
            # `{key}` is filled with the parameter's value as JavaScript prints it,
            # by plain replacement (a formula may contain braces of its own).
            formula = text["formula_template"]
            for key in self.params:
                v = self.value(key)
                if v is not None:
                    formula = formula.replace("{" + key + "}", js.number_string(v))
        needs = list(missing or [])
        return {
            "id": line_id,
            "label": text["label"],
            "value": None if needs else value,
            "unit": text["unit"],
            "formula": formula,
            "kind": text["kind"],
            "source": text["source"],
            "qualifier": text["qualifier"],
            "note": text["note"],
            "missing": needs,
            "counts": text["counts"],
        }


def _root_method(root: Stage | None) -> str | None:
    return root.method.id if root and root.method else None


# ---------------------------------------------------------------------------


def _search(m: _Model, root: Stage | None, report: CostReport) -> None:
    if _root_method(root) != "grover-fixed-iteration-search":
        report.notes.append("search-other-block")
        return
    n = m.value("domainSize")
    marked = m.value("markedCount")
    needs = m.missing("domainSize", "markedCount")
    if n is not None and marked is not None and marked >= n:
        report.notes.append("search-count-not-below-n")
        return
    theta = js.asin(js.sqrt(marked / n)) if n is not None and marked is not None else js.NAN
    iterations = js.floor(js.PI / (4 * theta)) if js.isfinite(theta) else None
    success = js.power(js.sin((2 * iterations + 1) * theta), 2) if iterations is not None else None
    queries = m.line("grover-iterations", iterations, needs)
    report.lines.append(queries)
    report.lines.append(m.line("grover-success", success, needs))
    register = m.line(
        "grover-register", js.ceil(lg(n)) if n is not None else None, m.missing("domainSize")
    )
    report.lines.append(register)
    oracle = m.value("oracleToffolis")
    toffolis = None
    if oracle is not None:
        toffolis = m.line(
            "grover-toffolis", iterations * oracle if iterations is not None else None, needs
        )
        report.lines.append(toffolis)
    report.logical.update(logical_qubits=register, toffolis=toffolis, t_gates=None, queries=queries)
    report.classical.append(
        m.line(
            "classical-search",
            n - marked + 1 if n is not None and marked is not None else None,
            needs,
        )
    )


def _factoring(m: _Model, root: Stage | None, report: CostReport) -> None:
    if _root_method(root) != "cyclic-period-finding":
        report.notes.append("period-finding-other-block")
        return
    n = m.value("bits")
    needs = m.missing("bits")
    qubits = m.line(
        "ge2021-qubits", js.ceil(3 * n + 0.002 * n * lg(n)) if n is not None else None, needs
    )
    toffolis = m.line(
        "ge2021-toffolis",
        0.3 * js.power(n, 3) + 0.0005 * js.power(n, 3) * lg(n) if n is not None else None,
        needs,
    )
    depth = m.line(
        "ge2021-depth",
        500 * js.power(n, 2) + js.power(n, 2) * lg(n) if n is not None else None,
        needs,
    )
    report.lines.extend([qubits, toffolis, depth])
    # Gidney–Ekerå's measurement depth is the estimator's serial depth (see costs.ts).
    report.logical.update(
        logical_qubits=qubits, toffolis=toffolis, t_gates=None, queries=None, serial_depth=depth
    )
    row = m.data.gidney_2025_table_5.get(js.number_string(n)) if n is not None else None
    if row is not None:
        report.lines.append(m.line("g2025-qubits", row[1]))
        report.lines.append(m.line("g2025-toffolis", row[0]))
    elif n is not None:
        report.notes.append("gidney2025-tabulated-sizes")
    if n == 2048:
        report.published.append(m.line("ge2021-machine", 2e7))
        report.published.append(m.line("g2025-machine", 1e6))


def _ecdlp(m: _Model, root: Stage | None, report: CostReport) -> None:
    if _root_method(root) != "cyclic-period-finding":
        report.notes.append("period-finding-other-block")
        return
    n = m.value("bits")
    needs = m.missing("bits")
    qubits = m.line(
        "roetteler-qubits", 9 * n + 2 * js.ceil(lg(n)) + 10 if n is not None else None, needs
    )
    toffolis = m.line(
        "roetteler-toffolis",
        448 * js.power(n, 3) * lg(n) + 4090 * js.power(n, 3) if n is not None else None,
        needs,
    )
    report.lines.extend([qubits, toffolis])
    report.logical.update(logical_qubits=qubits, toffolis=toffolis, t_gates=None, queries=None)


def _ground_state(m: _Model, root: Stage | None, report: CostReport) -> None:
    lam = m.value("lambda")
    d_e = m.value("deltaE")
    n = m.value("orbitals")
    root_id = _root_method(root)
    qpe_ready = lam is not None and d_e is not None
    qpe_bits = (
        js.js_max(0.0, js.ceil(lg((js.SQRT2 * js.PI * lam) / (2 * d_e)))) if qpe_ready else None
    )
    qpe_queries = js.power(2, qpe_bits) if qpe_bits is not None else None
    vqe_shots = js.power(lam / d_e, 2) if qpe_ready else None

    if root_id == "phase-estimation-ground-state":
        if chosen_method_for(root, "hamiltonian-simulation") != "qubitization-simulation":
            report.notes.append("ground-state-needs-qubitization")
            return
        needs_qpe = m.missing("lambda", "deltaE")
        register = m.line("babbush-bits", qpe_bits, needs_qpe)
        queries = m.line("babbush-queries", qpe_queries, needs_qpe)
        t_gates = m.line(
            "babbush-t",
            (24 * js.SQRT2 * js.PI * n * lam) / d_e if qpe_ready and n is not None else None,
            m.missing("lambda", "deltaE", "orbitals"),
        )
        logical_qubits = m.line(
            "babbush-qubits",
            n
            + js.ceil(
                lg((4 * js.SQRT2 * js.PI * js.power(lam, 3) * js.power(n, 5)) / js.power(d_e, 3))
            )
            if qpe_ready and n is not None
            else None,
            m.missing("lambda", "deltaE", "orbitals"),
        )
        report.lines.extend([register, queries, t_gates, logical_qubits])
        report.logical.update(
            logical_qubits=logical_qubits, toffolis=None, t_gates=t_gates, queries=queries
        )
    elif root_id == "variational-ground-state":
        shots = m.line("wecker-measurements", vqe_shots, m.missing("lambda", "deltaE"))
        report.lines.append(shots)
        report.lines.append(m.line("vqe-qubits", n, m.missing("orbitals")))
        report.logical.update(queries=shots)
    else:
        report.notes.append("ground-state-no-model")


def _hamiltonian_simulation(m: _Model, root: Stage | None, report: CostReport) -> None:
    lam = m.value("lambda")
    t = m.value("time")
    if _root_method(root) == "qubitization-simulation":
        # A `scaling` line's value is a magnitude, not a count: never in the logical summary.
        report.lines.append(
            m.line(
                "qubitization-leading",
                lam * t if lam is not None and t is not None else None,
                m.missing("lambda", "time"),
            )
        )
    else:
        report.notes.append("no-model-for-block")


def _linear_system(m: _Model, root: Stage | None, report: CostReport) -> None:
    kappa = m.value("kappa")
    eps = m.value("epsilon")
    if _root_method(root) == "discrete-adiabatic-inversion":
        steps = m.line(
            "costa-steps", 834 * kappa if kappa is not None else None, m.missing("kappa")
        )
        report.lines.append(steps)
        report.lines.append(
            m.line(
                "costa-filter", js.log(2 / eps) if eps is not None else None, m.missing("epsilon")
            )
        )
        per_step = m.value("stepToffolis")
        toffolis = None
        if per_step is not None:
            toffolis = m.line(
                "costa-toffolis",
                834 * kappa * per_step if kappa is not None else None,
                m.missing("kappa"),
            )
            report.lines.append(toffolis)
        report.logical.update(queries=steps, toffolis=toffolis)
    else:
        report.notes.append("linear-system-other-block")


def _maxcut(m: _Model, root: Stage | None, report: CostReport) -> None:
    if _root_method(root) != "qaoa-cost-mixer-alternation":
        report.notes.append("maxcut-other-block")
        return
    n = m.value("nodes")
    edges = m.value("edges")
    p = m.value("layers")
    qubits = m.line("qaoa-qubits", n, m.missing("nodes"))
    two_qubit = m.line(
        "qaoa-two-qubit",
        p * edges if edges is not None and p is not None else None,
        m.missing("edges", "layers"),
    )
    one_qubit = m.line(
        "qaoa-mixer",
        n + p * n if n is not None and p is not None else None,
        m.missing("nodes", "layers"),
    )
    report.lines.extend([qubits, two_qubit, one_qubit])
    report.logical.update(logical_qubits=qubits)


def amplitude_estimation_evaluations(epsilon: float) -> float:
    """Smallest M with π/M + π²/M² ≤ ε: Brassard et al.'s Theorem 12 at k = 1, a = 1/2."""
    return js.ceil((js.PI * (1 + js.sqrt(1 + 4 * epsilon))) / (2 * epsilon))


def chebyshev_samples(epsilon: float) -> float:
    """Samples for a Bernoulli mean within ε with probability 8/π², by Chebyshev."""
    return js.ceil(1 / (4 * js.power(epsilon, 2) * (1 - 8 / js.power(js.PI, 2))))


def _amplitude_estimation(m: _Model, root: Stage | None, report: CostReport) -> None:
    eps = m.value("epsilon")
    needs = m.missing("epsilon")
    report.classical.append(
        m.line("chebyshev-samples", chebyshev_samples(eps) if eps is not None else None, needs)
    )
    root_id = _root_method(root)
    if root_id == "amplitude-estimation-readout":
        evaluations_count = amplitude_estimation_evaluations(eps) if eps is not None else None
        evaluations = m.line("brassard-evaluations", evaluations_count, needs)
        register = m.line(
            "brassard-register",
            js.ceil(lg(evaluations_count)) if evaluations_count is not None else None,
            needs,
        )
        report.lines.extend([evaluations, register])
        report.logical.update(queries=evaluations)
    elif root_id != "direct-sampling-readout":
        report.notes.append("no-model-for-block")


def _phase_estimation(m: _Model, root: Stage | None, report: CostReport) -> None:
    if _root_method(root) != "register-phase-estimation":
        report.notes.append("phase-estimation-other-block")
        return
    n = m.value("precisionBits")
    eps = m.value("failureProbability")
    needs = m.missing("precisionBits", "failureProbability")
    bits = n + js.ceil(lg(1 / (2 * eps) + 1 / 2)) if n is not None and eps is not None else None
    register = m.line("cemm-register", bits, needs)
    uses = m.line("cemm-uses", js.power(2, bits) - 1 if bits is not None else None, needs)
    qft = m.line("cemm-qft", bits + (bits * (bits - 1)) / 2 if bits is not None else None, needs)
    report.lines.extend([register, uses, qft])
    report.logical.update(logical_qubits=register, queries=uses)


def _no_model(m: _Model, root: Stage | None, report: CostReport) -> None:
    report.notes.append("no-model-for-problem")


MODELS = {
    "search": _search,
    "factoring": _factoring,
    "ecdlp": _ecdlp,
    "ground-state": _ground_state,
    "hamiltonian-simulation": _hamiltonian_simulation,
    "linear-system": _linear_system,
    "maxcut": _maxcut,
    "amplitude-estimation": _amplitude_estimation,
    "phase-estimation": _phase_estimation,
    "linear-ode": _no_model,
    "nonlinear-ode": _no_model,
}


def cost_report(
    data: PlannerData, problem: str, params: dict[str, dict[str, Any]], root: Stage | None
) -> CostReport:
    """`costReport(problem, params, root)`. `params` maps a key to `{"value", "origin"}`."""
    report = CostReport()
    MODELS[problem](_Model(data, params), root, report)
    return report
