"""Deterministic evidence assertions over bounded repository metadata.

These assertions record directly observable file presence and allowlisted,
declared structured metadata. They do not infer SPDX validity, scientific
capability, maintenance quality, or execution compatibility from a README,
filename, or dependency name.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import tomllib
from enum import Enum
from typing import Any

import yaml
from yaml.events import AliasEvent, CollectionEndEvent, CollectionStartEvent
from yaml.resolver import BaseResolver

from .github_snapshot import GitHubRepositorySnapshot
from .vqe_standard_sources import StandardSource

EXTRACTOR_VERSION = "atlas.standard-metadata-declared.v2"

_MAX_DECLARED_STRING_LENGTH = 4096
_MAX_DECLARED_LIST_ITEMS = 512
_MAX_YAML_EVENTS = 10_000
_MAX_YAML_DEPTH = 32


class _UniqueKeyBaseLoader(yaml.BaseLoader):
    """YAML loader that keeps scalars literal and rejects duplicate keys."""


def _construct_unique_mapping(
    loader: _UniqueKeyBaseLoader,
    node: yaml.MappingNode,
    deep: bool = False,
) -> dict[str, Any]:
    mapping: dict[str, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if not isinstance(key, str):
            raise ValueError("non_string_mapping_key")
        if key in mapping:
            raise ValueError("duplicate_mapping_key")
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


_UniqueKeyBaseLoader.add_constructor(
    BaseResolver.DEFAULT_MAPPING_TAG,
    _construct_unique_mapping,
)


class MetadataPredicate(str, Enum):
    LICENSE_FILE_PRESENT = "license_file_present"
    CITATION_FILE_PRESENT = "citation_file_present"
    DEPENDENCY_DECLARATION_PRESENT = "dependency_declaration_present"
    CONTAINER_DECLARATION_PRESENT = "container_declaration_present"
    CI_WORKFLOW_PRESENT = "ci_workflow_present"


@dataclasses.dataclass(frozen=True)
class EvidenceLocator:
    path: str
    pointer: str
    content_sha256: str

    def as_dict(self) -> dict[str, str]:
        return dataclasses.asdict(self)


@dataclasses.dataclass(frozen=True)
class DeclaredMetadataFact:
    field: str
    value: str | tuple[str, ...]
    locator: EvidenceLocator

    def as_dict(self) -> dict[str, object]:
        value: str | list[str]
        value = list(self.value) if isinstance(self.value, tuple) else self.value
        return {"field": self.field, "value": value, "locator": self.locator.as_dict()}


@dataclasses.dataclass(frozen=True)
class StructuredExtractionIssue:
    path: str
    parser: str
    code: str
    content_sha256: str

    def as_dict(self) -> dict[str, str]:
        return dataclasses.asdict(self)


@dataclasses.dataclass(frozen=True)
class MetadataAssertion:
    assertion_key: str
    extractor_version: str
    source_key: str
    repository_id: int
    commit_sha: str
    predicate: MetadataPredicate
    observed: bool
    evidence_paths: tuple[str, ...]
    evidence_content_sha256: tuple[str, ...]
    declared_facts: tuple[DeclaredMetadataFact, ...]
    extraction_issues: tuple[StructuredExtractionIssue, ...]
    assertion_sha256: str

    def as_dict(self) -> dict[str, object]:
        return {
            "assertion_key": self.assertion_key,
            "extractor_version": self.extractor_version,
            "source_key": self.source_key,
            "repository_id": self.repository_id,
            "commit_sha": self.commit_sha,
            "predicate": self.predicate.value,
            "observed": self.observed,
            "evidence_paths": list(self.evidence_paths),
            "evidence_content_sha256": list(self.evidence_content_sha256),
            "declared_facts": [item.as_dict() for item in self.declared_facts],
            "extraction_issues": [item.as_dict() for item in self.extraction_issues],
            "assertion_sha256": self.assertion_sha256,
        }


_LICENSE_NAMES = frozenset(
    {"license", "license.md", "license.txt", "copying", "copying.md", "copying.txt"}
)
_DEPENDENCY_NAMES = frozenset(
    {
        "pyproject.toml",
        "setup.py",
        "setup.cfg",
        "pipfile",
        "pipfile.lock",
        "poetry.lock",
        "uv.lock",
        "environment.yml",
        "environment.yaml",
    }
)
_CONTAINER_NAMES = frozenset({"dockerfile"})


def _canonical_sha256(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _matching_files(
    snapshot: GitHubRepositorySnapshot,
    predicate: MetadataPredicate,
) -> tuple[tuple[str, str], ...]:
    matches: list[tuple[str, str]] = []
    for item in snapshot.metadata_files:
        lowered = item.path.lower()
        basename = lowered.rsplit("/", 1)[-1]
        matched = False
        if predicate is MetadataPredicate.LICENSE_FILE_PRESENT:
            matched = "/" not in lowered and basename in _LICENSE_NAMES
        elif predicate is MetadataPredicate.CITATION_FILE_PRESENT:
            matched = "/" not in lowered and basename in {"citation.cff", "codemeta.json"}
        elif predicate is MetadataPredicate.DEPENDENCY_DECLARATION_PRESENT:
            matched = "/" not in lowered and (
                basename in _DEPENDENCY_NAMES or basename.startswith("requirements")
            )
        elif predicate is MetadataPredicate.CONTAINER_DECLARATION_PRESENT:
            matched = "/" not in lowered and basename in _CONTAINER_NAMES
        elif predicate is MetadataPredicate.CI_WORKFLOW_PRESENT:
            matched = lowered.startswith(".github/workflows/") and lowered.endswith(
                (".yml", ".yaml")
            )
        if matched:
            matches.append((item.path, item.content_sha256))
    return tuple(sorted(matches))


_CITATION_FIELDS = (
    "cff-version",
    "message",
    "title",
    "type",
    "doi",
    "repository-code",
    "url",
    "license",
    "version",
    "date-released",
)
_PYPROJECT_SCALAR_FIELDS = (
    ("project.name", ("project", "name")),
    ("project.version", ("project", "version")),
    ("project.requires-python", ("project", "requires-python")),
    ("build-system.build-backend", ("build-system", "build-backend")),
)
_PYPROJECT_LIST_FIELDS = (
    ("project.dependencies", ("project", "dependencies")),
    ("build-system.requires", ("build-system", "requires")),
)


def _pointer(parts: tuple[str, ...]) -> str:
    escaped = (part.replace("~", "~0").replace("/", "~1") for part in parts)
    return "/" + "/".join(escaped)


def _bounded_string(value: object) -> str | None:
    if not isinstance(value, str) or not value or len(value) > _MAX_DECLARED_STRING_LENGTH:
        return None
    return value


def _bounded_string_list(value: object) -> tuple[str, ...] | None:
    if not isinstance(value, list) or len(value) > _MAX_DECLARED_LIST_ITEMS:
        return None
    items = tuple(value)
    if any(_bounded_string(item) is None for item in items):
        return None
    return items


def _nested_value(document: dict[str, Any], parts: tuple[str, ...]) -> object | None:
    value: object = document
    for part in parts:
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def _facts_from_citation(
    path: str,
    content: bytes,
    content_sha256: str,
) -> tuple[tuple[DeclaredMetadataFact, ...], tuple[StructuredExtractionIssue, ...]]:
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        return (), (
            StructuredExtractionIssue(path, "citation-cff", "invalid_utf8", content_sha256),
        )
    try:
        document = _load_bounded_yaml(text)
    except (ValueError, yaml.YAMLError) as exc:
        code = str(exc) if isinstance(exc, ValueError) else "invalid_yaml"
        return (), (StructuredExtractionIssue(path, "citation-cff", code, content_sha256),)

    facts = []
    issues = []
    for field in _CITATION_FIELDS:
        declared = document.get(field)
        value = _bounded_string(declared)
        if value is not None:
            facts.append(
                DeclaredMetadataFact(
                    field=f"citation.{field}",
                    value=value,
                    locator=EvidenceLocator(path, _pointer((field,)), content_sha256),
                )
            )
        elif declared is not None:
            issues.append(
                StructuredExtractionIssue(
                    path,
                    "citation-cff",
                    f"field_not_bounded_scalar:{field}",
                    content_sha256,
                )
            )
    return tuple(facts), tuple(issues)


def _facts_from_pyproject(
    path: str,
    content: bytes,
    content_sha256: str,
) -> tuple[tuple[DeclaredMetadataFact, ...], tuple[StructuredExtractionIssue, ...]]:
    try:
        document = tomllib.loads(content.decode("utf-8"))
    except UnicodeDecodeError:
        return (), (StructuredExtractionIssue(path, "pyproject", "invalid_utf8", content_sha256),)
    except tomllib.TOMLDecodeError:
        return (), (StructuredExtractionIssue(path, "pyproject", "invalid_toml", content_sha256),)

    facts = []
    issues = []
    for field, parts in _PYPROJECT_SCALAR_FIELDS:
        declared = _nested_value(document, parts)
        value = _bounded_string(declared)
        if value is not None:
            facts.append(
                DeclaredMetadataFact(
                    field=field,
                    value=value,
                    locator=EvidenceLocator(path, _pointer(parts), content_sha256),
                )
            )
        elif declared is not None:
            issues.append(
                StructuredExtractionIssue(
                    path,
                    "pyproject",
                    f"field_not_bounded_scalar:{field}",
                    content_sha256,
                )
            )
    for field, parts in _PYPROJECT_LIST_FIELDS:
        declared = _nested_value(document, parts)
        value = _bounded_string_list(declared)
        if value is not None:
            facts.append(
                DeclaredMetadataFact(
                    field=field,
                    value=value,
                    locator=EvidenceLocator(path, _pointer(parts), content_sha256),
                )
            )
        elif declared is not None:
            issues.append(
                StructuredExtractionIssue(
                    path,
                    "pyproject",
                    f"field_not_bounded_string_list:{field}",
                    content_sha256,
                )
            )
    return tuple(facts), tuple(issues)


def _facts_from_requirements(
    path: str,
    content: bytes,
    content_sha256: str,
) -> tuple[tuple[DeclaredMetadataFact, ...], tuple[StructuredExtractionIssue, ...]]:
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        return (), (
            StructuredExtractionIssue(path, "requirements", "invalid_utf8", content_sha256),
        )

    facts = []
    issues = []
    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        declaration = raw_line.strip()
        if not declaration or declaration.startswith("#"):
            continue
        if declaration.startswith("-"):
            issues.append(
                StructuredExtractionIssue(
                    path,
                    "requirements",
                    f"unsupported_directive:line:{line_number}",
                    content_sha256,
                )
            )
            continue
        value = _bounded_string(declaration)
        if value is None:
            issues.append(
                StructuredExtractionIssue(
                    path,
                    "requirements",
                    f"declaration_out_of_bounds:line:{line_number}",
                    content_sha256,
                )
            )
            continue
        facts.append(
            DeclaredMetadataFact(
                field="requirements.declaration",
                value=value,
                locator=EvidenceLocator(
                    path,
                    _pointer(("lines", str(line_number))),
                    content_sha256,
                ),
            )
        )
    return tuple(facts), tuple(issues)


def _facts_from_dockerfile(
    path: str,
    content: bytes,
    content_sha256: str,
) -> tuple[tuple[DeclaredMetadataFact, ...], tuple[StructuredExtractionIssue, ...]]:
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        return (), (StructuredExtractionIssue(path, "dockerfile", "invalid_utf8", content_sha256),)

    facts = []
    issues = []
    allowed = {
        "FROM": "dockerfile.from",
        "CMD": "dockerfile.cmd",
        "ENTRYPOINT": "dockerfile.entrypoint",
    }
    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        instruction, separator, argument = stripped.partition(" ")
        instruction = instruction.upper()
        field = allowed.get(instruction)
        if field is None:
            continue
        if raw_line.rstrip().endswith("\\"):
            issues.append(
                StructuredExtractionIssue(
                    path,
                    "dockerfile",
                    f"unsupported_continuation:line:{line_number}",
                    content_sha256,
                )
            )
            continue
        value = _bounded_string(argument.strip()) if separator else None
        if value is None:
            issues.append(
                StructuredExtractionIssue(
                    path,
                    "dockerfile",
                    f"instruction_argument_out_of_bounds:line:{line_number}",
                    content_sha256,
                )
            )
            continue
        facts.append(
            DeclaredMetadataFact(
                field=field,
                value=value,
                locator=EvidenceLocator(
                    path,
                    _pointer(("lines", str(line_number))),
                    content_sha256,
                ),
            )
        )
    return tuple(facts), tuple(issues)


def _load_bounded_yaml(text: str) -> dict[str, Any]:
    depth = 0
    for event_index, event in enumerate(yaml.parse(text), start=1):
        if event_index > _MAX_YAML_EVENTS:
            raise ValueError("yaml_event_limit_exceeded")
        if isinstance(event, AliasEvent):
            raise ValueError("yaml_alias_rejected")
        if getattr(event, "tag", None) is not None:
            raise ValueError("yaml_explicit_tag_rejected")
        if isinstance(event, CollectionStartEvent):
            depth += 1
            if depth > _MAX_YAML_DEPTH:
                raise ValueError("yaml_depth_limit_exceeded")
        elif isinstance(event, CollectionEndEvent):
            depth -= 1
    document = yaml.load(text, Loader=_UniqueKeyBaseLoader)
    if not isinstance(document, dict):
        raise ValueError("root_not_mapping")
    return document


def _facts_from_github_actions(
    path: str,
    content: bytes,
    content_sha256: str,
) -> tuple[tuple[DeclaredMetadataFact, ...], tuple[StructuredExtractionIssue, ...]]:
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        return (), (
            StructuredExtractionIssue(path, "github-actions", "invalid_utf8", content_sha256),
        )
    try:
        document = _load_bounded_yaml(text)
    except (ValueError, yaml.YAMLError) as exc:
        code = str(exc) if isinstance(exc, ValueError) else "invalid_yaml"
        return (), (StructuredExtractionIssue(path, "github-actions", code, content_sha256),)

    facts = []
    issues = []
    name = _bounded_string(document.get("name"))
    if name is not None:
        facts.append(
            DeclaredMetadataFact(
                field="github-actions.name",
                value=name,
                locator=EvidenceLocator(path, "/name", content_sha256),
            )
        )
    elif document.get("name") is not None:
        issues.append(
            StructuredExtractionIssue(
                path,
                "github-actions",
                "field_not_bounded_scalar:name",
                content_sha256,
            )
        )

    declared_triggers = document.get("on")
    triggers: tuple[str, ...] | None = None
    if isinstance(declared_triggers, str):
        triggers = (declared_triggers,) if _bounded_string(declared_triggers) else None
    elif isinstance(declared_triggers, list):
        triggers = _bounded_string_list(declared_triggers)
    elif isinstance(declared_triggers, dict):
        triggers = _bounded_string_list(list(declared_triggers))
    if triggers is not None:
        facts.append(
            DeclaredMetadataFact(
                field="github-actions.triggers",
                value=triggers,
                locator=EvidenceLocator(path, "/on", content_sha256),
            )
        )
    elif declared_triggers is not None:
        issues.append(
            StructuredExtractionIssue(
                path,
                "github-actions",
                "field_not_bounded_trigger_declaration:on",
                content_sha256,
            )
        )
    return tuple(facts), tuple(issues)


def _structured_metadata(
    snapshot: GitHubRepositorySnapshot,
    predicate: MetadataPredicate,
) -> tuple[tuple[DeclaredMetadataFact, ...], tuple[StructuredExtractionIssue, ...]]:
    facts: list[DeclaredMetadataFact] = []
    issues: list[StructuredExtractionIssue] = []
    for item in sorted(snapshot.metadata_files, key=lambda candidate: candidate.path):
        lowered = item.path.casefold()
        if predicate is MetadataPredicate.CITATION_FILE_PRESENT and lowered == "citation.cff":
            found, found_issues = _facts_from_citation(item.path, item.content, item.content_sha256)
        elif (
            predicate is MetadataPredicate.DEPENDENCY_DECLARATION_PRESENT
            and lowered == "pyproject.toml"
        ):
            found, found_issues = _facts_from_pyproject(
                item.path, item.content, item.content_sha256
            )
        elif (
            predicate is MetadataPredicate.DEPENDENCY_DECLARATION_PRESENT
            and "/" not in lowered
            and lowered.startswith("requirements")
        ):
            found, found_issues = _facts_from_requirements(
                item.path, item.content, item.content_sha256
            )
        elif (
            predicate is MetadataPredicate.CONTAINER_DECLARATION_PRESENT and lowered == "dockerfile"
        ):
            found, found_issues = _facts_from_dockerfile(
                item.path, item.content, item.content_sha256
            )
        elif (
            predicate is MetadataPredicate.CI_WORKFLOW_PRESENT
            and lowered.startswith(".github/workflows/")
            and lowered.endswith((".yml", ".yaml"))
        ):
            found, found_issues = _facts_from_github_actions(
                item.path, item.content, item.content_sha256
            )
        else:
            continue
        facts.extend(found)
        issues.extend(found_issues)
    return (
        tuple(sorted(facts, key=lambda item: (item.locator.path, item.field))),
        tuple(sorted(issues, key=lambda item: (item.path, item.parser, item.code))),
    )


def extract_metadata_assertions(
    source: StandardSource,
    snapshot: GitHubRepositorySnapshot,
) -> tuple[MetadataAssertion, ...]:
    if source.canonical_locator.casefold() != snapshot.canonical_repository_url.casefold():
        raise ValueError("snapshot repository does not match the approved source")

    assertions = []
    for predicate in MetadataPredicate:
        matches = _matching_files(snapshot, predicate)
        declared_facts, extraction_issues = _structured_metadata(snapshot, predicate)
        payload = {
            "extractor_version": EXTRACTOR_VERSION,
            "source_key": source.source_key,
            "repository_id": snapshot.repository_id,
            "commit_sha": snapshot.commit_sha,
            "predicate": predicate.value,
            "observed": bool(matches),
            "evidence_paths": [path for path, _ in matches],
            "evidence_content_sha256": [digest for _, digest in matches],
            "declared_facts": [item.as_dict() for item in declared_facts],
            "extraction_issues": [item.as_dict() for item in extraction_issues],
        }
        digest = _canonical_sha256(payload)
        assertions.append(
            MetadataAssertion(
                assertion_key=(
                    f"{source.source_key}:{snapshot.commit_sha}:"
                    f"{EXTRACTOR_VERSION}:{predicate.value}"
                ),
                extractor_version=EXTRACTOR_VERSION,
                source_key=source.source_key,
                repository_id=snapshot.repository_id,
                commit_sha=snapshot.commit_sha,
                predicate=predicate,
                observed=bool(matches),
                evidence_paths=tuple(path for path, _ in matches),
                evidence_content_sha256=tuple(digest for _, digest in matches),
                declared_facts=declared_facts,
                extraction_issues=extraction_issues,
                assertion_sha256=digest,
            )
        )
    return tuple(assertions)
