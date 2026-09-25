"""Pure per-cell dependency analysis for notebook replay (DESIGN §3, "Replay with a
dependency graph").

The security rule is unchanged: one fresh sandbox per execution, no persistent kernel.
What this module decides is WHICH cells belong in that one execution when a reader
edits a notebook that has already run — the way a reactive notebook such as marimo
decides it, from the names a cell defines and reads, via `ast`. It never imports
`majorana_sandbox` and touches no I/O: everything here is a function of a
`NotebookSpec` (and, for `plan_run`, a previous `ExecutionReport`).

Two rules build the graph:

1. **The mutation rule (conservative).** A cell that reads name X depends on X's most
   recent DEFINER *and* on every cell in between that also read X — because any of them
   could have mutated the object in place (`qc.h(0)` never rebinds `qc`, so "depends on
   the last assignment" alone would miss it — the `qc = QuantumCircuit(2)` / `qc.h(0)` /
   `qc.cx(0, 1)` / `print(qc)` chain in the tests is exactly this).
2. **Barriers.** A cell that could touch ANY name — `import *`, a call to
   `exec`/`eval`/`globals`/`locals`/`vars`, a `global`/`nonlocal` statement, a `del`
   statement, or a cell that fails to parse — depends on every earlier cell and is
   depended on by every later one, because static analysis cannot say which names it
   reads or writes. A cell that never runs in the sandbox at all (`runs_in_sandbox`
   False, or a `%%` cell magic) neither defines nor reads anything: it is not a graph
   cell.

`role="check"` cells (the checks lane, a sibling branch) are **barrier READERS**: they
depend on everything before them — the property's subject could be anything the
notebook has defined so far — but define nothing, so nothing depends on a check cell
for a name. Compared by string (`cell.role == "check"`) rather than an enum member,
since that role has not landed in `CellRole` on this branch. Their cache key also folds
in the check's own `property` (`CheckProperty`, also not landed here — read with
`getattr` so it is `None` today and the real value once the checks lane merges),
MINUS `author`/`accepted`: accepting a check or re-attributing it changes nothing
about what it judges, so neither may force a re-run, but a changed tolerance or
expected state must.
"""

from __future__ import annotations

import ast
import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

from leona_notebooks.execution import CellResult, ExecutionReport
from leona_notebooks.sandbox_program import UnknownCellError, prepare_cell_source
from leona_notebooks.spec import Cell, NotebookSpec

#: `Cell.role` value the checks lane uses. Not a `CellRole` member on this branch —
#: see the module docstring.
CHECK_ROLE = "check"

#: Calls that can touch any name in the enclosing namespace, wherever in the cell they
#: appear — even inside a function body, since the call happening at all (once that
#: function is invoked) is what matters, and static analysis cannot rule that out.
_BARRIER_CALLS = frozenset({"exec", "eval", "globals", "locals", "vars"})


# --------------------------------------------------------------------------- ast


def _target_names(node: ast.expr) -> set[str]:
    """Names an assignment-like target binds: a plain name, or recursively through
    tuple/list unpacking and a starred target. `obj.attr = ...` and `obj[i] = ...`
    bind no NEW name — they mutate something that already exists, which is exactly
    the mutation rule's business, not a definition's."""
    names: set[str] = set()
    stack = [node]
    while stack:
        current = stack.pop()
        if isinstance(current, ast.Name):
            names.add(current.id)
        elif isinstance(current, ast.Starred):
            stack.append(current.value)
        elif isinstance(current, (ast.Tuple, ast.List)):
            stack.extend(current.elts)
        # ast.Attribute / ast.Subscript targets: no new name, deliberately ignored.
    return names


def _param_names(args: ast.arguments) -> set[str]:
    return {
        a.arg
        for a in (
            *args.posonlyargs,
            *args.args,
            *args.kwonlyargs,
            *([args.vararg] if args.vararg is not None else []),
            *([args.kwarg] if args.kwarg is not None else []),
        )
    }


def _scope_locals(stmts: list[ast.stmt]) -> set[str]:
    """Names this scope binds DIRECTLY: assignment targets (plain/tuple/augmented/
    annotated), `for`/`async for` targets, `with`/`async with ... as` names, import
    bindings (`import x.y` binds `x`), `def`/`class` names, `except ... as` names, and
    any walrus (`:=`) target reachable from these statements — INCLUDING one written
    inside a comprehension, which PEP 572 binds to the nearest enclosing function or
    module scope, i.e. here, not to the comprehension's own scope.

    Never descends into a nested function/class/lambda BODY (their own locals are a
    separate scope) — only their decorators, base classes and default values, which
    run in THIS scope. Never treats a comprehension's own `for` target as a binding
    here either: nothing below ever visits `ast.comprehension.target` as a target, so
    a bare `[i for i in xs]` correctly never adds `i`.
    """
    names: set[str] = set()

    def visit(node: ast.AST) -> None:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            names.add(node.name)
            for default in (*node.args.defaults, *node.args.kw_defaults):
                if default is not None:
                    visit(default)
            for decorator in node.decorator_list:
                visit(decorator)
            return  # never descend into the function's own body
        if isinstance(node, ast.ClassDef):
            names.add(node.name)
            for base in node.bases:
                visit(base)
            for keyword in node.keywords:
                visit(keyword.value)
            for decorator in node.decorator_list:
                visit(decorator)
            return  # a class body's own assignments are class-scoped, not module-scoped
        if isinstance(node, ast.Lambda):
            return  # a lambda's own params/body bind nothing at this scope
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                if alias.name == "*":
                    continue  # `from x import *`: a barrier, handled separately
                names.add(alias.asname or alias.name.split(".")[0])
            return
        if isinstance(node, ast.Assign):
            for target in node.targets:
                names.update(_target_names(target))
        elif isinstance(node, (ast.AugAssign, ast.AnnAssign)):
            names.update(_target_names(node.target))
        elif isinstance(node, ast.NamedExpr):  # walrus, anywhere — escapes here
            names.update(_target_names(node.target))
        elif isinstance(node, (ast.For, ast.AsyncFor)):
            names.update(_target_names(node.target))
        elif isinstance(node, (ast.With, ast.AsyncWith)):
            for item in node.items:
                if item.optional_vars is not None:
                    names.update(_target_names(item.optional_vars))
        elif isinstance(node, ast.ExceptHandler) and node.name:
            names.add(node.name)
        elif isinstance(node, (ast.MatchAs, ast.MatchStar)) and node.name:
            names.add(node.name)
        elif isinstance(node, ast.MatchMapping) and node.rest:
            names.add(node.rest)
        for child in ast.iter_child_nodes(node):
            visit(child)

    for stmt in stmts:
        visit(stmt)
    return names


def _scope_reads(stmts: list[ast.stmt], local: frozenset[str]) -> set[str]:
    """Free reads of this scope: `Name(Load)` ids not bound in `local`, descending
    into every expression including nested function/class/lambda bodies and
    comprehensions — each recursed with its OWN local set, and every unresolved read
    bubbles all the way up to the caller's `reads` set.

    Deliberately over-inclusive for a function/lambda body: a name it references is
    folded into the DEFINING cell's reads even though the read only happens later,
    when the function is called (maybe from a different cell, maybe never). The false
    positive this can cause — an extra, unneeded dependency edge — is always safe;
    missing a real read is not, which is the direction this module is conservative in.
    A class body is different: its statements run immediately when the `class`
    statement executes, so its reads are real reads of the defining cell, not a
    later-maybe.

    `class_scope` carries the names bound by the CLASS BODY immediately enclosing
    the node being visited — never composed with an outer one, always the nearest —
    because Python's own scoping rule for a comprehension is asymmetric: the class
    body's own statements see their own class-level names (`nested_local` folded
    into `local` the way it already was), but a comprehension written directly in
    that body does NOT — a comprehension is its own implicit function scope, and
    function scopes skip over an enclosing CLASS scope entirely (they resolve
    straight through to the next enclosing function/module scope), the one
    exception being the OUTERMOST `for`'s iterable, which the class body evaluates
    itself, before the comprehension's own scope exists at all. Get this wrong
    (as this module did before) and `class K: y = 100; z = [y for _ in range(2)]`
    reads as `z = [100, 100]` when Python actually gives `[<module y>, <module y>]`
    — the class's own `y` is invisible there, and an edit to the notebook-level `y`
    silently would not invalidate a cell that, per real Python semantics, depends on
    it. Reset to empty on entering a nested function/lambda/class: those already
    build their OWN `local` from scratch (never unioned with the outer one), so they
    were never exposed to class scope in the first place and the hiding rule has
    nothing left to do there.
    """
    reads: set[str] = set()

    def visit(node: ast.AST, local: frozenset[str], class_scope: frozenset[str]) -> None:
        if isinstance(node, ast.Name):
            if isinstance(node.ctx, ast.Load) and node.id not in local:
                reads.add(node.id)
            return
        if isinstance(node, ast.AugAssign):
            # `counter += 1` reads `counter`'s PRIOR value — but `AugAssign.target`
            # carries `ctx=Store`, never `Load`, so the generic Name(Load) check above
            # can never see it; the read is implicit in the `+=` itself.
            for name in _target_names(node.target):
                if name not in local:
                    reads.add(name)
            visit(node.value, local, class_scope)
            return
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for default in (*node.args.defaults, *node.args.kw_defaults):
                if default is not None:
                    visit(default, local, class_scope)
            for decorator in node.decorator_list:
                visit(decorator, local, class_scope)
            if node.returns is not None:
                visit(node.returns, local, class_scope)
            nested_local = frozenset(_param_names(node.args) | _scope_locals(node.body))
            for stmt in node.body:
                visit(stmt, nested_local, frozenset())
            return
        if isinstance(node, ast.Lambda):
            for default in (*node.args.defaults, *node.args.kw_defaults):
                if default is not None:
                    visit(default, local, class_scope)
            nested_local = frozenset(_param_names(node.args))
            visit(node.body, nested_local, frozenset())
            return
        if isinstance(node, ast.ClassDef):
            for base in node.bases:
                visit(base, local, class_scope)
            for keyword in node.keywords:
                visit(keyword.value, local, class_scope)
            for decorator in node.decorator_list:
                visit(decorator, local, class_scope)
            nested_local = frozenset(_scope_locals(node.body))
            for stmt in node.body:
                visit(stmt, nested_local, nested_local)  # THIS class's own scope
            return
        if isinstance(node, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
            comp_local = set()
            for generator in node.generators:
                comp_local.update(_target_names(generator.target))
            # The comprehension's OWN scope (elt, conditions, every iterable but the
            # first) skips the immediately enclosing class scope, per the docstring.
            inner = (local - class_scope) | comp_local
            for index, generator in enumerate(node.generators):
                # The FIRST generator's iterable runs in the ENCLOSING scope
                # (`local`, WITH class scope still visible); everything else
                # already sees the comprehension's own bound names instead, and is
                # past the point where class scope is visible.
                if index == 0:
                    visit(generator.iter, local, class_scope)
                else:
                    visit(generator.iter, inner, frozenset())
                for condition in generator.ifs:
                    visit(condition, inner, frozenset())
            if isinstance(node, ast.DictComp):
                visit(node.key, inner, frozenset())
                visit(node.value, inner, frozenset())
            else:
                visit(node.elt, inner, frozenset())
            return
        for child in ast.iter_child_nodes(node):
            visit(child, local, class_scope)

    for stmt in stmts:
        visit(stmt, local, frozenset())
    return reads


def _barrier_reasons(tree: ast.Module) -> tuple[str, ...]:
    reasons: dict[str, None] = {}  # ordered, de-duplicated
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and any(a.name == "*" for a in node.names):
            reasons["import *"] = None
        elif isinstance(node, ast.Global):
            reasons["global"] = None
        elif isinstance(node, ast.Nonlocal):
            reasons["nonlocal"] = None
        elif isinstance(node, ast.Delete):
            reasons["del"] = None
        elif (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in _BARRIER_CALLS
        ):
            reasons[node.func.id] = None
    return tuple(reasons)


#: Final call attribute (or bare name) that marks a cell IMPURE (module/process
#: state a later cell can read, or an earlier cell can be read BY, without either
#: one naming a tracked notebook-level variable): an RNG seed, a plotting backend
#: choice, the recursion limit, the working directory, or a file/OS write. This is
#: a HEURISTIC, matched on the call's spelling alone (no type information) — see
#: `_impurity_reason`'s own docstring for exactly what it cannot see.
_IMPURE_CALL_NAMES = frozenset(
    {
        "seed",
        "set_seed",
        "manual_seed",
        "use",  # matplotlib.use(...): the plotting backend
        "setrecursionlimit",
        "chdir",
        "putenv",
        "open",
        "write",
        "writelines",
        "savefig",
        "to_csv",
        "to_json",
        "to_pickle",
        "dump",
        "save",
        "savez",
        "savetxt",
        "mkdir",
        "makedirs",
        "remove",
        "unlink",
        "rename",
        "write_text",
        "write_bytes",
    }
)


def _call_final_name(node: ast.Call) -> str | None:
    """`f(...)` -> `"f"`; `a.b.f(...)` -> `"f"`; anything else (a call through a
    subscript, a call on the result of another call, ...) -> `None` — not matched
    by this heuristic at all, which is exactly its documented blind spot."""
    func = node.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def _is_environ_setdefault(node: ast.Call) -> bool:
    """`<anything>.environ.setdefault(...)` — kept OUT of `_IMPURE_CALL_NAMES`
    because a bare `"setdefault"` is an ordinary dict method used constantly for
    reasons that have nothing to do with the environment; only the specific
    `X.environ.setdefault` shape is meant."""
    func = node.func
    return (
        isinstance(func, ast.Attribute)
        and func.attr == "setdefault"
        and isinstance(func.value, ast.Attribute)
        and func.value.attr == "environ"
    )


def _assignment_root_name(target: ast.expr) -> str | None:
    """The `Name` at the base of an attribute/subscript chain (`mpl.rcParams['x']`
    -> `"mpl"`; `os.environ['K']` -> `"os"`) — `None` for a target that has no
    single base name at all (a plain `Name`, which `_target_names` already
    handles as a real definition, not a mutation; a tuple/list unpack; a call
    result subscripted in place)."""
    node = target
    while isinstance(node, (ast.Attribute, ast.Subscript)):
        node = node.value
    return node.id if isinstance(node, ast.Name) else None


def _impurity_reason(tree: ast.Module, import_bound_names: frozenset[str]) -> str | None:
    """A cell is IMPURE — and therefore a BARRIER (module docstring: depends on
    everything before it, everything after depends on it) — when it looks, from
    its own text alone, like it sets state OUTSIDE any notebook-level variable
    this module tracks by name: an RNG seed, a plotting backend, the process's
    cwd or environment, a recursion limit, or a file/OS write. The mutation rule
    already handles `obj.attr = value` and `obj[i] = value` as reads of `obj` — the
    gap this closes is specifically LIBRARY/PROCESS state, whose readers (another
    cell that calls `plt.figure()`, say) do not have to mention `mpl`, `rcParams`,
    or anything else this cell touched, so no amount of name-based dependency
    tracking can find that edge. Marking the cell a barrier is the safe fallback:
    it re-runs whenever anything earlier changes, and forces a re-run of
    everything after it whenever IT changes, without trying to name the specific
    edge.

    Heuristic, not a proof, and this says exactly where it stops seeing: a syntax
    match on the CALL'S OWN SPELLING (`_IMPURE_CALL_NAMES`, `_is_environ_setdefault`)
    or an assignment whose root name was bound by an `import` ANYWHERE in the
    notebook (`_assignment_root_name`). It cannot see the same effect through an
    unrecognised wrapper (`my_helpers.seed_everything()`), a call reached through a
    subscript or another call's return value, or state changed inside an ordinary
    library call this list does not name — DESIGN's own residual gap (module
    docstring) is what survives this rule, nothing more.
    """
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            name = _call_final_name(node)
            if name in _IMPURE_CALL_NAMES:
                return f"looks impure: calls .{name}(...)"
            if _is_environ_setdefault(node):
                return "looks impure: calls ....environ.setdefault(...)"
        elif isinstance(node, (ast.Assign, ast.AugAssign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                root = _assignment_root_name(target)
                if root is not None and root in import_bound_names:
                    return f"looks impure: assigns into {root}...."
    return None


@dataclass(frozen=True)
class CellAnalysis:
    """One graph cell's syntactic footprint."""

    cell_id: str
    defined: frozenset[str] = frozenset()
    read: frozenset[str] = frozenset()
    barrier_reasons: tuple[str, ...] = ()
    #: `role="check"` — a barrier READER (module docstring). Mutually exclusive with
    #: `barrier_reasons` being non-empty: a check cell's trivial comment source is
    #: never analysed for barrier calls, it is simply treated as one unconditionally.
    is_check: bool = False

    @property
    def is_barrier(self) -> bool:
        return bool(self.barrier_reasons)


def analyze_cell_source(
    source: str, import_bound_names: frozenset[str] = frozenset()
) -> tuple[frozenset[str], frozenset[str], tuple[str, ...]]:
    """`(defined, read, barrier_reasons)` for one cell's PREPARED source (the exact
    text `sandbox_program` will exec — see `prepare_cell_source`). A cell that fails
    to parse is itself a barrier, per DESIGN §3. `import_bound_names` is every name
    ANY cell in the notebook binds via `import` — only used by the impurity check
    (`_impurity_reason`); a call site that never heard of the impurity heuristic
    (this module's own tests, mostly) gets it empty and simply never trips that
    branch, which is why it defaults to `frozenset()` rather than being required.
    """
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return frozenset(), frozenset(), ("could not be parsed",)
    reasons = _barrier_reasons(tree)
    if not reasons:
        impure = _impurity_reason(tree, import_bound_names)
        if impure is not None:
            reasons = (impure,)
    if reasons:
        return frozenset(), frozenset(), reasons
    defined = frozenset(_scope_locals(tree.body))
    # `defined` is folded INTO `read`, not excluded from it (the reverse of an
    # earlier version of this function, and the fix for B1a): a binding this
    # module's own static analysis cannot prove ALWAYS happens at runtime — a
    # conditional (`if False: x = 99`), a try/except import fallback, a `for`
    # over a sequence that might be empty, a bare annotation with no value — must
    # still chain back to whatever defined the name BEFORE this cell, because the
    # REAL value in effect after this cell runs might still be the earlier one.
    # Treating every definition as also a read of its own name means this cell
    # always picks up an edge to its own predecessor definer (if any) in addition
    # to becoming the new one — always safe to add (the module's own conservative
    # rule: an extra edge never hides a real change, only a missing one does), and
    # it is what makes a downstream reader's cache key transitively pick up an
    # edit to the cell that ACTUALLY still supplies the value at runtime, even
    # when this cell's own static shape makes it look like the new definer.
    read = frozenset(_scope_reads(tree.body, frozenset())) | defined
    return defined, read, ()


# --------------------------------------------------------------------------- graph


@dataclass(frozen=True)
class DependencyGraph:
    """The per-cell dependency graph of one `NotebookSpec`, built by
    `build_dependency_graph`. Edges only ever point to a STRICTLY EARLIER cell in
    document order (the mutation rule looks backward, a barrier's own dependency is
    "everything before it") — so the graph is acyclic by construction and document
    order is already a valid topological order.
    """

    #: Cells that participate at all — `runs_in_sandbox` and not a cell magic — in
    #: document order. A cell absent from this tuple neither defines nor reads.
    cell_ids: tuple[str, ...]
    analyses: dict[str, CellAnalysis]
    direct: dict[str, frozenset[str]]
    direct_downstream: dict[str, frozenset[str]] = field(repr=False)

    def direct_deps(self, cell_id: str) -> frozenset[str]:
        return self.direct.get(cell_id, frozenset())

    def deps(self, cell_id: str) -> frozenset[str]:
        """Every cell `cell_id` depends on, directly or indirectly."""
        seen: set[str] = set()
        stack = list(self.direct.get(cell_id, ()))
        while stack:
            dep = stack.pop()
            if dep in seen:
                continue
            seen.add(dep)
            stack.extend(self.direct.get(dep, ()))
        return frozenset(seen)

    def downstream(self, cell_id: str) -> frozenset[str]:
        """Every cell that depends on `cell_id`, directly or indirectly."""
        seen: set[str] = set()
        stack = list(self.direct_downstream.get(cell_id, ()))
        while stack:
            dep = stack.pop()
            if dep in seen:
                continue
            seen.add(dep)
            stack.extend(self.direct_downstream.get(dep, ()))
        return frozenset(seen)


def _import_bound_names(sources: list[str]) -> frozenset[str]:
    """Every name bound by `import`/`from ... import` ANYWHERE in these prepared
    cell sources — used only by `_impurity_reason`, to recognise "this base name is
    a reference to a library/module object" regardless of which cell imported it.
    A cell that fails to parse contributes nothing here; it is already its own
    barrier via `_barrier_reasons`, so its content plays no further part."""
    names: set[str] = set()
    for source in sources:
        try:
            tree = ast.parse(source)
        except (SyntaxError, ValueError):
            continue
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                for alias in node.names:
                    if alias.name == "*":
                        continue
                    names.add(alias.asname or alias.name.split(".")[0])
    return frozenset(names)


def build_dependency_graph(spec: NotebookSpec) -> DependencyGraph:
    graph_cells: list[Cell] = []
    for cell in spec.cells:
        if not cell.is_code:
            continue
        _source, reason = prepare_cell_source(cell)
        if reason is not None:
            continue  # execute=false, tagged skip-execution, or a %% cell magic
        graph_cells.append(cell)

    import_bound_names = _import_bound_names(
        [prepare_cell_source(cell)[0] for cell in graph_cells if cell.role != CHECK_ROLE]
    )

    order = tuple(cell.id for cell in graph_cells)
    analyses: dict[str, CellAnalysis] = {}
    direct: dict[str, set[str]] = {}
    direct_downstream: dict[str, set[str]] = {cid: set() for cid in order}

    seen_cells: list[str] = []  # every graph cell processed so far, in order
    barrier_cells: list[str] = []  # the subset that are real barriers (not checks)
    last_definer: dict[str, str] = {}
    readers_since: dict[str, list[str]] = {}
    #: name -> the (already-expanded) reads of whatever cell most recently defined
    #: it — B1c's alias/closure chain. `a = qc` makes `closure["a"] = {"qc"}`, so a
    #: LATER cell reading only "a" (`a.append(...)`) is treated as ALSO reading
    #: "qc" (`_effective_read`, below) — the two names become, for dependency
    #: purposes, one object. `def f(): qc.append(...)` gets the same treatment
    #: through the SAME mechanism: `f`'s own raw read already contains "qc" (the
    #: existing free-variable bubble-up in `_scope_reads`), so `closure["f"]` is
    #: `{"qc"}` too, and CALLING `f()` later — a plain read of the name "f" — picks
    #: up "qc" the same way a plain alias read would. One dict, two source shapes.
    closure: dict[str, frozenset[str]] = {}

    def _effective_read(raw_read: frozenset[str]) -> frozenset[str]:
        """`raw_read`, expanded one level through `closure` for every name in it.
        One level is enough: `closure[name]` is already fully expanded itself, by
        construction below (`closure[name] = <that definer's own effective read>`),
        so a chain `a = b; c = a` still resolves all the way back to whatever `b`
        itself was linked to, without this function needing to recurse."""
        expanded = set(raw_read)
        for name in raw_read:
            expanded |= closure.get(name, frozenset())
        return frozenset(expanded)

    for cell in graph_cells:
        is_check = cell.role == CHECK_ROLE
        if is_check:
            analysis = CellAnalysis(cell.id, frozenset(), frozenset(), (), is_check=True)
            deps_here: set[str] = set(seen_cells)  # a barrier READER: everything before it
        else:
            prepared_source, _ = prepare_cell_source(cell)
            defined, raw_read, reasons = analyze_cell_source(prepared_source, import_bound_names)
            read = raw_read if reasons else _effective_read(raw_read)
            analysis = CellAnalysis(cell.id, defined, read, reasons)
            deps_here = set(barrier_cells)  # every cell depends on every earlier barrier
            if reasons:
                deps_here.update(seen_cells)  # a barrier depends on everything before it
            else:
                for name in read:
                    # A name with no definer at all (a builtin like `print`, or a
                    # name no earlier cell has defined yet) creates no edge — the
                    # mutation rule is about cells sharing a NOTEBOOK-level name,
                    # not about two cells happening to call the same builtin.
                    definer = last_definer.get(name)
                    if definer is None:
                        continue
                    deps_here.add(definer)
                    deps_here.update(readers_since.get(name, ()))

        analyses[cell.id] = analysis
        direct[cell.id] = frozenset(deps_here)
        for dep in deps_here:
            direct_downstream[dep].add(cell.id)

        if not is_check:
            if analysis.is_barrier:
                barrier_cells.append(cell.id)
            else:
                for name in analysis.defined:
                    last_definer[name] = cell.id
                    readers_since[name] = []
                    closure[name] = analysis.read - {name}
                for name in analysis.read:
                    # Only track a reader for a name that is already a tracked,
                    # notebook-level definition — see the matching skip above.
                    if name in last_definer:
                        readers_since.setdefault(name, []).append(cell.id)
        seen_cells.append(cell.id)

    return DependencyGraph(
        cell_ids=order,
        analyses=analyses,
        direct=direct,
        direct_downstream={k: frozenset(v) for k, v in direct_downstream.items()},
    )


# --------------------------------------------------------------------------- cache keys


def check_property_payload(cell: Any) -> Any:
    """A check cell's `CheckProperty`, canonicalised for hashing, with `author` and
    `accepted` excluded — accepting a check, or re-attributing it, changes nothing
    about what it JUDGES, so neither may force every downstream cell to re-run.

    `getattr`, not `cell.property`: the checks lane's `property` field has not landed
    in `Cell` on this branch, so this reads back `None` here today (every non-check
    cell, and every check cell until that lane merges) and the real value once it
    has, with no change needed on this side. Takes any object with a `.property`
    attribute (or none) rather than a `Cell` specifically, so it can be exercised
    directly against a fake, duck-typed cell in a test — a real
    `Cell(role="check", property=...)` cannot be constructed here at all, since
    `CellRole` has no `"check"` member on this branch yet.
    """
    prop = getattr(cell, "property", None)
    if prop is None:
        return None
    data = prop.model_dump(mode="json") if hasattr(prop, "model_dump") else dict(prop)
    return {key: value for key, value in data.items() if key not in {"author", "accepted"}}


def cell_cache_payload(
    cell: Any,
    *,
    prepared_source: str,
    dep_keys: list[str],
    framework_name: str,
    framework_version: str,
) -> dict[str, Any]:
    """The JSON-able payload one cell's Merkle cache key hashes: prepared source,
    tags, the execute flag, the framework's name and version, the SORTED cache keys
    of its own direct dependencies (not their ids — their keys, so the hash is blind
    to a cosmetic reorder and sensitive to anything that actually changed upstream),
    and — for a `role="check"` cell only — its check property (`check_property_payload`).

    A free function, not inlined in `_cache_keys_from_graph`'s loop, so it can be
    tested directly against a fake cell without building a whole `NotebookSpec`.
    """
    payload: dict[str, Any] = {
        "source": prepared_source,
        "tags": list(cell.tags),
        "execute": cell.execute,
        "framework_name": framework_name,
        "framework_version": framework_version,
        "deps": sorted(dep_keys),
    }
    if cell.role == CHECK_ROLE:
        payload["check_property"] = check_property_payload(cell)
    return payload


def _cache_keys_from_graph(graph: DependencyGraph, spec: NotebookSpec) -> dict[str, str]:
    keys: dict[str, str] = {}
    cells_by_id = {cell.id: cell for cell in spec.cells}
    framework_name = str(spec.framework.name)
    framework_version = spec.framework.version
    for cell_id in graph.cell_ids:  # document order: every dep is already keyed
        cell = cells_by_id[cell_id]
        prepared_source, _ = prepare_cell_source(cell)
        dep_keys = [keys[dep] for dep in graph.direct_deps(cell_id)]
        payload = cell_cache_payload(
            cell,
            prepared_source=prepared_source,
            dep_keys=dep_keys,
            framework_name=framework_name,
            framework_version=framework_version,
        )
        blob = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        keys[cell_id] = hashlib.sha256(blob).hexdigest()
    return keys


def cache_keys(spec: NotebookSpec) -> dict[str, str]:
    """Every graph cell's Merkle cache key (DESIGN §3) — `cell_id -> sha256 hex
    digest`. An edit to any upstream cell changes every downstream key transitively
    (each key folds in its own direct deps' keys); an edit to an unrelated cell, or
    merely reordering one, changes no key it does not itself depend on."""
    graph = build_dependency_graph(spec)
    return _cache_keys_from_graph(graph, spec)


# --------------------------------------------------------------------------- plan_run


@dataclass(frozen=True)
class RunPlan:
    """What one author run should execute, reuse, and leave for later.

    `execute`, `reused` and (restricted to `spec.code_cells()`) `not_run` partition
    every code cell exactly once between them.
    """

    #: Cell ids to actually dispatch to the sandbox this run (unordered — the
    #: composer places them in document order itself via `only=`).
    execute: frozenset[str]
    #: Cell id -> the PARENT's own `CellResult`, to copy forward unexecuted. Still
    #: carries its original `cache_key`; the caller stamps `cached_from_seq` (this
    #: module has no notion of version numbering).
    reused: dict[str, CellResult]
    #: Code cells that will not be considered at all this run — after `target_cell_id`
    #: ("run to here"), or never eligible (execute=false, a `%%` cell magic) with
    #: nothing cached to reuse either. Document order.
    not_run: tuple[str, ...]
    #: This run's cache keys for every graph cell, so a caller never recomputes them
    #: to stamp `CellResult.cache_key` on what it executes.
    cache_keys: dict[str, str]


def _structural_change(spec: NotebookSpec, parent_spec: NotebookSpec | None) -> bool:
    """True when the code cells' relative ORDER differs from the parent, or a code
    cell that existed in the parent no longer exists in `spec` — either one makes
    the whole per-cell graph's document-order assumptions (and every cache key
    derived from it) untrustworthy enough that the simple, sound answer is a full
    re-run rather than trying to reason about what changed. This is intentionally
    coarser than the mutation-rule machinery elsewhere in this module: a reorder or
    a deletion can change what "depends on" means for cells that never touched a
    shared name at all (two cells reordered around a THIRD, unrelated one whose own
    output nonetheless now lands in a different place relative to them), which is
    exactly the class of thing name-based analysis cannot see by construction.

    `parent_spec is None` (a notebook's first save, or a caller that never resolved
    one) is NOT a structural change — `plan_run` already treats a missing parent
    REPORT as everything stale, which is the correct, simpler answer for that case.

    A cell ADDED without disturbing the relative order of the cells already there
    is not a structural change either: nothing about an existing cell's position
    relative to the OTHER existing cells moved, so the ordinary per-cell staleness
    check already has everything it needs.
    """
    if parent_spec is None:
        return False
    parent_ids = [cell.id for cell in parent_spec.code_cells()]
    child_ids = [cell.id for cell in spec.code_cells()]
    parent_id_set = set(parent_ids)
    child_id_set = set(child_ids)
    if any(cid not in child_id_set for cid in parent_ids):
        return True  # a cell that existed in the parent was deleted
    # Ignore cells ADDED in the child (not a structural change on their own):
    # compare only the RELATIVE order of cells present in both.
    common_parent_order = [cid for cid in parent_ids if cid in child_id_set]
    common_child_order = [cid for cid in child_ids if cid in parent_id_set]
    return common_parent_order != common_child_order


def plan_run(
    spec: NotebookSpec,
    parent_spec: NotebookSpec | None,
    parent_report: ExecutionReport | None,
    target_cell_id: str | None = None,
) -> RunPlan:
    """DESIGN §3's plan: a cell is STALE if its (this run's) cache key has no
    `status == "ok"` result under the same key in `parent_report`. `execute` is the
    FIXPOINT closure of the stale set under both graph directions at once —
    everything downstream of anything in `execute`, and everything any of THOSE
    depend on, repeated until nothing new is added — not a single downstream pass
    followed by a single backward pass. The two-pass version missed a real case: a
    cell pulled into `execute` only via the backward (dependency) pass can have ITS
    OWN other downstream readers that were never independently stale and are not
    downstream of the originally-stale cell either (two sibling readers of one
    nondeterministic definer, say) — those must join `execute` too, or the notebook
    re-executes the shared upstream cell with a FRESH value while a sibling reader
    keeps showing the OLD one, and the page presents two cells as consistent with
    each other when they came from two different runs. "Run cell X" is the same
    fixpoint with `target_cell_id = X` restricting `considered` to cells at or
    before X — it reads as "X ∪ deps(X)" whenever X is the only stale cell in
    range, because nothing downstream of X survives the cut.

    A parent result with `status != "ok"` is NEVER reused, whatever its key — an
    error is not a cached value to trust; a cell that raised gets another chance
    every time, on the theory that whatever made it fail might no longer be true
    (a flaky dependency, a fixed sibling cell), and there is no way to tell from the
    key alone whether it would fail the same way again. A parent result with no
    stored `cache_key` at all (every report saved before this feature shipped) is
    likewise always stale — correct, not a regression: it was never computed as a
    cache key of anything, so "matches" is not a question that has an answer.

    `parent_spec` decides one more thing before any of the above runs at all:
    `_structural_change` — a reordering or deletion among the cells the parent
    report was computed against makes the parent's cache keys untrustworthy as a
    SET (not just individually), so a structural change treats the parent as if it
    had no report at all, the same "everything stale" answer a missing parent gets.
    """
    graph = build_dependency_graph(spec)
    keys = _cache_keys_from_graph(graph, spec)

    position = {cell.id: index for index, cell in enumerate(spec.cells)}
    if target_cell_id is not None:
        if target_cell_id not in position:
            raise UnknownCellError(f"plan_run: this notebook has no cell {target_cell_id!r}")
        cut = position[target_cell_id]
        considered = tuple(cid for cid in graph.cell_ids if position[cid] <= cut)
    else:
        considered = graph.cell_ids
    considered_set = set(considered)

    parent_by_id: dict[str, Any] = (
        {}
        if _structural_change(spec, parent_spec)
        else (
            {result.id: result for result in parent_report.cells}
            if parent_report is not None
            else {}
        )
    )

    def is_stale(cell_id: str) -> bool:
        prior = parent_by_id.get(cell_id)
        if prior is None:
            return True
        if prior.status != "ok":
            return True
        if prior.cache_key is None:
            return True
        return prior.cache_key != keys.get(cell_id)

    stale = {cid for cid in considered if is_stale(cid)}
    execute: set[str] = set(stale)
    frontier = set(execute)
    while frontier:
        cid = frontier.pop()
        for dep in graph.direct_downstream.get(cid, ()):
            if dep in considered_set and dep not in execute:
                execute.add(dep)
                frontier.add(dep)
        for dep in graph.direct_deps(cid):
            if dep in considered_set and dep not in execute:
                execute.add(dep)
                frontier.add(dep)

    reused: dict[str, Any] = {
        cid: parent_by_id[cid]
        for cid in considered
        if cid not in execute
        and parent_by_id.get(cid) is not None
        and parent_by_id[cid].status == "ok"
    }

    all_code_ids = [cell.id for cell in spec.code_cells()]
    not_run = tuple(cid for cid in all_code_ids if cid not in execute and cid not in reused)

    return RunPlan(
        execute=frozenset(execute),
        reused=reused,
        not_run=not_run,
        cache_keys=keys,
    )
