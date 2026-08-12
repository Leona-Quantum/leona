"""The parked catalog step must not state which blocker is active.

The step's static text spent hours telling every deploy that the sync was blocked
on two live accounts holding the reviewer grant, while the read-only report it
prints six lines below reached `VERDICT: exactly one eligible account has signed`.
Both were in the same log. The prose was written when it was true, the database
moved, and nothing made the sentence move with it.

Fixing the wording alone would buy exactly one correct sentence and the same
defect: the replacement named a *different* blocker — records awaiting a
signature — which stops being true the moment those signatures land.

So the invariant is structural rather than editorial. **The blocker is computed,
never authored.** `catalog_admin reviewers` and `catalog_admin attest-plan` read
the database on the run that prints them and end in a VERDICT line; the echoed
text may say what the parked state *means* and what order things happen in,
because those do not depend on the state. It may not say what is currently wrong.

A prose-only convention would drift back, which is the whole finding. This is the
guard.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

_REPO_ROOT = Path(__file__).resolve().parents[3]
_DEPLOY = _REPO_ROOT / ".github" / "workflows" / "deploy.yml"
_STEP_NAME = "the catalog sync is parked"

#: The two read-only reports that are allowed to name a blocker, because they
#: derive it. Both must be invoked, or the text is all a reader gets.
REQUIRED_REPORTS = ("catalog_admin reviewers", "catalog_admin attest-plan")

#: `phrase -> why authoring it here is the bug`. Each of the first two is a real
#: sentence that was live in this step; they stay listed after being removed
#: because a guard whose cases never happened teaches nobody why it exists.
FORBIDDEN = {
    "blocked on": (
        "introduces an authored blocker. Whatever follows it is a claim about "
        "database state, written at a moment that has passed."
    ),
    "two live accounts": (
        "the original wrong sentence. It outlived the condition it described and "
        "sent readers to revoke a grant that did not need revoking."
    ),
    "needs a fresh signature": (
        "the replacement wrong sentence. True until the signatures land, and it "
        "cannot notice when they do — attest-plan can."
    ),
}


def _parked_step() -> dict:
    workflow = yaml.safe_load(_DEPLOY.read_text(encoding="utf-8"))
    for job in workflow["jobs"].values():
        for step in job.get("steps", []):
            if step.get("name") == _STEP_NAME:
                return step
    raise AssertionError(f"no step named {_STEP_NAME!r} in {_DEPLOY}")


def _echoed_warnings(run: str) -> list[str]:
    """Only the step's own authored text — the `::warning::` echoes.

    Deliberately not the whole `run` body: the shell comments in it discuss the
    blockers at length and should, and the commands it invokes are the very
    things allowed to print one.
    """
    return [line.strip() for line in run.splitlines() if "::warning::" in line]


def test_the_step_exists_and_is_the_parked_branch() -> None:
    step = _parked_step()
    assert step["if"].endswith("vars.CATALOG_SYNC_ENABLED != 'true'")


@pytest.mark.parametrize("report", REQUIRED_REPORTS)
def test_both_reports_run_so_the_blocker_is_derived_somewhere(report: str) -> None:
    """Removing the prose is only safe while something still answers the question."""
    assert report in _parked_step()["run"], (
        f"the parked step no longer runs `{report}`. With the authored blocker "
        "gone, these reports are the only thing that tells a reader what is wrong."
    )


def test_the_warning_text_names_no_blocker() -> None:
    warnings = " ".join(_echoed_warnings(_parked_step()["run"])).lower()
    assert warnings, "the parked step emits no ::warning:: at all — a silent park"
    offences = [(p, why) for p, why in FORBIDDEN.items() if p in warnings]
    assert not offences, "the parked step's text names a blocker again:\n" + "\n".join(
        f"  {p!r} — {why}" for p, why in offences
    )


def test_the_text_still_says_what_the_parked_state_costs() -> None:
    """The guard forbids state claims, not the warning itself.

    A step that satisfied the rule by echoing nothing useful would pass the check
    above and reintroduce the silence the whole feature exists to end.
    """
    warnings = " ".join(_echoed_warnings(_parked_step()["run"])).lower()
    assert "parked" in warnings
    assert "/repository" in warnings
    assert "catalog_sync_enabled" in warnings

    # The three above are satisfied by a warning that merely mentions the switch
    # and the route. Neither of the two consequences a reader is here for — that
    # this deploy's content did NOT arrive, and that the rows being served are the
    # old ones — has to appear for them to pass, so they do not yet rule out the
    # useless echo this test's docstring describes.
    #
    # Fragments, not the sentences they sit in: the surrounding prose is meant to
    # be rewritten as the park drags on (that is the whole argument of the echo it
    # guards), and a test holding a full sentence hostage would stop that. These
    # two are the parts a rewording cannot drop without dropping the meaning.
    assert "not reached" in warnings, "the echo no longer says the content did not arrive"
    assert "previous rows" in warnings, "the echo no longer says the DB serves the old rows"
