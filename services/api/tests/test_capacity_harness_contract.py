"""The capacity harness's two halves must agree about their settings.

`bench/k6/run-capacity.sh` resolves every setting, writes it into the run's
`config.json`, and hands the target to `bench/k6/capacity.js`. But the shell and
the load generator read DIFFERENT variable names: the shell works in un-prefixed
names (`MIN_CATALOG_ENTRIES`) and every constant in capacity.js is
`__ENV.CAPACITY_<NAME>`. Nothing connected the two, so a default resolved in the
shell never reached k6 — it fell back to its own copy, and `config.json` recorded
a value that was not applied.

That was invisible while the two sets of defaults happened to match, and they
mostly did. The one that diverged is the one that matters: the catalogue floor
was raised to 300 in the shell and capacity.js still defaults it to 1, so a
result file claimed a floor of 300 over a run that would have accepted a single
record — and a capacity number measured against one record is not a capacity
number.

This test lives here rather than beside the harness because `bench/` is not in
`testpaths` and this is the suite CI actually runs (`uv run pytest -q`). It reads
source files, which `test_database_configuration.py` already does for the same
reason: the coupling is between two files in two languages, and only a third
file can see it.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
RUNNER = REPO_ROOT / "bench" / "k6" / "run-capacity.sh"
PROFILE = REPO_ROOT / "bench" / "k6" / "capacity.js"

#: Settings capacity.js reads from the caller rather than from the harness.
#: `API_TOKEN` and `BASE_URL` are not `CAPACITY_`-prefixed; the approval
#: variables are the operator's to set and must NOT be re-exported by the
#: runner, which is the whole point of an acknowledgement.
_OPERATOR_OWNED = {
    "CAPACITY_SCENARIO",
    "CAPACITY_SSE_RUN_ID",
    "CAPACITY_RUN_PREFIX",
    "CAPACITY_ALLOW_NONLOCAL_TARGET",
    "CAPACITY_NONLOCAL_TARGET_APPROVAL",
    "CAPACITY_ALLOW_PRODUCTION",
    "CAPACITY_PRODUCTION_TARGET_APPROVAL",
    "CAPACITY_ALLOW_WRITES",
    "CAPACITY_WRITE_APPROVAL",
    "CAPACITY_ALLOW_TERMINAL_SSE",
}


def _profile_env_names() -> set[str]:
    source = PROFILE.read_text(encoding="utf-8")
    direct = set(re.findall(r"__ENV\.(CAPACITY_[A-Z0-9_]+)", source))
    helpers = set(
        re.findall(r'(?:positiveInteger|nonNegativeInteger)\(\s*"(CAPACITY_[A-Z0-9_]+)"', source)
    )
    return direct | helpers


def _runner_exports() -> set[str]:
    source = RUNNER.read_text(encoding="utf-8")
    return set(re.findall(r"^export (CAPACITY_[A-Z0-9_]+)=", source, flags=re.MULTILINE))


def test_the_extraction_finds_something_to_compare() -> None:
    """A regex that matched nothing would make every assertion below vacuous."""
    assert RUNNER.exists(), f"{RUNNER} moved — this test is guarding nothing"
    assert PROFILE.exists(), f"{PROFILE} moved — this test is guarding nothing"
    assert len(_profile_env_names()) >= 8, "the capacity.js env scan is broken, not empty"


def test_every_setting_k6_reads_is_exported_by_the_runner() -> None:
    """The gap this test exists for.

    A setting capacity.js reads and the runner never exports is a number the
    operator can only change by knowing both names — and one the result file
    will misreport, because config.json is written from the runner's copy.
    """
    missing = sorted(_profile_env_names() - _OPERATOR_OWNED - _runner_exports())
    assert missing == [], (
        "capacity.js reads these and run-capacity.sh never exports them, so the "
        "harness's resolved value is recorded in config.json and NOT applied: "
        f"{missing}"
    )


def test_the_catalogue_floor_reaches_the_load_generator() -> None:
    """The specific divergence, pinned by name.

    The general assertion above would keep passing if someone re-exported the
    variable and then changed the shell default without changing the JS one, so
    this asserts the value rather than the wiring.
    """
    runner = RUNNER.read_text(encoding="utf-8")
    shell_default = re.search(
        r'MIN_CATALOG_ENTRIES="\$\{CAPACITY_MIN_CATALOG_ENTRIES:-(\d+)\}"', runner
    )
    assert shell_default, "the catalogue floor's default moved or was renamed"
    assert int(shell_default.group(1)) > 1, (
        "a floor of 1 lets the profile print CAPACITY SUITE PASSED against a "
        "one-record catalogue, which is what a half-finished local import leaves"
    )
    assert 'export CAPACITY_MIN_CATALOG_ENTRIES="$MIN_CATALOG_ENTRIES"' in runner


def test_the_production_guard_names_a_host_that_exists() -> None:
    """The guard is only a guard if it covers the real production hostname.

    It named `api.leonaquantum.com`, which does not resolve and never served
    anything, while the real API is `majorana-api-<hash>-uw.a.run.app` — no
    `prod` token, no match, straight past the check. The suffix rule is what
    fixes it: a `*.run.app` host is a deployed Cloud Run service by definition.
    """
    runner = RUNNER.read_text(encoding="utf-8")
    assert '".run.app"' in runner, "a Cloud Run URL is no longer treated as production-like"
    for host in ("leonaqt.com", "leonaquantum.com"):
        assert host in runner, f"{host} is not in the production-like set"
