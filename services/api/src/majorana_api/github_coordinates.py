"""Pure input boundary for Phase 7 public GitHub metadata import.

This module performs no network or database access.  It turns the operator's
manual repository coordinate into one canonical GitHub identity and selects a
small, deterministic metadata-file subset from an already retrieved immutable
tree.  A later connector may consume this boundary; it must not weaken it into
an arbitrary URL fetcher.
"""

from __future__ import annotations

import dataclasses
import re
from collections.abc import Iterable
from urllib.parse import quote, urlsplit

GITHUB_WEB_HOST = "github.com"
GITHUB_API_HOST = "api.github.com"
GITHUB_API_VERSION = "2026-03-10"

MAX_OWNER_LENGTH = 39
MAX_REPOSITORY_LENGTH = 100
MAX_REF_LENGTH = 255
MAX_TREE_ENTRIES = 100_000
MAX_METADATA_FILES = 64
MAX_METADATA_FILE_BYTES = 256 * 1024
MAX_METADATA_TOTAL_BYTES = 2 * 1024 * 1024

_OWNER_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$")
_REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")

_EXACT_METADATA_NAMES = frozenset(
    {
        "citation.cff",
        "codemeta.json",
        "pyproject.toml",
        "setup.py",
        "setup.cfg",
        "pipfile",
        "pipfile.lock",
        "poetry.lock",
        "uv.lock",
        "environment.yml",
        "environment.yaml",
        "dockerfile",
        "license",
        "license.md",
        "license.txt",
        "copying",
        "copying.md",
        "copying.txt",
    }
)
_PREFIX_METADATA_NAMES = ("requirements",)
_WORKFLOW_PREFIX = ".github/workflows/"
_WORKFLOW_SUFFIXES = (".yml", ".yaml")


class GitHubCoordinateError(ValueError):
    """The operator input is not one canonical public GitHub coordinate."""


class GitHubManifestError(ValueError):
    """The immutable tree cannot be represented within the Phase 7 bounds."""


@dataclasses.dataclass(frozen=True)
class GitHubRepositoryCoordinate:
    owner: str
    repository: str
    requested_ref: str | None = None

    @property
    def canonical_url(self) -> str:
        return f"https://{GITHUB_WEB_HOST}/{self.owner}/{self.repository}"

    @property
    def api_repository_path(self) -> str:
        return f"/repos/{quote(self.owner, safe='')}/{quote(self.repository, safe='')}"

    @property
    def api_commit_path(self) -> str:
        ref = self.requested_ref or "HEAD"
        return f"{self.api_repository_path}/commits/{quote(ref, safe='')}"

    def descriptor(self) -> dict[str, str]:
        descriptor = {
            "repository_url": self.canonical_url,
            "api_version": GITHUB_API_VERSION,
        }
        if self.requested_ref is not None:
            descriptor["requested_ref"] = self.requested_ref
        return descriptor


@dataclasses.dataclass(frozen=True)
class GitHubTreeEntry:
    path: str
    mode: str
    object_type: str
    size: int | None
    sha: str


@dataclasses.dataclass(frozen=True)
class GitHubMetadataSelection:
    entries: tuple[GitHubTreeEntry, ...]
    selected_bytes: int
    skipped_oversized_paths: tuple[str, ...]


def parse_public_github_repository(
    repository_url: str,
    *,
    requested_ref: str | None = None,
) -> GitHubRepositoryCoordinate:
    """Parse only ``https://github.com/<owner>/<repository>`` coordinates.

    Paths naming branches, files, issues or pull requests are deliberately
    rejected.  Authentication information, ports, query strings and fragments
    are rejected instead of normalized away.
    """

    if not repository_url or repository_url != repository_url.strip():
        raise GitHubCoordinateError("repository URL must be non-empty and trimmed")
    parsed = urlsplit(repository_url)
    try:
        hostname = (parsed.hostname or "").lower()
        port = parsed.port
    except ValueError:
        raise GitHubCoordinateError("repository URL contains an invalid host or port") from None
    if parsed.scheme != "https" or hostname != GITHUB_WEB_HOST:
        raise GitHubCoordinateError("only https://github.com repositories are supported")
    if parsed.username or parsed.password or port is not None:
        raise GitHubCoordinateError("repository URL must not contain credentials or a port")
    if parsed.query or parsed.fragment:
        raise GitHubCoordinateError("repository URL must not contain a query or fragment")

    segments = [segment for segment in parsed.path.split("/") if segment]
    if len(segments) != 2:
        raise GitHubCoordinateError("repository URL must contain exactly owner/repository")
    owner, repository = segments
    if repository.endswith(".git"):
        repository = repository[:-4]
    _validate_owner(owner)
    _validate_repository(repository)

    normalized_ref = _normalize_ref(requested_ref)
    return GitHubRepositoryCoordinate(
        owner=owner,
        repository=repository,
        requested_ref=normalized_ref,
    )


def select_metadata_entries(
    entries: Iterable[GitHubTreeEntry],
    *,
    tree_truncated: bool,
) -> GitHubMetadataSelection:
    """Select bounded, non-executable metadata from an immutable Git tree.

    A truncated tree is not a complete manifest and is rejected.  Symlinks,
    submodules and directories never enter this function's result because only
    ordinary ``blob`` entries are eligible.
    """

    materialized = tuple(entries)
    if tree_truncated:
        raise GitHubManifestError("GitHub returned a truncated tree")
    if len(materialized) > MAX_TREE_ENTRIES:
        raise GitHubManifestError("tree exceeds the entry limit")

    selected: list[GitHubTreeEntry] = []
    skipped_oversized: list[str] = []
    seen_paths: set[str] = set()
    total_bytes = 0
    for entry in sorted(materialized, key=lambda candidate: candidate.path):
        _validate_tree_entry(entry)
        if entry.path in seen_paths:
            raise GitHubManifestError("tree contains a duplicate path")
        seen_paths.add(entry.path)
        if (
            entry.object_type != "blob"
            or entry.mode not in {"100644", "100755"}
            or not _is_metadata_path(entry.path)
        ):
            continue
        if entry.size is None or entry.size > MAX_METADATA_FILE_BYTES:
            skipped_oversized.append(entry.path)
            continue
        if len(selected) >= MAX_METADATA_FILES:
            raise GitHubManifestError("metadata selection exceeds the file-count limit")
        if total_bytes + entry.size > MAX_METADATA_TOTAL_BYTES:
            raise GitHubManifestError("metadata selection exceeds the total-byte limit")
        selected.append(entry)
        total_bytes += entry.size

    return GitHubMetadataSelection(
        entries=tuple(selected),
        selected_bytes=total_bytes,
        skipped_oversized_paths=tuple(skipped_oversized),
    )


def _validate_owner(owner: str) -> None:
    if len(owner) > MAX_OWNER_LENGTH or not _OWNER_RE.fullmatch(owner):
        raise GitHubCoordinateError("invalid GitHub owner")
    if "--" in owner:
        raise GitHubCoordinateError("invalid GitHub owner")


def _validate_repository(repository: str) -> None:
    if (
        not repository
        or len(repository) > MAX_REPOSITORY_LENGTH
        or not _REPOSITORY_RE.fullmatch(repository)
        or repository in {".", ".."}
    ):
        raise GitHubCoordinateError("invalid GitHub repository name")


def _normalize_ref(requested_ref: str | None) -> str | None:
    if requested_ref is None:
        return None
    if requested_ref != requested_ref.strip() or not requested_ref:
        raise GitHubCoordinateError("requested ref must be non-empty and trimmed")
    if len(requested_ref) > MAX_REF_LENGTH or _CONTROL_RE.search(requested_ref):
        raise GitHubCoordinateError("invalid requested ref")
    return requested_ref


def _validate_tree_entry(entry: GitHubTreeEntry) -> None:
    if (
        not entry.path
        or entry.path.startswith("/")
        or entry.path.endswith("/")
        or _CONTROL_RE.search(entry.path)
        or any(segment in {"", ".", ".."} for segment in entry.path.split("/"))
    ):
        raise GitHubManifestError("tree contains an invalid path")
    if entry.size is not None and entry.size < 0:
        raise GitHubManifestError("tree contains a negative file size")
    if entry.mode not in {"100644", "100755", "040000", "160000", "120000"}:
        raise GitHubManifestError("tree contains an invalid object mode")
    if not re.fullmatch(r"[0-9a-f]{40,64}", entry.sha):
        raise GitHubManifestError("tree contains an invalid object digest")


def _is_metadata_path(path: str) -> bool:
    lowered = path.lower()
    basename = lowered.rsplit("/", 1)[-1]
    if "/" not in lowered and (
        basename in _EXACT_METADATA_NAMES
        or any(basename.startswith(prefix) for prefix in _PREFIX_METADATA_NAMES)
    ):
        return True
    return lowered.startswith(_WORKFLOW_PREFIX) and lowered.endswith(_WORKFLOW_SUFFIXES)
