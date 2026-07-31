"""Sanitize bounded Jupyter notebooks without executing any cell."""

from __future__ import annotations

import dataclasses
import hashlib
import json
import re
from html.parser import HTMLParser
from pathlib import PurePosixPath
from typing import Any

NOTEBOOK_EXTRACTOR_VERSION = "atlas.notebook-sanitizer.v1"
NOTEBOOK_RESULT_SCHEMA_VERSION = "atlas.notebook-extraction-result.v1"

_TOKEN_PATTERN = re.compile(r"\w+|[^\w\s]", re.UNICODE)
_BASE64_DATA_PATTERN = re.compile(r"data:[^\s,;]+(?:;[^\s,;]+)*;base64,", re.IGNORECASE)


@dataclasses.dataclass(frozen=True)
class NotebookExtractionLimits:
    max_source_bytes: int = 5 * 1024 * 1024
    max_cells: int = 200
    max_cell_source_bytes: int = 256 * 1024
    max_cell_tokens: int = 10_000
    max_total_tokens: int = 50_000
    max_json_nodes: int = 100_000
    max_json_depth: int = 40

    def __post_init__(self) -> None:
        if any(value <= 0 for value in dataclasses.astuple(self)):
            raise ValueError("all notebook limits must be positive")


@dataclasses.dataclass(frozen=True)
class NotebookCellLocator:
    path: str
    cell_index: int
    cell_type: str
    notebook_sha256: str
    original_source_sha256: str

    def as_dict(self) -> dict[str, object]:
        return dataclasses.asdict(self)


@dataclasses.dataclass(frozen=True)
class NotebookCell:
    channel: str
    sanitized_source: str
    sanitized_source_sha256: str
    lexical_token_count: int
    locator: NotebookCellLocator

    def as_dict(self) -> dict[str, object]:
        return {
            "channel": self.channel,
            "sanitized_source": self.sanitized_source,
            "sanitized_source_sha256": self.sanitized_source_sha256,
            "lexical_token_count": self.lexical_token_count,
            "locator": self.locator.as_dict(),
        }


@dataclasses.dataclass(frozen=True)
class NotebookExtractionIssue:
    code: str
    path: str
    notebook_sha256: str
    cell_index: int | None = None

    def as_dict(self) -> dict[str, object]:
        return dataclasses.asdict(self)


@dataclasses.dataclass(frozen=True)
class NotebookExtractionResult:
    schema_version: str
    extractor_version: str
    path: str
    notebook_sha256: str
    nbformat: int | None
    cells: tuple[NotebookCell, ...]
    removed_output_count: int
    total_lexical_token_count: int
    issues: tuple[NotebookExtractionIssue, ...]
    deterministic_digest: str
    execution_performed: bool = False
    publication_eligible: bool = False

    def as_dict(self) -> dict[str, object]:
        return {
            "schema_version": self.schema_version,
            "extractor_version": self.extractor_version,
            "path": self.path,
            "notebook_sha256": self.notebook_sha256,
            "nbformat": self.nbformat,
            "cells": [cell.as_dict() for cell in self.cells],
            "removed_output_count": self.removed_output_count,
            "total_lexical_token_count": self.total_lexical_token_count,
            "issues": [issue.as_dict() for issue in self.issues],
            "deterministic_digest": self.deterministic_digest,
            "execution_performed": self.execution_performed,
            "publication_eligible": self.publication_eligible,
        }


class _DuplicateKey(ValueError):
    pass


class _TextOnlyHTMLSanitizer(HTMLParser):
    """Drop all HTML markup and active script/style content from markdown."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._active_content_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        if tag.casefold() in {"script", "style", "iframe", "object", "embed"}:
            self._active_content_depth += 1

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del tag, attrs

    def handle_endtag(self, tag: str) -> None:
        if tag.casefold() in {"script", "style", "iframe", "object", "embed"}:
            self._active_content_depth = max(0, self._active_content_depth - 1)

    def handle_data(self, data: str) -> None:
        if not self._active_content_depth:
            self.parts.append(data)


def _canonical_sha256(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _valid_path(path: str) -> bool:
    if not path or len(path) > 512 or "\\" in path or "\x00" in path:
        return False
    parsed = PurePosixPath(path)
    return (
        not parsed.is_absolute()
        and parsed.suffix.casefold() == ".ipynb"
        and all(part not in {"", ".", ".."} for part in parsed.parts)
    )


def _strict_json(raw: str) -> dict[str, Any]:
    def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise _DuplicateKey
            result[key] = value
        return result

    def reject_nonfinite_constant(value: str) -> None:
        del value
        raise ValueError("nonfinite_json_number")

    parsed = json.loads(
        raw,
        object_pairs_hook=unique_object,
        parse_constant=reject_nonfinite_constant,
    )
    if not isinstance(parsed, dict):
        raise ValueError("notebook_root_not_object")
    return parsed


def _bounded_json(value: object, limits: NotebookExtractionLimits) -> str | None:
    count = 0
    stack = [(value, 1)]
    while stack:
        current, depth = stack.pop()
        count += 1
        if count > limits.max_json_nodes:
            return "json_node_limit_exceeded"
        if depth > limits.max_json_depth:
            return "json_depth_limit_exceeded"
        if isinstance(current, dict):
            stack.extend((item, depth + 1) for item in current.values())
        elif isinstance(current, list):
            stack.extend((item, depth + 1) for item in current)
    return None


def _source_text(value: object) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return "".join(value)
    return None


def _sanitize_markdown(source: str) -> str:
    parser = _TextOnlyHTMLSanitizer()
    parser.feed(source)
    parser.close()
    return "".join(parser.parts)


def _issue_result(
    path: str,
    digest: str,
    code: str,
    *,
    nbformat: int | None = None,
    cell_index: int | None = None,
) -> NotebookExtractionResult:
    issue = NotebookExtractionIssue(
        code=code,
        path=path,
        notebook_sha256=digest,
        cell_index=cell_index,
    )
    payload = {
        "schema_version": NOTEBOOK_RESULT_SCHEMA_VERSION,
        "extractor_version": NOTEBOOK_EXTRACTOR_VERSION,
        "path": path,
        "notebook_sha256": digest,
        "nbformat": nbformat,
        "cells": [],
        "removed_output_count": 0,
        "total_lexical_token_count": 0,
        "issues": [issue.as_dict()],
        "execution_performed": False,
        "publication_eligible": False,
    }
    return NotebookExtractionResult(
        schema_version=NOTEBOOK_RESULT_SCHEMA_VERSION,
        extractor_version=NOTEBOOK_EXTRACTOR_VERSION,
        path=path,
        notebook_sha256=digest,
        nbformat=nbformat,
        cells=(),
        removed_output_count=0,
        total_lexical_token_count=0,
        issues=(issue,),
        deterministic_digest=_canonical_sha256(payload),
    )


def extract_notebook(
    path: str,
    content: bytes,
    *,
    limits: NotebookExtractionLimits | None = None,
) -> NotebookExtractionResult:
    """Return sanitized code/markdown channels without executing notebook cells."""

    selected_limits = limits or NotebookExtractionLimits()
    digest = hashlib.sha256(content).hexdigest()
    if not _valid_path(path):
        return _issue_result(path, digest, "invalid_notebook_path")
    if len(content) > selected_limits.max_source_bytes:
        return _issue_result(path, digest, "notebook_size_limit_exceeded")
    try:
        raw = content.decode("utf-8")
    except UnicodeDecodeError:
        return _issue_result(path, digest, "invalid_utf8")
    try:
        notebook = _strict_json(raw)
    except _DuplicateKey:
        return _issue_result(path, digest, "duplicate_json_key")
    except (json.JSONDecodeError, ValueError, RecursionError, MemoryError):
        return _issue_result(path, digest, "invalid_notebook_json")
    json_issue = _bounded_json(notebook, selected_limits)
    if json_issue:
        return _issue_result(path, digest, json_issue)

    nbformat = notebook.get("nbformat")
    if not isinstance(nbformat, int) or isinstance(nbformat, bool) or nbformat != 4:
        return _issue_result(path, digest, "unsupported_nbformat")
    raw_cells = notebook.get("cells")
    if not isinstance(raw_cells, list):
        return _issue_result(path, digest, "invalid_cells")
    if len(raw_cells) > selected_limits.max_cells:
        return _issue_result(path, digest, "cell_count_limit_exceeded", nbformat=nbformat)

    cells: list[NotebookCell] = []
    removed_output_count = 0
    total_tokens = 0
    for index, raw_cell in enumerate(raw_cells):
        if not isinstance(raw_cell, dict):
            return _issue_result(
                path,
                digest,
                "invalid_cell",
                nbformat=nbformat,
                cell_index=index,
            )
        attachments = raw_cell.get("attachments")
        if attachments not in (None, {}):
            return _issue_result(
                path,
                digest,
                "attachments_rejected",
                nbformat=nbformat,
                cell_index=index,
            )
        cell_type = raw_cell.get("cell_type")
        if cell_type not in {"code", "markdown"}:
            return _issue_result(
                path,
                digest,
                "unsupported_cell_type",
                nbformat=nbformat,
                cell_index=index,
            )
        source = _source_text(raw_cell.get("source"))
        if source is None or "\x00" in source:
            return _issue_result(
                path,
                digest,
                "invalid_cell_source",
                nbformat=nbformat,
                cell_index=index,
            )
        source_bytes = source.encode("utf-8")
        if len(source_bytes) > selected_limits.max_cell_source_bytes:
            return _issue_result(
                path,
                digest,
                "cell_source_size_limit_exceeded",
                nbformat=nbformat,
                cell_index=index,
            )
        if _BASE64_DATA_PATTERN.search(source):
            return _issue_result(
                path,
                digest,
                "base64_source_rejected",
                nbformat=nbformat,
                cell_index=index,
            )

        sanitized = _sanitize_markdown(source) if cell_type == "markdown" else source
        tokens = len(_TOKEN_PATTERN.findall(sanitized))
        if tokens > selected_limits.max_cell_tokens:
            return _issue_result(
                path,
                digest,
                "cell_token_limit_exceeded",
                nbformat=nbformat,
                cell_index=index,
            )
        total_tokens += tokens
        if total_tokens > selected_limits.max_total_tokens:
            return _issue_result(
                path,
                digest,
                "notebook_token_limit_exceeded",
                nbformat=nbformat,
                cell_index=index,
            )

        outputs = raw_cell.get("outputs", [])
        if not isinstance(outputs, list):
            return _issue_result(
                path,
                digest,
                "invalid_outputs",
                nbformat=nbformat,
                cell_index=index,
            )
        removed_output_count += len(outputs)
        original_source_sha256 = hashlib.sha256(source_bytes).hexdigest()
        cells.append(
            NotebookCell(
                channel=cell_type,
                sanitized_source=sanitized,
                sanitized_source_sha256=hashlib.sha256(sanitized.encode("utf-8")).hexdigest(),
                lexical_token_count=tokens,
                locator=NotebookCellLocator(
                    path=path,
                    cell_index=index,
                    cell_type=cell_type,
                    notebook_sha256=digest,
                    original_source_sha256=original_source_sha256,
                ),
            )
        )

    cell_tuple = tuple(cells)
    payload = {
        "schema_version": NOTEBOOK_RESULT_SCHEMA_VERSION,
        "extractor_version": NOTEBOOK_EXTRACTOR_VERSION,
        "path": path,
        "notebook_sha256": digest,
        "nbformat": nbformat,
        "cells": [cell.as_dict() for cell in cell_tuple],
        "removed_output_count": removed_output_count,
        "total_lexical_token_count": total_tokens,
        "issues": [],
        "execution_performed": False,
        "publication_eligible": False,
    }
    return NotebookExtractionResult(
        schema_version=NOTEBOOK_RESULT_SCHEMA_VERSION,
        extractor_version=NOTEBOOK_EXTRACTOR_VERSION,
        path=path,
        notebook_sha256=digest,
        nbformat=nbformat,
        cells=cell_tuple,
        removed_output_count=removed_output_count,
        total_lexical_token_count=total_tokens,
        issues=(),
        deterministic_digest=_canonical_sha256(payload),
    )
