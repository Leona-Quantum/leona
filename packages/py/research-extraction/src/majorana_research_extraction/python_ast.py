"""Deterministic Python syntax extraction without importing target code."""

from __future__ import annotations

import ast
import dataclasses
import hashlib
import json
import math
from enum import Enum
from pathlib import PurePosixPath

EXTRACTOR_VERSION = "atlas.python-ast.v1"
RESULT_SCHEMA_VERSION = "atlas.python-extraction-result.v1"


@dataclasses.dataclass(frozen=True)
class PythonExtractionLimits:
    max_source_bytes: int = 256 * 1024
    max_ast_nodes: int = 20_000
    max_ast_depth: int = 80
    max_facts: int = 4_000
    max_literal_depth: int = 12
    max_literal_items: int = 512
    max_literal_string_length: int = 4_096

    def __post_init__(self) -> None:
        if any(value <= 0 for value in dataclasses.astuple(self)):
            raise ValueError("all extraction limits must be positive")


class PythonFactKind(str, Enum):
    IMPORT = "import"
    FROM_IMPORT = "from_import"
    SYMBOL_ALIAS = "symbol_alias"
    IMPORTED_CALL = "imported_call"
    CALL_KEYWORD = "call_keyword"
    CLI_ENTRYPOINT = "cli_entrypoint"


@dataclasses.dataclass(frozen=True)
class SourceSpan:
    path: str
    node_type: str
    start_line: int
    start_col_utf8: int
    end_line: int
    end_col_utf8: int
    content_sha256: str

    def as_dict(self) -> dict[str, object]:
        return dataclasses.asdict(self)


@dataclasses.dataclass(frozen=True)
class PythonFact:
    kind: PythonFactKind
    qualified_name: str
    local_name: str | None
    keyword: str | None
    literal_json: str | None
    locator: SourceSpan
    fact_sha256: str

    def as_dict(self) -> dict[str, object]:
        return {
            "kind": self.kind.value,
            "qualified_name": self.qualified_name,
            "local_name": self.local_name,
            "keyword": self.keyword,
            "literal_json": self.literal_json,
            "locator": self.locator.as_dict(),
            "fact_sha256": self.fact_sha256,
        }


@dataclasses.dataclass(frozen=True)
class PythonExtractionIssue:
    code: str
    path: str
    content_sha256: str

    def as_dict(self) -> dict[str, str]:
        return dataclasses.asdict(self)


@dataclasses.dataclass(frozen=True)
class PythonExtractionResult:
    schema_version: str
    extractor_version: str
    path: str
    content_sha256: str
    facts: tuple[PythonFact, ...]
    issues: tuple[PythonExtractionIssue, ...]
    deterministic_digest: str
    execution_performed: bool = False

    def as_dict(self) -> dict[str, object]:
        return {
            "schema_version": self.schema_version,
            "extractor_version": self.extractor_version,
            "path": self.path,
            "content_sha256": self.content_sha256,
            "facts": [fact.as_dict() for fact in self.facts],
            "issues": [issue.as_dict() for issue in self.issues],
            "deterministic_digest": self.deterministic_digest,
            "execution_performed": self.execution_performed,
        }


def _canonical_sha256(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _valid_path(path: str) -> bool:
    if not path or len(path) > 512 or "\\" in path or "\x00" in path:
        return False
    parsed = PurePosixPath(path)
    return (
        not parsed.is_absolute()
        and parsed.suffix.casefold() == ".py"
        and all(part not in {"", ".", ".."} for part in parsed.parts)
    )


def _issue_result(path: str, digest: str, code: str) -> PythonExtractionResult:
    issue = PythonExtractionIssue(code=code, path=path, content_sha256=digest)
    payload = {
        "schema_version": RESULT_SCHEMA_VERSION,
        "extractor_version": EXTRACTOR_VERSION,
        "path": path,
        "content_sha256": digest,
        "facts": [],
        "issues": [issue.as_dict()],
        "execution_performed": False,
    }
    return PythonExtractionResult(
        schema_version=RESULT_SCHEMA_VERSION,
        extractor_version=EXTRACTOR_VERSION,
        path=path,
        content_sha256=digest,
        facts=(),
        issues=(issue,),
        deterministic_digest=_canonical_sha256(payload),
    )


def _bounded_tree(root: ast.AST, limits: PythonExtractionLimits) -> str | None:
    count = 0
    stack = [(root, 1)]
    while stack:
        node, depth = stack.pop()
        count += 1
        if count > limits.max_ast_nodes:
            return "ast_node_limit_exceeded"
        if depth > limits.max_ast_depth:
            return "ast_depth_limit_exceeded"
        stack.extend((child, depth + 1) for child in ast.iter_child_nodes(node))
    return None


def _span(path: str, digest: str, node: ast.AST) -> SourceSpan:
    return SourceSpan(
        path=path,
        node_type=type(node).__name__,
        start_line=max(1, int(getattr(node, "lineno", 1))),
        start_col_utf8=max(0, int(getattr(node, "col_offset", 0))),
        end_line=max(1, int(getattr(node, "end_lineno", getattr(node, "lineno", 1)))),
        end_col_utf8=max(
            0,
            int(getattr(node, "end_col_offset", getattr(node, "col_offset", 0))),
        ),
        content_sha256=digest,
    )


class _LiteralLimit(ValueError):
    pass


def _literal_json(node: ast.AST, limits: PythonExtractionLimits) -> str | None:
    item_count = 0

    def parse(current: ast.AST, depth: int) -> object:
        nonlocal item_count
        if depth > limits.max_literal_depth:
            raise _LiteralLimit
        item_count += 1
        if item_count > limits.max_literal_items:
            raise _LiteralLimit
        if isinstance(current, ast.Constant):
            value = current.value
            if value is None or isinstance(value, bool):
                return value
            if isinstance(value, int) and not isinstance(value, bool):
                if len(str(abs(value))) > 128:
                    raise _LiteralLimit
                return value
            if isinstance(value, float) and math.isfinite(value):
                return value
            if isinstance(value, str) and len(value) <= limits.max_literal_string_length:
                return value
            raise _LiteralLimit
        if isinstance(current, ast.UnaryOp) and isinstance(current.op, (ast.UAdd, ast.USub)):
            value = parse(current.operand, depth + 1)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise _LiteralLimit
            return value if isinstance(current.op, ast.UAdd) else -value
        if isinstance(current, (ast.List, ast.Tuple)):
            return [parse(item, depth + 1) for item in current.elts]
        if isinstance(current, ast.Dict):
            result: dict[str, object] = {}
            for key_node, value_node in zip(current.keys, current.values, strict=True):
                if key_node is None:
                    raise _LiteralLimit
                key = parse(key_node, depth + 1)
                if not isinstance(key, str) or key in result:
                    raise _LiteralLimit
                result[key] = parse(value_node, depth + 1)
            return result
        raise _LiteralLimit

    try:
        value = parse(node, 1)
    except _LiteralLimit:
        return None
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _assigned_names(node: ast.AST) -> set[str]:
    names: set[str] = set()

    def collect(current: ast.AST) -> None:
        if isinstance(current, ast.Name) and isinstance(current.ctx, (ast.Store, ast.Del)):
            names.add(current.id)
            return
        if isinstance(current, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
            return
        for child in ast.iter_child_nodes(current):
            collect(child)

    collect(node)
    return names


def _scope_local_names(node: ast.FunctionDef | ast.AsyncFunctionDef | ast.Lambda) -> set[str]:
    names = {argument.arg for argument in node.args.posonlyargs}
    names.update(argument.arg for argument in node.args.args)
    names.update(argument.arg for argument in node.args.kwonlyargs)
    if node.args.vararg:
        names.add(node.args.vararg.arg)
    if node.args.kwarg:
        names.add(node.args.kwarg.arg)
    body: list[ast.AST]
    body = list(node.body) if not isinstance(node, ast.Lambda) else [node.body]
    for statement in body:
        names.update(_assigned_names(statement))
        if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(statement.name)
        if isinstance(statement, (ast.Import, ast.ImportFrom)):
            for alias in statement.names:
                if alias.name != "*":
                    names.add(alias.asname or alias.name.split(".", 1)[0])
    global_names, nonlocal_names = _outer_declarations(body)
    return names - global_names - nonlocal_names


def _outer_declarations(body: list[ast.AST]) -> tuple[set[str], set[str]]:
    global_names: set[str] = set()
    nonlocal_names: set[str] = set()

    def collect(node: ast.AST) -> None:
        if isinstance(node, ast.Global):
            global_names.update(node.names)
            return
        if isinstance(node, ast.Nonlocal):
            nonlocal_names.update(node.names)
            return
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
            return
        for child in ast.iter_child_nodes(node):
            collect(child)

    for statement in body:
        collect(statement)
    return global_names, nonlocal_names


class _Extractor(ast.NodeVisitor):
    def __init__(self, path: str, digest: str, limits: PythonExtractionLimits):
        self.path = path
        self.digest = digest
        self.limits = limits
        self.facts: list[PythonFact] = []
        self.bindings: list[dict[str, str]] = [{}]

    def _resolve_name(self, name: str) -> str | None:
        for scope in reversed(self.bindings):
            if name in scope:
                return scope[name] or None
        return None

    def _resolve_expr(self, node: ast.AST) -> str | None:
        if isinstance(node, ast.Name):
            return self._resolve_name(node.id)
        if isinstance(node, ast.Attribute):
            base = self._resolve_expr(node.value)
            return f"{base}.{node.attr}" if base else None
        return None

    def _add(
        self,
        kind: PythonFactKind,
        qualified_name: str,
        node: ast.AST,
        *,
        local_name: str | None = None,
        keyword: str | None = None,
        literal_json: str | None = None,
    ) -> None:
        locator = _span(self.path, self.digest, node)
        payload = {
            "kind": kind.value,
            "qualified_name": qualified_name,
            "local_name": local_name,
            "keyword": keyword,
            "literal_json": literal_json,
            "locator": locator.as_dict(),
        }
        self.facts.append(
            PythonFact(
                kind=kind,
                qualified_name=qualified_name,
                local_name=local_name,
                keyword=keyword,
                literal_json=literal_json,
                locator=locator,
                fact_sha256=_canonical_sha256(payload),
            )
        )
        if len(self.facts) > self.limits.max_facts:
            raise _LiteralLimit("fact_limit_exceeded")

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            local_name = alias.asname or alias.name.split(".", 1)[0]
            resolved = alias.name if alias.asname else local_name
            self.bindings[-1][local_name] = resolved
            self._add(
                PythonFactKind.IMPORT,
                alias.name,
                alias,
                local_name=local_name,
            )

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        prefix = "." * node.level + (node.module or "")
        for alias in node.names:
            qualified_name = f"{prefix}.{alias.name}" if prefix else alias.name
            local_name = alias.asname or alias.name
            if alias.name != "*":
                self.bindings[-1][local_name] = qualified_name
            self._add(
                PythonFactKind.FROM_IMPORT,
                qualified_name,
                alias,
                local_name=local_name,
            )

    def _assign_target(self, target: ast.AST, value: ast.AST) -> None:
        if not isinstance(target, ast.Name):
            for name in _assigned_names(target):
                self.bindings[-1][name] = ""
            return
        resolved = self._resolve_expr(value)
        if resolved:
            self.bindings[-1][target.id] = resolved
            self._add(
                PythonFactKind.SYMBOL_ALIAS,
                resolved,
                target,
                local_name=target.id,
            )
        else:
            self.bindings[-1][target.id] = ""

    def visit_Assign(self, node: ast.Assign) -> None:
        self.visit(node.value)
        for target in node.targets:
            self._assign_target(target, node.value)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        if node.value is not None:
            self.visit(node.value)
            self._assign_target(node.target, node.value)
        else:
            self._assign_target(node.target, ast.Constant(None))

    def visit_NamedExpr(self, node: ast.NamedExpr) -> None:
        self.visit(node.value)
        self._assign_target(node.target, node.value)

    def visit_AugAssign(self, node: ast.AugAssign) -> None:
        self.visit(node.value)
        for name in _assigned_names(node.target):
            self.bindings[-1][name] = ""

    def visit_Delete(self, node: ast.Delete) -> None:
        for target in node.targets:
            for name in _assigned_names(target):
                self.bindings[-1][name] = ""

    def _visit_for(self, node: ast.For | ast.AsyncFor) -> None:
        self.visit(node.iter)
        for name in _assigned_names(node.target):
            self.bindings[-1][name] = ""
        for statement in (*node.body, *node.orelse):
            self.visit(statement)

    def visit_For(self, node: ast.For) -> None:
        self._visit_for(node)

    def visit_AsyncFor(self, node: ast.AsyncFor) -> None:
        self._visit_for(node)

    def _visit_with(self, node: ast.With | ast.AsyncWith) -> None:
        for item in node.items:
            self.visit(item.context_expr)
            if item.optional_vars:
                for name in _assigned_names(item.optional_vars):
                    self.bindings[-1][name] = ""
        for statement in node.body:
            self.visit(statement)

    def visit_With(self, node: ast.With) -> None:
        self._visit_with(node)

    def visit_AsyncWith(self, node: ast.AsyncWith) -> None:
        self._visit_with(node)

    def visit_ExceptHandler(self, node: ast.ExceptHandler) -> None:
        if node.type:
            self.visit(node.type)
        if node.name:
            self.bindings[-1][node.name] = ""
        for statement in node.body:
            self.visit(statement)

    def _visit_comprehension(
        self,
        generators: list[ast.comprehension],
        result_nodes: tuple[ast.AST, ...],
    ) -> None:
        if not generators:
            for result_node in result_nodes:
                self.visit(result_node)
            return
        self.visit(generators[0].iter)
        self.bindings.append(dict(self.bindings[-1]))
        for index, generator in enumerate(generators):
            if index:
                self.visit(generator.iter)
            for name in _assigned_names(generator.target):
                self.bindings[-1][name] = ""
            for condition in generator.ifs:
                self.visit(condition)
        for result_node in result_nodes:
            self.visit(result_node)
        self.bindings.pop()

    def visit_ListComp(self, node: ast.ListComp) -> None:
        self._visit_comprehension(node.generators, (node.elt,))

    def visit_SetComp(self, node: ast.SetComp) -> None:
        self._visit_comprehension(node.generators, (node.elt,))

    def visit_GeneratorExp(self, node: ast.GeneratorExp) -> None:
        self._visit_comprehension(node.generators, (node.elt,))

    def visit_DictComp(self, node: ast.DictComp) -> None:
        self._visit_comprehension(node.generators, (node.key, node.value))

    def visit_Call(self, node: ast.Call) -> None:
        qualified_name = self._resolve_expr(node.func)
        if qualified_name:
            self._add(PythonFactKind.IMPORTED_CALL, qualified_name, node.func)
            for keyword_node in node.keywords:
                keyword = keyword_node.arg if keyword_node.arg is not None else "**"
                self._add(
                    PythonFactKind.CALL_KEYWORD,
                    qualified_name,
                    keyword_node,
                    keyword=keyword,
                    literal_json=(
                        _literal_json(keyword_node.value, self.limits)
                        if keyword_node.arg is not None
                        else None
                    ),
                )
        self.generic_visit(node)

    def visit_If(self, node: ast.If) -> None:
        if _is_main_guard(node.test):
            for statement in node.body:
                for candidate in ast.walk(statement):
                    if isinstance(candidate, ast.Call):
                        callee = _syntax_name(candidate.func)
                        if callee:
                            self._add(
                                PythonFactKind.CLI_ENTRYPOINT,
                                callee,
                                candidate.func,
                            )
        self.visit(node.test)
        baseline = dict(self.bindings[-1])
        body_state = self._visit_isolated_statements(node.body, baseline)
        else_state = (
            self._visit_isolated_statements(node.orelse, baseline) if node.orelse else baseline
        )
        merged: dict[str, str] = {}
        missing = object()
        for name in body_state.keys() | else_state.keys():
            body_value = body_state.get(name, missing)
            else_value = else_state.get(name, missing)
            merged[name] = (
                body_value if isinstance(body_value, str) and body_value == else_value else ""
            )
        self.bindings[-1].clear()
        self.bindings[-1].update(merged)

    def _visit_isolated_statements(
        self,
        statements: list[ast.stmt],
        baseline: dict[str, str],
    ) -> dict[str, str]:
        self.bindings.append(dict(baseline))
        for statement in statements:
            self.visit(statement)
        return self.bindings.pop()

    def _visit_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        for decorator in node.decorator_list:
            self.visit(decorator)
        for default in (*node.args.defaults, *node.args.kw_defaults):
            if default is not None:
                self.visit(default)
        inherited = dict(self.bindings[-1])
        for name in _scope_local_names(node):
            inherited[name] = ""
        global_names, nonlocal_names = _outer_declarations(list(node.body))
        for name in global_names:
            inherited[name] = self.bindings[0].get(name, "")
        for name in nonlocal_names:
            inherited[name] = self._resolve_name(name) or ""
        self.bindings.append(inherited)
        for statement in node.body:
            self.visit(statement)
        self.bindings.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._visit_function(node)
        self.bindings[-1][node.name] = ""

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._visit_function(node)
        self.bindings[-1][node.name] = ""

    def visit_Lambda(self, node: ast.Lambda) -> None:
        inherited = dict(self.bindings[-1])
        for name in _scope_local_names(node):
            inherited[name] = ""
        self.bindings.append(inherited)
        self.visit(node.body)
        self.bindings.pop()

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        for decorator in node.decorator_list:
            self.visit(decorator)
        for base in node.bases:
            self.visit(base)
        for keyword in node.keywords:
            self.visit(keyword.value)
        self.bindings.append(dict(self.bindings[-1]))
        for statement in node.body:
            self.visit(statement)
        self.bindings.pop()
        self.bindings[-1][node.name] = ""


def _syntax_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _syntax_name(node.value)
        return f"{base}.{node.attr}" if base else None
    return None


def _is_main_guard(node: ast.AST) -> bool:
    if not isinstance(node, ast.Compare) or len(node.ops) != 1 or len(node.comparators) != 1:
        return False
    if not isinstance(node.ops[0], ast.Eq):
        return False
    left, right = node.left, node.comparators[0]
    return (
        isinstance(left, ast.Name)
        and left.id == "__name__"
        and isinstance(right, ast.Constant)
        and right.value == "__main__"
    ) or (
        isinstance(right, ast.Name)
        and right.id == "__name__"
        and isinstance(left, ast.Constant)
        and left.value == "__main__"
    )


def extract_python_source(
    path: str,
    content: bytes,
    *,
    limits: PythonExtractionLimits | None = None,
) -> PythonExtractionResult:
    """Extract bounded syntactic facts; target code is never imported or run."""

    selected_limits = limits or PythonExtractionLimits()
    digest = hashlib.sha256(content).hexdigest()
    if not _valid_path(path):
        return _issue_result(path, digest, "invalid_source_path")
    if len(content) > selected_limits.max_source_bytes:
        return _issue_result(path, digest, "source_size_limit_exceeded")
    try:
        source = content.decode("utf-8")
    except UnicodeDecodeError:
        return _issue_result(path, digest, "invalid_utf8")
    try:
        tree = ast.parse(source, filename="<untrusted-source>", mode="exec")
    except (SyntaxError, ValueError, MemoryError, RecursionError):
        return _issue_result(path, digest, "invalid_python_syntax")
    tree_issue = _bounded_tree(tree, selected_limits)
    if tree_issue:
        return _issue_result(path, digest, tree_issue)

    extractor = _Extractor(path, digest, selected_limits)
    try:
        extractor.visit(tree)
    except _LiteralLimit as exc:
        code = str(exc) if str(exc) else "extraction_limit_exceeded"
        return _issue_result(path, digest, code)

    facts = tuple(
        sorted(
            extractor.facts,
            key=lambda fact: (
                fact.locator.start_line,
                fact.locator.start_col_utf8,
                fact.kind.value,
                fact.qualified_name,
                fact.local_name or "",
                fact.keyword or "",
                fact.literal_json or "",
            ),
        )
    )
    payload = {
        "schema_version": RESULT_SCHEMA_VERSION,
        "extractor_version": EXTRACTOR_VERSION,
        "path": path,
        "content_sha256": digest,
        "facts": [fact.as_dict() for fact in facts],
        "issues": [],
        "execution_performed": False,
    }
    return PythonExtractionResult(
        schema_version=RESULT_SCHEMA_VERSION,
        extractor_version=EXTRACTOR_VERSION,
        path=path,
        content_sha256=digest,
        facts=facts,
        issues=(),
        deterministic_digest=_canonical_sha256(payload),
    )
