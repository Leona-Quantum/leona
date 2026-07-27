"""Deterministic evidence assertions over bounded repository metadata.

These assertions record only directly observable file presence.  They do not
infer a package version, SPDX license, scientific capability, maintenance
quality, or execution compatibility from a README or filename.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
from enum import Enum

from .github_snapshot import GitHubRepositorySnapshot
from .vqe_standard_sources import StandardSource

EXTRACTOR_VERSION = "atlas.standard-metadata-presence.v1"


class MetadataPredicate(str, Enum):
    LICENSE_FILE_PRESENT = "license_file_present"
    CITATION_FILE_PRESENT = "citation_file_present"
    DEPENDENCY_DECLARATION_PRESENT = "dependency_declaration_present"
    CI_WORKFLOW_PRESENT = "ci_workflow_present"


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
        elif predicate is MetadataPredicate.CI_WORKFLOW_PRESENT:
            matched = lowered.startswith(".github/workflows/") and lowered.endswith(
                (".yml", ".yaml")
            )
        if matched:
            matches.append((item.path, item.content_sha256))
    return tuple(sorted(matches))


def extract_metadata_assertions(
    source: StandardSource,
    snapshot: GitHubRepositorySnapshot,
) -> tuple[MetadataAssertion, ...]:
    if source.canonical_locator.casefold() != snapshot.canonical_repository_url.casefold():
        raise ValueError("snapshot repository does not match the approved source")

    assertions = []
    for predicate in MetadataPredicate:
        matches = _matching_files(snapshot, predicate)
        payload = {
            "extractor_version": EXTRACTOR_VERSION,
            "source_key": source.source_key,
            "repository_id": snapshot.repository_id,
            "commit_sha": snapshot.commit_sha,
            "predicate": predicate.value,
            "observed": bool(matches),
            "evidence_paths": [path for path, _ in matches],
            "evidence_content_sha256": [digest for _, digest in matches],
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
                assertion_sha256=digest,
            )
        )
    return tuple(assertions)
