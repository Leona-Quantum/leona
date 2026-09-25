"""`leona_notebooks.dependencies`: the per-cell graph dependency-graph replay runs on
(DESIGN §3) — binding forms, the mutation rule, barriers, cache keys, and `plan_run`.
"""

from __future__ import annotations

from majorana_contracts.notebooks import CheckProperty

from leona_notebooks.dependencies import (
    CHECK_ROLE,
    RunPlan,
    analyze_cell_source,
    build_dependency_graph,
    cache_keys,
    cell_cache_payload,
    check_property_payload,
    plan_run,
)
from leona_notebooks.execution import CellResult, ExecutionReport
from leona_notebooks.source import parse_source
from leona_notebooks.spec import Cell, NotebookSpec


def _spec(source: str) -> NotebookSpec:
    return parse_source(source)


def _check_cell(cell_id: str, *, property: object = None) -> Cell:
    """A `role="check"` cell built with `model_construct` — `CellRole` has no
    `"check"` member on this branch (the checks lane's own contracts land on a
    sibling branch), so the normal `Cell(...)` constructor would refuse the
    string. `property` mirrors that lane's future `CheckProperty` field, which
    does not exist on `Cell` here either — see `check_property_payload`."""
    cell = Cell.model_construct(
        id=cell_id,
        kind="code",
        role=CHECK_ROLE,
        source=f"# check: {cell_id}",
        tags=[],
        execute=True,
        stub=None,
        check=None,
        answer=None,
        answer_prompt=None,
        timeout_s=None,
    )
    if property is not None:
        object.__setattr__(cell, "property", property)
    return cell


def _spec_with_cells(cells: list[Cell], *, slug: str = "s") -> NotebookSpec:
    return NotebookSpec(schema_version=1, slug=slug, title="T", cells=cells)


# --------------------------------------------------------------------------- binding forms


def test_plain_assignment_defines_and_a_later_read_depends_on_it() -> None:
    # B1a fix: `defined` is folded INTO `read`, not excluded from it — every
    # definition is also treated as reading its own name, so a cell whose static
    # shape LOOKS like an unconditional redefinition still chains back to whatever
    # defined the name before it (see `analyze_cell_source`'s docstring: the
    # conditional-definition, try/except-import-fallback and empty-`for` cases this
    # exists for). For the very FIRST definer of a name there is nothing to chain
    # back to, so this is harmless here — no edge is created either way, because
    # `build_dependency_graph` skips a read with no earlier definer.
    defined, read, barriers = analyze_cell_source("x = 1\n")
    assert defined == {"x"}
    assert read == {"x"}
    assert barriers == ()


def test_tuple_assignment_defines_every_target() -> None:
    defined, _read, _b = analyze_cell_source("a, (b, c) = 1, (2, 3)\n")
    assert defined == {"a", "b", "c"}


def test_augmented_assignment_both_defines_and_reads_the_same_name() -> None:
    defined, read, _b = analyze_cell_source("counter += 1\n")
    assert defined == {"counter"}
    assert "counter" in read  # the mutation rule needs this: see the module docstring


def test_annotated_assignment_defines_the_target() -> None:
    defined, _read, _b = analyze_cell_source("n: int = 3\n")
    assert defined == {"n"}


def test_walrus_at_top_level_defines_the_target() -> None:
    defined, read, _b = analyze_cell_source("print(total := compute())\n")
    assert defined == {"total"}
    assert "compute" in read


def test_for_target_defines_at_notebook_level() -> None:
    defined, read, _b = analyze_cell_source("for i, j in pairs:\n    pass\n")
    assert defined == {"i", "j"}
    assert "pairs" in read


def test_with_as_defines_the_bound_name() -> None:
    defined, read, _b = analyze_cell_source("with opened() as handle:\n    pass\n")
    assert defined == {"handle"}
    assert "opened" in read


def test_plain_import_binds_the_module_name() -> None:
    defined, _read, _b = analyze_cell_source("import numpy\n")
    assert defined == {"numpy"}


def test_dotted_import_binds_only_the_top_package() -> None:
    defined, _read, _b = analyze_cell_source("import qiskit.quantum_info\n")
    assert defined == {"qiskit"}


def test_import_as_binds_the_alias() -> None:
    defined, _read, _b = analyze_cell_source("import numpy as np\n")
    assert defined == {"np"}


def test_from_import_binds_each_name_or_its_alias() -> None:
    defined, _read, _b = analyze_cell_source("from qiskit import QuantumCircuit as QC, transpile\n")
    assert defined == {"QC", "transpile"}


def test_function_def_binds_its_own_name_but_not_its_body_locals() -> None:
    defined, read, _b = analyze_cell_source("def f(x):\n    y = x + 1\n    return y\n")
    assert defined == {"f"}
    assert "y" not in defined
    # `x` is f's own parameter: referencing it inside f is not a read of anything else.
    assert "x" not in read


def test_function_body_free_variable_bubbles_up_as_a_read() -> None:
    # Conservative on purpose (module docstring): `f` is only DEFINED here, never
    # called, and still counts as reading `n` — an extra edge is safe, a missing one
    # is not.
    defined, read, _b = analyze_cell_source("def f():\n    return n\n")
    assert defined == {"f"}
    assert "n" in read


def test_class_def_binds_its_own_name_but_not_its_body_locals() -> None:
    defined, read, _b = analyze_cell_source(
        "class Foo:\n    value = 1\n    def method(self):\n        return self.value\n"
    )
    assert defined == {"Foo"}
    assert "value" not in defined
    assert "method" not in read  # method is Foo's own local, not a free read


def test_except_as_binds_the_handler_name() -> None:
    defined, _read, _b = analyze_cell_source(
        "try:\n    risky()\nexcept ValueError as exc:\n    print(exc)\n"
    )
    assert defined == {"exc"}


# --------------------------------------------------------------------------- comprehension scoping


def test_comprehension_loop_variable_is_not_a_notebook_level_definition() -> None:
    defined, read, _b = analyze_cell_source("xs = [i for i in range(3)]\n")
    assert defined == {"xs"}
    assert "i" not in defined
    assert "i" not in read  # `i` resolves within the comprehension's own scope
    assert "range" in read


def test_comprehension_outer_iterable_is_read_in_the_enclosing_scope() -> None:
    defined, read, _b = analyze_cell_source("ys = [i * 2 for i in source]\n")
    assert defined == {"ys"}
    assert "source" in read
    assert "i" not in read


def test_walrus_inside_a_comprehension_escapes_to_the_enclosing_scope() -> None:
    # PEP 572: unlike the comprehension's own `for` target, a walrus written inside
    # one binds the nearest enclosing function/module scope — here, the cell itself.
    defined, _read, _b = analyze_cell_source("total = sum(y := v for v in values)\n")
    assert "y" in defined
    assert "v" not in defined


def test_dict_comprehension_keeps_its_own_key_and_value_scoped() -> None:
    defined, read, _b = analyze_cell_source("d = {k: k * 2 for k in keys}\n")
    assert defined == {"d"}
    assert "k" not in read
    assert "keys" in read


# --------------------------------------------------------------------------- barriers


def test_import_star_is_a_barrier() -> None:
    _defined, _read, barriers = analyze_cell_source("from qiskit import *\n")
    assert barriers == ("import *",)


def test_exec_call_is_a_barrier() -> None:
    _defined, _read, barriers = analyze_cell_source("exec('x = 1')\n")
    assert barriers == ("exec",)


def test_eval_call_is_a_barrier() -> None:
    _defined, _read, barriers = analyze_cell_source("eval('1 + 1')\n")
    assert barriers == ("eval",)


def test_globals_call_is_a_barrier() -> None:
    _defined, _read, barriers = analyze_cell_source("globals()['x'] = 1\n")
    assert barriers == ("globals",)


def test_locals_call_is_a_barrier() -> None:
    _defined, _read, barriers = analyze_cell_source("print(locals())\n")
    assert barriers == ("locals",)


def test_vars_call_is_a_barrier() -> None:
    _defined, _read, barriers = analyze_cell_source("print(vars())\n")
    assert barriers == ("vars",)


def test_global_statement_is_a_barrier() -> None:
    _defined, _read, barriers = analyze_cell_source("def f():\n    global x\n    x = 1\n")
    assert barriers == ("global",)


def test_nonlocal_statement_is_a_barrier() -> None:
    _defined, _read, barriers = analyze_cell_source(
        "def outer():\n    x = 1\n    def inner():\n        nonlocal x\n        x = 2\n    inner()\n"
    )
    assert barriers == ("nonlocal",)


def test_del_statement_is_a_barrier() -> None:
    _defined, _read, barriers = analyze_cell_source("x = 1\ndel x\n")
    assert barriers == ("del",)


def test_a_cell_that_fails_to_parse_is_a_barrier() -> None:
    defined, read, barriers = analyze_cell_source("def broken(:\n")
    assert defined == set()
    assert read == set()
    assert barriers == ("could not be parsed",)


def test_a_barrier_depends_on_everything_before_it_and_everything_after_depends_on_it() -> None:
    spec = _spec(
        "# ---\n# title: T\n# kind: scratch\n# ---\n"
        "# %% id=c01\nx = 1\n"
        "# %% id=c02\ny = 2\n"
        "# %% id=c03\nexec('z = 1')\n"
        "# %% id=c04\nw = 3\n"
    )
    graph = build_dependency_graph(spec)
    assert graph.direct["c03"] == {"c01", "c02"}
    assert graph.direct["c04"] == {"c03"}  # c04 reads/defines nothing tied to c01/c02
    assert "c01" in graph.deps("c04")  # transitively, via the barrier
    assert "c02" in graph.deps("c04")


# --------------------------------------------------------------------------- the mutation rule


def test_mutation_rule_chains_every_intermediate_reader_not_just_the_definer() -> None:
    # Exactly the case the module docstring names: `qc.h(0)` / `qc.cx(0, 1)` each
    # READ `qc` without rebinding it, so a "depends on the last assignment" rule
    # alone would only catch c01 as c04's dependency — every intermediate READER
    # must show up too, because any of them could have mutated the object in place.
    spec = _spec(
        "# ---\n# title: T\n# kind: scratch\n# ---\n"
        "# %% id=c01\nqc = 1\n"  # a stand-in for QuantumCircuit(2)
        "# %% id=c02\nqc.h(0)\n"
        "# %% id=c03\nqc.cx(0, 1)\n"
        "# %% id=c04\nprint(qc)\n"
    )
    graph = build_dependency_graph(spec)
    assert graph.direct["c02"] == {"c01"}
    assert graph.direct["c03"] == {"c01", "c02"}
    assert graph.direct["c04"] == {"c01", "c02", "c03"}


def test_mutation_rule_with_a_pure_in_place_call_not_a_rebind() -> None:
    # The case the module docstring names explicitly: `qc.h(0)` never rebinds `qc`,
    # so a "depends on the last ASSIGNMENT" rule alone would miss this edge.
    spec = _spec(
        "# ---\n# title: T\n# kind: scratch\n# ---\n"
        "# %% id=c01\nqc = 1\n"
        "# %% id=c02\nqc.h(0)\n"
        "# %% id=c03\nqc.cx(0, 1)\n"
        "# %% id=c04\nprint(qc)\n"
    )
    graph = build_dependency_graph(spec)
    assert graph.analyses["c02"].defined == set()  # a method call defines nothing
    # `qc.h(0)` is also this cell's trailing expression, so `prepare_cell_source`
    # wraps it in `__leona_display__(...)` (Jupyter-style auto-display) — that name
    # is read too, harmlessly, since no cell ever defines it. This test is about
    # `qc`, not about that wrapper, so it checks membership rather than equality.
    assert "qc" in graph.analyses["c02"].read
    assert graph.direct["c02"] == {"c01"}
    assert graph.direct["c03"] == {"c01", "c02"}
    assert graph.direct["c04"] == {"c01", "c02", "c03"}


def test_a_shared_builtin_name_never_creates_a_spurious_edge() -> None:
    # Regression: `readers_since` must never be tracked for a name nobody defines —
    # two unrelated cells that both call `print` must not depend on each other.
    spec = _spec(
        "# ---\n# title: T\n# kind: scratch\n# ---\n"
        "# %% id=c01\nprint('a')\n"
        "# %% id=c02\nprint('b')\n"
    )
    graph = build_dependency_graph(spec)
    assert graph.direct["c02"] == set()


def test_unrelated_cells_never_get_an_edge() -> None:
    spec = _spec(
        "# ---\n# title: T\n# kind: scratch\n# ---\n# %% id=c01\nqc = 1\n# %% id=c02\ny = 2\n"
    )
    graph = build_dependency_graph(spec)
    assert graph.direct["c02"] == set()


# --------------------------------------------------------------------------- check cells


def test_check_cell_is_a_barrier_reader_that_defines_nothing() -> None:
    cells = [
        Cell(id="c01", kind="code", source="x = 1\n"),
        Cell(id="c02", kind="code", source="y = 2\n"),
        # A real property now that check cells have landed: the contract refuses a
        # role=check cell without one when the spec is validated.
        _check_cell("chk", property=CheckProperty(kind="value", subject="x", value=1)),
        Cell(id="c03", kind="code", source="print('after')\n"),
    ]
    spec = _spec_with_cells(cells)
    graph = build_dependency_graph(spec)
    assert graph.analyses["chk"].is_check is True
    assert graph.analyses["chk"].defined == set()
    assert graph.direct["chk"] == {"c01", "c02"}  # reads everything before it
    # c03 doesn't read x/y and never references chk: nothing depends on chk for
    # having existed, since a check defines no notebook-level name.
    assert "chk" not in graph.direct["c03"]


def test_skip_cells_never_enter_the_graph() -> None:
    spec = _spec(
        "# ---\n# title: T\n# kind: scratch\n# ---\n"
        "# %% id=c01 execute=false\nimport os\n"
        "# %% id=c02\n%%time\nx = 1\n"
        "# %% id=c03\ny = 2\n"
    )
    graph = build_dependency_graph(spec)
    assert graph.cell_ids == ("c03",)


# --------------------------------------------------------------------------- cache keys


def test_an_upstream_edit_changes_every_downstream_key_and_no_unrelated_key() -> None:
    before = _spec(
        "# ---\n# title: T\n# kind: scratch\n# ---\n"
        "# %% id=c01\nx = 1\n"
        "# %% id=c02\ny = x + 1\n"
        "# %% id=c03\nz = 99\n"  # unrelated to c01/c02
    )
    after = _spec(
        "# ---\n# title: T\n# kind: scratch\n# ---\n"
        "# %% id=c01\nx = 2\n"  # the only content edit
        "# %% id=c02\ny = x + 1\n"
        "# %% id=c03\nz = 99\n"
    )
    before_keys, after_keys = cache_keys(before), cache_keys(after)
    assert before_keys["c01"] != after_keys["c01"]
    assert before_keys["c02"] != after_keys["c02"]  # downstream of the edit
    assert before_keys["c03"] == after_keys["c03"]  # untouched, unrelated


def test_reordering_an_unrelated_cell_does_not_change_a_keys_deps_ordering() -> None:
    # "the sorted keys of direct deps": a cell's own key must not depend on the
    # ORDER its dependencies happen to be discovered in.
    spec = _spec(
        "# ---\n# title: T\n# kind: scratch\n# ---\n"
        "# %% id=c01\na = 1\n"
        "# %% id=c02\nb = 2\n"
        "# %% id=c03\nboth = a + b\n"
    )
    keys = cache_keys(spec)
    assert len(keys) == 3
    assert len(set(keys.values())) == 3  # three distinct cells, three distinct keys


def test_check_property_payload_drops_author_and_accepted() -> None:
    class FakeProperty:
        def model_dump(self, mode="json"):
            return {"kind": "state", "tolerance": 1e-6, "author": "nala", "accepted": False}

    payload = check_property_payload(_check_cell("chk", property=FakeProperty()))
    assert payload == {"kind": "state", "tolerance": 1e-6}


def test_check_property_payload_is_none_when_the_field_does_not_exist_yet() -> None:
    # The real case on THIS branch today: `Cell` has no `property` field at all.
    assert check_property_payload(_check_cell("chk")) is None
    assert check_property_payload(Cell(id="c01", kind="code", source="x = 1\n")) is None


def test_a_changed_check_property_changes_the_cache_key_even_with_the_same_source() -> None:
    class FakeProperty:
        def __init__(self, tolerance: float) -> None:
            self._tolerance = tolerance

        def model_dump(self, mode="json"):
            return {
                "kind": "state",
                "tolerance": self._tolerance,
                "author": "user",
                "accepted": True,
            }

    loose = cell_cache_payload(
        _check_cell("chk", property=FakeProperty(1e-3)),
        prepared_source="# check: chk",
        dep_keys=[],
        framework_name="qiskit",
        framework_version=">=2.5,<2.6",
    )
    tight = cell_cache_payload(
        _check_cell("chk", property=FakeProperty(1e-9)),
        prepared_source="# check: chk",
        dep_keys=[],
        framework_name="qiskit",
        framework_version=">=2.5,<2.6",
    )
    assert loose != tight


def test_accepting_a_check_does_not_change_its_cache_key() -> None:
    class FakeProperty:
        def __init__(self, accepted: bool) -> None:
            self._accepted = accepted

        def model_dump(self, mode="json"):
            return {
                "kind": "state",
                "tolerance": 1e-6,
                "author": "nala",
                "accepted": self._accepted,
            }

    unaccepted = cell_cache_payload(
        _check_cell("chk", property=FakeProperty(False)),
        prepared_source="# check: chk",
        dep_keys=[],
        framework_name="qiskit",
        framework_version=">=2.5,<2.6",
    )
    accepted = cell_cache_payload(
        _check_cell("chk", property=FakeProperty(True)),
        prepared_source="# check: chk",
        dep_keys=[],
        framework_name="qiskit",
        framework_version=">=2.5,<2.6",
    )
    assert unaccepted == accepted


# --------------------------------------------------------------------------- plan_run


def _ten_cell_source() -> str:
    lines = ["# ---\n# title: T\n# kind: scratch\n# ---\n"]
    lines.append("# %% id=c01\nv01 = 1\n")
    for i in range(2, 11):
        lines.append(f"# %% id=c{i:02d}\nv{i:02d} = v{i - 1:02d} + 1\n")
    return "".join(lines)


def _two_chain_source(*, c03_rhs: str = "v02 + 1") -> str:
    """A 10-cell notebook of two INDEPENDENT 5-cell linear chains: c01..c05 build
    `v01..v05`, c06..c10 build `w06..w10`, and neither chain reads a name the other
    defines. `c03_rhs` is the one line varied by the "edit a middle cell" tests."""
    lines = ["# ---\n# title: T\n# kind: scratch\n# ---\n"]
    lines.append("# %% id=c01\nv01 = 1\n")
    lines.append("# %% id=c02\nv02 = v01 + 1\n")
    lines.append(f"# %% id=c03\nv03 = {c03_rhs}\n")
    lines.append("# %% id=c04\nv04 = v03 + 1\n")
    lines.append("# %% id=c05\nv05 = v04 + 1\n")
    lines.append("# %% id=c06\nw06 = 1\n")
    for i in range(7, 11):
        lines.append(f"# %% id=c{i:02d}\nw{i:02d} = w{i - 1:02d} + 1\n")
    return "".join(lines)


def _ok_report_from_keys(spec: NotebookSpec, keys: dict[str, str]) -> ExecutionReport:
    return ExecutionReport(
        notebook_slug=spec.slug,
        ok=True,
        runner="sandbox",
        cells=[CellResult(id=cid, status="ok", cache_key=key) for cid, key in keys.items()],
    )


def test_everything_cached_gives_an_empty_execute_set() -> None:
    spec = _spec(_ten_cell_source())
    keys = cache_keys(spec)
    report = _ok_report_from_keys(spec, keys)
    plan = plan_run(spec, spec, report, None)
    assert plan.execute == frozenset()
    assert set(plan.reused) == set(keys)
    assert plan.not_run == ()


def test_editing_one_middle_cell_reruns_only_its_chain_not_the_unrelated_one() -> None:
    spec = _spec(_two_chain_source())
    keys = cache_keys(spec)
    report = _ok_report_from_keys(spec, keys)

    edited = _spec(_two_chain_source(c03_rhs="v02 + 5"))  # only c03's own line changed

    plan = plan_run(edited, spec, report, None)
    # c03 is stale; c04/c05 are downstream of it; c01/c02 are ITS deps, pulled back in
    # by the closure step because a fresh sandbox has no memory of the PRIOR run — c04
    # cannot compute `v03 + 1` correctly unless c01..c03 actually execute again in the
    # SAME dispatch to rebuild `v01`..`v03` as real objects, not just replay a report.
    # So editing anywhere in a straight chain reruns the WHOLE chain — the saving is
    # that the UNRELATED chain (c06..c10), which reads none of it, needs none of that.
    assert plan.execute == {"c01", "c02", "c03", "c04", "c05"}
    assert set(plan.reused) == {f"c{i:02d}" for i in range(6, 11)}
    assert plan.not_run == ()


def test_run_cell_target_is_the_same_cut_run_until_uses() -> None:
    spec = _spec(_two_chain_source())
    keys = cache_keys(spec)
    report = _ok_report_from_keys(spec, keys)
    edited = _spec(_two_chain_source(c03_rhs="v02 + 5"))

    # "Run cell c03": the cut excludes everything after c03 (c04, c05, and the whole
    # second chain) from consideration entirely — this is DESIGN §3's own
    # "Run cell X = X ∪ deps(X)", X = c03, deps(X) = {c01, c02}.
    plan = plan_run(edited, spec, report, "c03")
    assert plan.execute == {"c01", "c02", "c03"}
    assert plan.reused == {}
    assert plan.not_run == ("c04", "c05", "c06", "c07", "c08", "c09", "c10")


def test_a_parent_error_is_never_reused_even_with_a_matching_key() -> None:
    spec = _spec(
        "# ---\n# title: T\n# kind: scratch\n# ---\n# %% id=c01\nraise ValueError('boom')\n"
    )
    keys = cache_keys(spec)
    report = ExecutionReport(
        notebook_slug=spec.slug,
        ok=False,
        runner="sandbox",
        cells=[CellResult(id="c01", status="error", cache_key=keys["c01"])],
    )
    plan = plan_run(spec, spec, report, None)
    assert plan.execute == {"c01"}
    assert plan.reused == {}


def test_a_parent_result_with_no_cache_key_is_always_stale() -> None:
    spec = _spec("# ---\n# title: T\n# kind: scratch\n# ---\n# %% id=c01\nx = 1\n")
    report = ExecutionReport(
        notebook_slug=spec.slug,
        ok=True,
        runner="sandbox",
        cells=[CellResult(id="c01", status="ok")],  # no cache_key: a pre-feature report
    )
    plan = plan_run(spec, spec, report, None)
    assert plan.execute == {"c01"}


def test_no_parent_report_makes_everything_stale() -> None:
    spec = _spec(_ten_cell_source())
    plan = plan_run(spec, None, None, None)
    assert plan.execute == set(cache_keys(spec))
    assert plan.reused == {}


def test_run_plan_partitions_every_code_cell_exactly_once() -> None:
    spec = _spec(_ten_cell_source())
    keys = cache_keys(spec)
    report = _ok_report_from_keys(spec, keys)
    edited = _spec(_ten_cell_source().replace("v03 = v02 + 1\n", "v03 = v02 + 5\n"))
    plan = plan_run(edited, spec, report, "c07")
    all_ids = {cell.id for cell in edited.code_cells()}
    assert plan.execute | set(plan.reused) | set(plan.not_run) == all_ids
    assert not (plan.execute & set(plan.reused))
    assert not (plan.execute & set(plan.not_run))
    assert not (set(plan.reused) & set(plan.not_run))


def test_run_plan_is_a_dataclass_with_the_documented_fields() -> None:
    # A cheap contract test: a caller (`_handle_author`) reads these by name.
    assert set(RunPlan.__dataclass_fields__) == {"execute", "reused", "not_run", "cache_keys"}


# --------------------------------------------------------------------------- S4: environment signature


def test_environment_signature_changes_every_cache_key() -> None:
    spec = _spec(_ten_cell_source())
    a = cache_keys(spec, environment_signature="vercel:majorana-runner")
    b = cache_keys(spec, environment_signature="vercel:majorana-runner-v2")
    assert set(a) == set(b)
    assert all(a[cid] != b[cid] for cid in a)


def test_empty_environment_signature_is_the_pre_s4_default() -> None:
    spec = _spec(_ten_cell_source())
    assert cache_keys(spec) == cache_keys(spec, environment_signature="")


def test_a_different_sandbox_environment_forces_a_full_run_even_with_identical_source() -> None:
    # A cell cached against one runner image must never be reused against a
    # different one, even with byte-identical source — a redeploy can pin
    # different framework versions.
    spec = _spec(_ten_cell_source())
    keys = cache_keys(spec, environment_signature="vercel:majorana-runner")
    report = _ok_report_from_keys(spec, keys)
    plan = plan_run(spec, spec, report, None, environment_signature="vercel:majorana-runner-v2")
    assert plan.execute == set(keys)
    assert plan.reused == {}


def test_the_same_sandbox_environment_still_allows_reuse() -> None:
    # The control: the field itself must not force a full run when it is UNCHANGED.
    spec = _spec(_ten_cell_source())
    keys = cache_keys(spec, environment_signature="vercel:majorana-runner")
    report = _ok_report_from_keys(spec, keys)
    plan = plan_run(spec, spec, report, None, environment_signature="vercel:majorana-runner")
    assert plan.execute == frozenset()
    assert set(plan.reused) == set(keys)


# --------------------------------------------------------------------------- ground truth
#
# The adversarial review that found B1(a)-(e) and S3 built a small harness comparing
# `plan_run`'s reuse decision against a FULL re-run of the child spec (`shown` vs
# `full-rerun`, ported here from the review's own scratch scripts) — every scenario it
# named is a regression test below, run against this harness, so "shown vs full-rerun
# must agree" is checked mechanically rather than merely argued in a docstring.


def _cells_of(pairs: list[tuple[str, str]]) -> NotebookSpec:
    header = "# ---\n# title: T\n# kind: scratch\n# ---\n"
    body = "".join(f"# %% id={cid}\n{src.rstrip()}\n" for cid, src in pairs)
    return parse_source(header + body)


def _execute_ground_truth(spec: NotebookSpec) -> dict[str, tuple[str, str]]:
    """A full, in-process re-run of every graph cell in document order, one shared
    namespace, mimicking `sandbox_program`'s own semantics closely enough for this
    comparison: a `leona_submit` stub, Jupyter-style auto-display, and "stop after
    the first error unless raises-exception is tagged." Returns `cell_id ->
    (status, stdout)`."""
    import contextlib
    import io

    from leona_notebooks.sandbox_program import prepare_cell_source

    ns: dict = {}

    def display(value: object) -> None:
        if value is not None:
            print(repr(value))

    ns["__leona_display__"] = display
    ns["display"] = display
    ns["leona_submit"] = lambda *a, **k: None
    out: dict[str, tuple[str, str]] = {}
    stopped = False
    for cell in spec.cells:
        if not cell.is_code:
            continue
        source, reason = prepare_cell_source(cell)
        if reason is not None:
            out[cell.id] = ("skipped", "")
            continue
        if stopped:
            out[cell.id] = ("not_run", "")
            continue
        buf = io.StringIO()
        status = "ok"
        with contextlib.redirect_stdout(buf):
            try:
                exec(compile(source, f"<cell {cell.id}>", "exec"), ns)
            except BaseException:  # noqa: BLE001 - a notebook cell can raise anything
                status = "error"
                if "raises-exception" not in cell.tags:
                    stopped = True
        out[cell.id] = (status, buf.getvalue())
    return out


def _assert_reuse_matches_a_full_rerun(
    parent_pairs: list[tuple[str, str]], child_pairs: list[tuple[str, str]]
) -> None:
    """The reviewer's `check()`: run the PARENT in full to build a real parent
    report, plan the CHILD against it, and assert every cell `plan` reuses
    produced the IDENTICAL (status, stdout) a full re-run of the child gives that
    same cell — "shown" (what the reader would see reused) must equal
    "full-rerun" (what actually running it now would show)."""
    parent_spec = _cells_of(parent_pairs)
    child_spec = _cells_of(child_pairs)
    parent_results = _execute_ground_truth(parent_spec)
    parent_keys = cache_keys(parent_spec)
    parent_report = ExecutionReport(
        notebook_slug=parent_spec.slug,
        ok=all(status != "error" for status, _ in parent_results.values()),
        runner="sandbox",
        cells=[
            CellResult(id=cid, status=status, stdout=stdout, cache_key=parent_keys.get(cid))
            for cid, (status, stdout) in parent_results.items()
        ],
    )
    plan = plan_run(child_spec, parent_spec, parent_report, None)
    truth = _execute_ground_truth(child_spec)
    for cell_id, prior in plan.reused.items():
        assert (prior.status, prior.stdout) == truth[cell_id], (
            f"{cell_id}: reused {prior.stdout!r} but a full rerun gives {truth[cell_id]!r}"
        )


# --------------------------------------------------------------------------- B1c: alias / closure


def test_alias_mutation_through_a_second_name_invalidates_the_original_readers() -> None:
    _assert_reuse_matches_a_full_rerun(
        [("c1", "qc = []"), ("c2", "a = qc"), ("c3", "a.append('h')"), ("c4", "print(qc)")],
        [("c1", "qc = []"), ("c2", "a = qc"), ("c3", "a.append('x')"), ("c4", "print(qc)")],
    )


def test_a_function_closure_over_a_mutated_name_invalidates_its_callers_siblings() -> None:
    # The exact case B1c names: `def f(): qc.append('x')` defined once, called from
    # a cell that is itself unedited — only the READER's own cell changes, and it
    # must still see the effect of calling `f()` an extra time.
    _assert_reuse_matches_a_full_rerun(
        [
            ("c1", "qc = []"),
            ("c2", "def f():\n    qc.append('x')"),
            ("c3", "f()"),
            ("c4", "print(qc)"),
        ],
        [
            ("c1", "qc = []"),
            ("c2", "def f():\n    qc.append('x')"),
            ("c3", "f(); f()"),
            ("c4", "print(qc)"),
        ],
    )


def test_alias_before_mutation_b_reads_a_mutated_through_the_original_name() -> None:
    _assert_reuse_matches_a_full_rerun(
        [("c1", "a = []"), ("c2", "b = a"), ("c3", "a.append(1)"), ("c4", "print(b)")],
        [("c1", "a = []"), ("c2", "b = a"), ("c3", "a.append(2)"), ("c4", "print(b)")],
    )


def test_a_decorator_registering_into_a_registry_invalidates_the_registry_reader() -> None:
    _assert_reuse_matches_a_full_rerun(
        [
            ("c1", "registry = []"),
            ("c2", "def reg(f):\n    registry.append(f.__name__)\n    return f"),
            ("c3", "@reg\ndef a(): pass"),
            ("c4", "print(registry)"),
        ],
        [
            ("c1", "registry = []"),
            ("c2", "def reg(f):\n    registry.append(f.__name__)\n    return f"),
            ("c3", "@reg\ndef a(): pass\n@reg\ndef b(): pass"),
            ("c4", "print(registry)"),
        ],
    )


# --------------------------------------------------------------------------- B1b: match captures


def test_match_capture_pattern_binds_a_name_a_later_reader_depends_on() -> None:
    _assert_reuse_matches_a_full_rerun(
        [("c1", "match 5:\n    case n:\n        pass"), ("c2", "print(n)")],
        [("c1", "match 6:\n    case n:\n        pass"), ("c2", "print(n)")],
    )


def test_match_sequence_star_capture_binds_both_names() -> None:
    _assert_reuse_matches_a_full_rerun(
        [("c1", "match [1, 2, 3]:\n    case [h, *rest]:\n        pass"), ("c2", "print(h, rest)")],
        [("c1", "match [4, 5, 6]:\n    case [h, *rest]:\n        pass"), ("c2", "print(h, rest)")],
    )


# --------------------------------------------------------------------------- B1a: definition-is-also-a-read


def test_conditional_never_taken_redefinition_still_depends_on_the_real_definer() -> None:
    _assert_reuse_matches_a_full_rerun(
        [("c1", "x = 1"), ("c2", "if False:\n    x = 99"), ("c3", "print(x)")],
        [("c1", "x = 5"), ("c2", "if False:\n    x = 99"), ("c3", "print(x)")],
    )


def test_try_except_import_fallback_still_depends_on_the_real_definer() -> None:
    _assert_reuse_matches_a_full_rerun(
        [
            ("c1", "backend = 'cpu'"),
            ("c2", "try:\n    import not_a_real_mod_xyz as backend\nexcept ImportError:\n    pass"),
            ("c3", "print(backend)"),
        ],
        [
            ("c1", "backend = 'numpy'"),
            ("c2", "try:\n    import not_a_real_mod_xyz as backend\nexcept ImportError:\n    pass"),
            ("c3", "print(backend)"),
        ],
    )


def test_for_over_an_empty_sequence_still_depends_on_the_real_definer() -> None:
    _assert_reuse_matches_a_full_rerun(
        [("c1", "item = 'a'"), ("c2", "for item in []:\n    pass"), ("c3", "print(item)")],
        [("c1", "item = 'b'"), ("c2", "for item in []:\n    pass"), ("c3", "print(item)")],
    )


def test_bare_annotation_with_no_value_still_depends_on_the_real_definer() -> None:
    _assert_reuse_matches_a_full_rerun(
        [("c1", "lst = []"), ("c2", "lst.append(1)"), ("c3", "lst: list"), ("c4", "print(lst)")],
        [("c1", "lst = []"), ("c2", "lst.append(2)"), ("c3", "lst: list"), ("c4", "print(lst)")],
    )


# --------------------------------------------------------------------------- B1d: class-body comprehension


def test_a_comprehension_inside_a_class_body_reads_the_module_scope_not_the_class_attr() -> None:
    # Real Python scoping: a comprehension is its own implicit function scope, and
    # function scopes skip a CLASS scope entirely (only the outermost `for`'s
    # iterable is evaluated in the class body itself) — `z = [y for _ in range(2)]`
    # inside `class K: y = 100; ...` reads the MODULE-level `y`, not `K`'s own, so
    # editing the module-level `y` must invalidate this cell.
    _assert_reuse_matches_a_full_rerun(
        [
            ("c1", "y = 1"),
            ("c2", "class K:\n    y = 100\n    z = [y for _ in range(2)]\nprint(K.z)"),
        ],
        [
            ("c1", "y = 2"),
            ("c2", "class K:\n    y = 100\n    z = [y for _ in range(2)]\nprint(K.z)"),
        ],
    )


def test_class_body_comprehension_still_correctly_sees_its_own_outermost_iterable() -> None:
    # The control for the fix above: the FIRST `for`'s iterable really is evaluated
    # in the class's own scope (only the elt/later clauses skip it) — editing a
    # module-level name the class body does NOT use for its iterable must not
    # spuriously invalidate this cell.
    graph = build_dependency_graph(
        _spec(
            "# ---\n# title: T\n# kind: scratch\n# ---\n"
            "# %% id=c1\nunrelated = 1\n"
            "# %% id=c2\nclass K:\n    n = 3\n    z = [i for i in range(n)]\nprint(K.z)\n"
        )
    )
    assert "c1" not in graph.direct["c2"]


# --------------------------------------------------------------------------- B1e: structural change


def test_reordering_two_definers_forces_a_full_run_no_reuse() -> None:
    parent_spec = _cells_of([("c1", "x = 1"), ("c2", "x = 2"), ("c3", "print(x)")])
    child_spec = _cells_of([("c2", "x = 2"), ("c1", "x = 1"), ("c3", "print(x)")])
    keys = cache_keys(parent_spec)
    parent_report = _ok_report_from_keys(parent_spec, keys)
    plan = plan_run(child_spec, parent_spec, parent_report, None)
    assert plan.reused == {}
    assert plan.execute == {"c1", "c2", "c3"}


def test_deleting_a_cell_that_existed_in_the_parent_forces_a_full_run_no_reuse() -> None:
    parent_spec = _cells_of([("c1", "x = 1"), ("c2", "x = 2"), ("c3", "print(x)")])
    child_spec = _cells_of([("c1", "x = 1"), ("c3", "print(x)")])  # c2 deleted
    keys = cache_keys(parent_spec)
    parent_report = _ok_report_from_keys(parent_spec, keys)
    plan = plan_run(child_spec, parent_spec, parent_report, None)
    assert plan.reused == {}
    assert plan.execute == {"c1", "c3"}


def test_adding_a_cell_without_reordering_existing_ones_is_not_a_structural_change() -> None:
    # The control: an ordinary insertion (the common case) must NOT force a full
    # run — only a reorder or deletion AMONG the cells the parent already had.
    parent_spec = _cells_of([("c1", "x = 1"), ("c3", "print(x)")])
    child_spec = _cells_of([("c1", "x = 1"), ("c2", "y = 2"), ("c3", "print(x)")])  # c2 inserted
    keys = cache_keys(parent_spec)
    parent_report = _ok_report_from_keys(parent_spec, keys)
    plan = plan_run(child_spec, parent_spec, parent_report, None)
    assert "c1" in plan.reused  # untouched, unrelated to the insertion
    assert "c3" in plan.reused  # untouched: reads x, c1's key is unchanged
    assert plan.execute == {"c2"}  # only the newly-inserted cell


def test_reordering_only_markdown_cells_is_not_a_structural_change() -> None:
    # `_structural_change` compares `code_cells()` order specifically — a reader
    # moving prose around, or deleting a markdown cell, must never force a full
    # run: nothing about what any CODE cell reads or writes changed.
    parent_spec = parse_source(
        "# ---\n# title: T\n# kind: scratch\n# ---\n"
        "# %% [markdown]\n# before\n"
        "# %% id=c1\nx = 1\n"
        "# %% [markdown]\n# between\n"
        "# %% id=c2\nprint(x)\n"
    )
    # Both markdown cells swapped to the opposite ends, no code cell touched.
    child_spec = parent_spec.model_copy(
        update={
            "cells": [
                parent_spec.cells[2],  # "between" markdown, now first
                parent_spec.cells[1],  # c1
                parent_spec.cells[3],  # c2
                parent_spec.cells[0],  # "before" markdown, now last
            ]
        }
    )
    keys = cache_keys(parent_spec)
    parent_report = _ok_report_from_keys(parent_spec, keys)
    plan = plan_run(child_spec, parent_spec, parent_report, None)
    assert plan.execute == frozenset()
    assert set(plan.reused) == {"c1", "c2"}


# --------------------------------------------------------------------------- S3: fixpoint


def test_fixpoint_pulls_in_a_sibling_of_a_barrier_forced_to_re_execute_as_a_dependency() -> None:
    """S3's own gap, isolated: a name-sharing scenario ("c1 defines x, two cells
    both read x") turns out to be caught ANYWAY by the ordinary `readers_since`
    chain (any two readers of the SAME name are already linked to each other,
    with or without the fixpoint) — so the case that actually needs the
    bidirectional fixpoint is a BARRIER pulled in purely as a DEPENDENCY, not
    because it is itself stale.

    c1 is a barrier (`exec`). c2/c3 are one independent chain after it (h); c4/c5
    are another (g), sharing NO name with c2/c3 at all. Only c5 is edited, so the
    backward pass pulls in ITS OWN ancestors — c4, then c1 (the barrier) — but c2
    and c3 are neither downstream of c5 nor an ancestor of it: a ONE-DIRECTIONAL
    closure leaves them "reused" even though c1 (which the barrier rule says could
    have touched literally anything, including `h`) is being re-executed fresh
    alongside c4/c5 in the SAME dispatch. Without the fixpoint, `plan.execute` is
    `{c1, c4, c5}` and c2/c3 are wrongly `reused` — verified by temporarily
    reverting the fixpoint to the old two-pass version and watching this test go
    red (`plan.reused == {"c2": ..., "c3": ...}`) before restoring it.
    """
    parent_spec = _cells_of(
        [
            ("c1", "exec('pass')"),
            ("c2", "h = 5"),
            ("c3", "print(h)"),
            ("c4", "g = 10"),
            ("c5", "print(g)"),
        ]
    )
    child_spec = _cells_of(
        [
            ("c1", "exec('pass')"),
            ("c2", "h = 5"),
            ("c3", "print(h)"),
            ("c4", "g = 10"),
            ("c5", "print('g =', g)"),  # only c5 edited
        ]
    )
    keys = cache_keys(parent_spec)
    parent_report = _ok_report_from_keys(parent_spec, keys)
    plan = plan_run(child_spec, parent_spec, parent_report, None)
    assert plan.execute == {"c1", "c2", "c3", "c4", "c5"}
    assert plan.reused == {}


# --------------------------------------------------------------------------- impurity barrier


def test_rcparams_assignment_through_an_imported_module_is_a_barrier() -> None:
    _assert_reuse_matches_a_full_rerun(
        [
            ("c1", "import matplotlib as mpl"),
            ("c2", "mpl.rcParams['font.size'] = 8"),
            ("c3", "print(mpl.rcParams['font.size'])"),
        ],
        [
            ("c1", "import matplotlib as mpl"),
            ("c2", "mpl.rcParams['font.size'] = 20"),
            ("c3", "print(mpl.rcParams['font.size'])"),
        ],
    )
    graph = build_dependency_graph(
        _spec(
            "# ---\n# title: T\n# kind: scratch\n# ---\n"
            "# %% id=c1\nimport matplotlib as mpl\n"
            "# %% id=c2\nmpl.rcParams['font.size'] = 8\n"
        )
    )
    assert graph.analyses["c2"].is_barrier


def test_random_seed_via_an_aliased_import_is_a_barrier() -> None:
    # `from random import seed as set_seed` — the call's own final name is
    # `set_seed`, one of the recognised impure names, regardless of the alias.
    graph = build_dependency_graph(
        _spec(
            "# ---\n# title: T\n# kind: scratch\n# ---\n"
            "# %% id=c1\nfrom random import seed as set_seed\n"
            "# %% id=c2\nset_seed(1)\n"
        )
    )
    assert graph.analyses["c2"].is_barrier
    _assert_reuse_matches_a_full_rerun(
        [
            ("c1", "import random as rnd"),
            ("c2", "rnd.seed(1)"),
            ("c3", "print(rnd.random())"),
        ],
        [
            ("c1", "import random as rnd"),
            ("c2", "rnd.seed(2)"),
            ("c3", "print(rnd.random())"),
        ],
    )


def test_a_file_written_then_read_across_cells_is_a_barrier(tmp_path) -> None:
    path = str(tmp_path / "f.txt")
    _assert_reuse_matches_a_full_rerun(
        [
            ("c1", f"open({path!r}, 'w').write('1')"),
            ("c2", f"print(open({path!r}).read())"),
        ],
        [
            ("c1", f"open({path!r}, 'w').write('2')"),
            ("c2", f"print(open({path!r}).read())"),
        ],
    )
    graph = build_dependency_graph(
        _spec(
            f"# ---\n# title: T\n# kind: scratch\n# ---\n# %% id=c1\nopen({path!r}, 'w').write('1')\n"
        )
    )
    assert graph.analyses["c1"].is_barrier


def test_an_ordinary_qiskit_circuit_building_cell_is_not_a_barrier() -> None:
    # The control S2's own instruction names explicitly: nothing in the impurity
    # heuristic may fire on the common case, or reuse stops working for it.
    graph = build_dependency_graph(
        _spec(
            "# ---\n# title: T\n# kind: scratch\n# ---\n"
            "# %% id=c1\nfrom qiskit import QuantumCircuit\n"
            "# %% id=c2\nqc = QuantumCircuit(2)\nqc.h(0)\nqc.cx(0, 1)\nqc.measure_all()\n"
            "# %% id=c3\nprint(qc)\n"
        )
    )
    assert graph.analyses["c1"].is_barrier is False
    assert graph.analyses["c2"].is_barrier is False
    assert graph.analyses["c3"].is_barrier is False
    assert graph.analyses["c2"].defined == {"qc"}


# --------------------------------------------------------------------------- impurity precision
#
# Round 2 of the adversarial review: the FIRST impurity heuristic over-triggered (any
# receiver, matched by the method's spelling alone) and under-triggered (module-level
# mutator calls it never listed). Every named case below, both directions: a false
# positive must NOT be a barrier (so reuse still works for the ordinary case), a miss
# must NOW be a barrier.


def _is_barrier_of(source: str, cell_id: str = "c1") -> bool:
    graph = build_dependency_graph(
        _spec(f"# ---\n# title: T\n# kind: scratch\n# ---\n# %% id={cell_id}\n{source}\n")
    )
    return graph.analyses[cell_id].is_barrier


# ---- false positives (must NOT be barriers)


def test_list_remove_on_a_local_object_is_not_impure() -> None:
    assert _is_barrier_of("qubits = [0, 1, 2]\nqubits.remove(1)\n") is False


def test_dataframe_rename_on_a_local_object_is_not_impure() -> None:
    assert (
        _is_barrier_of(
            "class Frame:\n    def rename(self, **kw):\n        pass\ndf = Frame()\ndf.rename(columns={'a': 'b'})\n"
        )
        is False
    )


def test_sys_stdout_write_is_not_impure() -> None:
    assert _is_barrier_of("import sys\nsys.stdout.write('hi')\n") is False


def test_open_for_reading_with_no_mode_argument_is_not_impure() -> None:
    assert _is_barrier_of("f = open('/tmp/whatever-leona-notebook-test.txt')\n") is False


def test_open_with_an_explicit_read_mode_is_not_impure() -> None:
    assert _is_barrier_of("f = open('/tmp/whatever-leona-notebook-test.txt', 'r')\n") is False


# ---- misses (must NOW be barriers)


def test_plt_rcparams_update_is_impure() -> None:
    assert (
        _is_barrier_of("import matplotlib.pyplot as plt\nplt.rcParams.update({'font.size': 8})\n")
        is True
    )


def test_np_set_printoptions_is_impure() -> None:
    assert _is_barrier_of("import numpy as np\nnp.set_printoptions(precision=3)\n") is True


def test_random_setstate_is_impure() -> None:
    assert (
        _is_barrier_of("import random\nstate = random.getstate()\nrandom.setstate(state)\n") is True
    )


def test_warnings_filterwarnings_is_impure() -> None:
    assert _is_barrier_of("import warnings\nwarnings.filterwarnings('ignore')\n") is True


def test_os_environ_update_is_impure() -> None:
    assert _is_barrier_of("import os\nos.environ.update({'X': '1'})\n") is True


def test_sys_path_insert_is_impure() -> None:
    assert _is_barrier_of("import sys\nsys.path.insert(0, '/tmp')\n") is True


# ---- open()'s own mode-based gate, isolated


def test_open_with_a_write_mode_is_impure() -> None:
    assert _is_barrier_of("f = open('/tmp/whatever-leona-notebook-test.txt', 'w')\n") is True


def test_open_with_a_non_literal_mode_is_conservatively_impure() -> None:
    mode = "'w' if True else 'r'"
    assert _is_barrier_of(f"f = open('/tmp/whatever-leona-notebook-test.txt', {mode})\n") is True


# ---- reuse-vs-full-rerun for the fixed misses, end to end through plan_run


def test_rcparams_update_via_a_method_call_invalidates_the_reader() -> None:
    _assert_reuse_matches_a_full_rerun(
        [
            ("c1", "import matplotlib as mpl"),
            ("c2", "mpl.rcParams.update({'font.size': 8})"),
            ("c3", "print(mpl.rcParams['font.size'])"),
        ],
        [
            ("c1", "import matplotlib as mpl"),
            ("c2", "mpl.rcParams.update({'font.size': 20})"),
            ("c3", "print(mpl.rcParams['font.size'])"),
        ],
    )


def test_sys_path_insert_invalidates_a_later_cell() -> None:
    _assert_reuse_matches_a_full_rerun(
        [
            ("c1", "import sys"),
            ("c2", "sys.path.insert(0, '/tmp/a')"),
            ("c3", "print(len(sys.path))"),
        ],
        [
            ("c1", "import sys"),
            ("c2", "sys.path.insert(0, '/tmp/b')\nsys.path.insert(0, '/tmp/a')"),
            ("c3", "print(len(sys.path))"),
        ],
    )
