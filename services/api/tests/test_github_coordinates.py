import pytest

from majorana_api.github_coordinates import (
    GITHUB_API_VERSION,
    MAX_METADATA_FILE_BYTES,
    GitHubCoordinateError,
    GitHubManifestError,
    GitHubTreeEntry,
    parse_public_github_repository,
    select_metadata_entries,
)


def _blob(path: str, *, size: int = 10, sha: str = "a" * 40) -> GitHubTreeEntry:
    return GitHubTreeEntry(path=path, mode="100644", object_type="blob", size=size, sha=sha)


def test_public_repository_coordinate_is_canonical_and_ref_is_escaped() -> None:
    coordinate = parse_public_github_repository(
        "https://github.com/mafaldaramoa/ceo-adapt-vqe.git",
        requested_ref="paper/revision 1",
    )

    assert coordinate.canonical_url == "https://github.com/mafaldaramoa/ceo-adapt-vqe"
    assert coordinate.api_repository_path == "/repos/mafaldaramoa/ceo-adapt-vqe"
    assert coordinate.api_commit_path.endswith("/commits/paper%2Frevision%201")
    assert coordinate.descriptor() == {
        "repository_url": "https://github.com/mafaldaramoa/ceo-adapt-vqe",
        "api_version": GITHUB_API_VERSION,
        "requested_ref": "paper/revision 1",
    }


@pytest.mark.parametrize(
    "url",
    [
        "http://github.com/owner/repo",
        "https://github.example/owner/repo",
        "https://api.github.com/repos/owner/repo",
        "https://user:secret@github.com/owner/repo",
        "https://github.com:443/owner/repo",
        "https://github.com:not-a-port/owner/repo",
        "https://github.com/owner/repo?ref=main",
        "https://github.com/owner/repo#readme",
        "https://github.com/owner/repo/tree/main",
        "https://github.com/owner",
        "https://github.com/owner--name/repo",
    ],
)
def test_noncanonical_or_unsafe_repository_coordinates_are_rejected(url: str) -> None:
    with pytest.raises(GitHubCoordinateError):
        parse_public_github_repository(url)


@pytest.mark.parametrize("ref", ["", " main", "main\nother"])
def test_invalid_ref_is_rejected(ref: str) -> None:
    with pytest.raises(GitHubCoordinateError):
        parse_public_github_repository("https://github.com/owner/repo", requested_ref=ref)


def test_metadata_selection_is_deterministic_and_bounded() -> None:
    selection = select_metadata_entries(
        [
            _blob("src/algorithm.py"),
            _blob(".github/workflows/test.yaml", size=20),
            _blob("requirements.txt", size=30),
            _blob("CITATION.cff", size=40),
            GitHubTreeEntry(
                path="vendor",
                mode="040000",
                object_type="tree",
                size=None,
                sha="b" * 40,
            ),
        ],
        tree_truncated=False,
    )

    assert [entry.path for entry in selection.entries] == [
        ".github/workflows/test.yaml",
        "CITATION.cff",
        "requirements.txt",
    ]
    assert selection.selected_bytes == 90


def test_oversized_metadata_is_recorded_but_not_selected() -> None:
    selection = select_metadata_entries(
        [_blob("pyproject.toml", size=MAX_METADATA_FILE_BYTES + 1)],
        tree_truncated=False,
    )

    assert selection.entries == ()
    assert selection.skipped_oversized_paths == ("pyproject.toml",)


def test_symlink_metadata_is_not_selected() -> None:
    selection = select_metadata_entries(
        [
            GitHubTreeEntry(
                path="LICENSE",
                mode="120000",
                object_type="blob",
                size=14,
                sha="a" * 40,
            )
        ],
        tree_truncated=False,
    )

    assert selection.entries == ()


def test_truncated_tree_is_rejected_instead_of_claimed_complete() -> None:
    with pytest.raises(GitHubManifestError, match="truncated"):
        select_metadata_entries([], tree_truncated=True)


@pytest.mark.parametrize(
    "entry",
    [
        _blob("../pyproject.toml"),
        _blob("/pyproject.toml"),
        _blob("pyproject.toml", sha="not-a-digest"),
        _blob("pyproject.toml", size=-1),
    ],
)
def test_invalid_tree_entries_fail_closed(entry: GitHubTreeEntry) -> None:
    with pytest.raises(GitHubManifestError):
        select_metadata_entries([entry], tree_truncated=False)
