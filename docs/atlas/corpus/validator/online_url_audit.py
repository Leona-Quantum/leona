"""Online URL-reachability audit for the Phase 2 corpus.

NOT part of normal CI -- makes real network requests. Run manually or from a
separate, non-blocking scheduled job. See README.md in this directory.

Only reports; never edits corpus files, never raises on an unreachable URL
(publisher outages and paywalls are common and often transient) -- the
output is an audit report for a human to read, not a pass/fail gate.

Usage: python3 online_url_audit.py [--timeout SECONDS]
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path


def find_repo_root(start: Path) -> Path:
    current = start.resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists():
            return candidate
    raise RuntimeError(f"could not find repo root (no .git found walking up from {start})")


def collect_urls(corpus_root: Path) -> dict[str, list[str]]:
    """record_id -> list of URLs referenced by that record."""
    urls_by_record: dict[str, list[str]] = {}
    for subdir, id_field, url_fields in (
        ("papers", "paper_id", ["sources_verified"]),
        ("repositories", "repo_id", ["sources_verified", "repository_url", "evidence_locators"]),
    ):
        for path in sorted((corpus_root / subdir).glob("*.json")):
            record = json.loads(path.read_text())
            record_id = record.get(id_field, path.stem)
            urls: list[str] = []
            for field_name in url_fields:
                value = record.get(field_name)
                if isinstance(value, str):
                    urls.append(value)
                elif isinstance(value, list):
                    urls.extend(u for u in value if isinstance(u, str) and u.startswith("http"))
            urls_by_record[record_id] = urls
    return urls_by_record


def check_url(url: str, timeout: float) -> tuple[bool, str]:
    request = urllib.request.Request(
        url, method="HEAD", headers={"User-Agent": "majorana-corpus-audit/0.1"}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return True, f"HTTP {response.status}"
    except urllib.error.HTTPError as exc:
        # A 403/405 on HEAD often just means the server dislikes HEAD requests,
        # not that the resource is gone -- report but don't treat as fatal.
        return exc.code < 400 or exc.code in (403, 405), f"HTTP {exc.code}"
    except Exception as exc:  # noqa: BLE001 -- audit tool: report every failure, never crash the run
        return False, f"{type(exc).__name__}: {exc}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout", type=float, default=10.0)
    args = parser.parse_args()

    corpus_root = find_repo_root(Path(__file__).parent) / "docs" / "atlas" / "corpus"
    urls_by_record = collect_urls(corpus_root)

    total = 0
    unreachable: list[tuple[str, str, str]] = []
    for record_id, urls in urls_by_record.items():
        for url in urls:
            total += 1
            ok, detail = check_url(url, args.timeout)
            status = "OK" if ok else "UNREACHABLE"
            print(f"{status:12s} {record_id:35s} {detail:20s} {url}")
            if not ok:
                unreachable.append((record_id, url, detail))

    print()
    print(
        f"checked {total} URLs across {len(urls_by_record)} records; {len(unreachable)} unreachable"
    )
    if unreachable:
        print(
            "This is an audit report, not a CI gate -- review manually; do not auto-fail on this."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
