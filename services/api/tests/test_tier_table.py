"""Invariants over the shipped tier table, independent of any one allowance.

The numbers themselves are decisions and mostly belong to whoever set them. What
is checkable without second-guessing the owner is the SHAPE of the table: that a
tier cannot be added which grants a capability without an allowance to bound it,
that the ladder does not take something away as it goes up, and that the plan
strings a user row can carry actually name a tier.

`pro` is why this file exists. It was sold on the pricing page and written into
seed data while `PLAN_TIERS` named only `team` and `developer`, so every account
on it resolved to `free` — a whole plan metered as the one below it, with
nothing raising anywhere. The tests below fail on the next tier that arrives
half-wired rather than on the next report from a user who paid for one.
"""

import pytest

from majorana_api.tiers import (
    ACCOUNT_TIERS,
    PLAN_TIERS,
    PRO_PLAN,
    TEAM_PLAN,
    TIER_LIMITS,
    at_least,
    limits_for,
    resolve_tier,
)


def test_every_tier_in_the_ladder_has_limits_and_the_other_way_round():
    """`ACCOUNT_TIERS` orders them; `TIER_LIMITS` says what they get.

    A tier in one and not the other is either a position nothing can be resolved
    to, or an entry `at_least` raises ValueError on the first time somebody
    compares it.
    """
    assert set(ACCOUNT_TIERS) == set(TIER_LIMITS)
    assert len(ACCOUNT_TIERS) == len(set(ACCOUNT_TIERS)), "a tier is listed twice"


def test_a_tier_that_cannot_share_has_no_membership_allowance():
    """The invariant `TierLimits.shared_projects` names in its own comment.

    The two fields say different things — `project_sharing` refuses granting,
    `shared_projects` counts what has been received — and a tier that later
    gains the capability without a number would gain an UNBOUNDED allowance with
    it, silently. `0` is the value that makes flipping the bool a visible
    decision. Mirrors the same sweep in apps/web/lib/account-tier.test.ts.
    """
    for tier in ACCOUNT_TIERS:
        limits = limits_for(tier)
        if not limits.project_sharing:
            assert limits.shared_projects == 0, (
                f"{tier} cannot share but may be in {limits.shared_projects} shared projects"
            )


def test_the_ladder_never_takes_something_away_as_it_goes_up():
    """A tier inserted in the middle must not be worse than the one below it.

    Written as a sweep rather than as pairs of assertions so that the next tier
    is covered without editing this test — which is exactly the edit that would
    have been skipped. `None` is unlimited and therefore always at least as much
    as any number.
    """

    def at_least_as_much(upper: int | None, lower: int | None) -> bool:
        return upper is None or (lower is not None and upper >= lower)

    for index in range(1, len(ACCOUNT_TIERS)):
        lower_tier, upper_tier = ACCOUNT_TIERS[index - 1], ACCOUNT_TIERS[index]
        lower, upper = limits_for(lower_tier), limits_for(upper_tier)
        for field in ("agent_runs_per_week", "private_artifacts", "owned_workspaces"):
            assert at_least_as_much(getattr(upper, field), getattr(lower, field)), (
                f"{upper_tier} has less {field} than {lower_tier}"
            )
        assert not lower.project_sharing or upper.project_sharing, (
            f"{upper_tier} loses the sharing {lower_tier} has"
        )
        assert at_least_as_much(upper.shared_projects, lower.shared_projects), (
            f"{upper_tier} may be in fewer shared projects than {lower_tier}"
        )


def test_pro_sits_between_free_and_team_and_gains_no_team_capability():
    """The owner's scope for the plan, as assertions.

    "pro should become a tier. probably just expanded usage limits and artifacts
    compared to free, but less than team." So: strictly more than free on the
    allowances it is sold on, strictly less than team, and NOT sharing — sharing
    is what Team is, and a Pro tier that quietly acquired it would make the
    Team plan's only differentiator free.
    """
    free, pro, team = limits_for("free"), limits_for("pro"), limits_for("team")
    for field in ("agent_runs_per_week", "private_artifacts", "owned_workspaces"):
        assert getattr(free, field) < getattr(pro, field) < getattr(team, field), field
    assert pro.project_sharing is False
    assert pro.shared_projects == 0
    assert at_least("pro", "free") and not at_least("pro", "team")


@pytest.mark.parametrize("plan", sorted(PLAN_TIERS))
def test_every_plan_string_names_a_tier_that_exists(plan):
    """A `users.plan` value mapped to a tier with no limits row is a 500."""
    assert PLAN_TIERS[plan] in TIER_LIMITS


def test_the_pro_plan_string_no_longer_resolves_to_free():
    """The bug this tier closes, stated as the row that had it.

    `db/seeds/seed.py` provisions an account with `plan = 'pro'`. Until the
    string was in `PLAN_TIERS` it fell through to the unrecognised-value branch
    and was metered as free — the safe direction for a value nobody recognises,
    and the wrong answer for one the pricing page sells.
    """
    assert resolve_tier("ada@example.dev", plan=PRO_PLAN) == "pro"
    assert resolve_tier("ada@example.dev", plan=TEAM_PLAN) == "team"
    # Still the safe direction for a string nobody recognises.
    assert resolve_tier("ada@example.dev", plan="platinum") == "free"


def test_a_pro_account_is_outranked_by_both_lists_above_it():
    """Highest signal wins, and `pro` is now the lowest paid one.

    An address on the Pro allowlist that is also on the Team one is a Team
    account, not whichever check happens to be written first — the same rule
    that already held between team and developer, now with a third rung to fall
    off.
    """
    subject = "partner@example.org"
    assert (
        resolve_tier(subject, pro_emails=frozenset({subject}), team_emails=frozenset({subject}))
        == "team"
    )
    assert (
        resolve_tier(
            subject, pro_emails=frozenset({subject}), developer_emails=frozenset({subject})
        )
        == "developer"
    )
    assert resolve_tier(subject, pro_emails=frozenset({subject})) == "pro"
    # A `pro` plan row belonging to somebody on the team list is a Team account.
    assert resolve_tier(subject, plan=PRO_PLAN, team_emails=frozenset({subject})) == "team"


def test_unknown_plan_names_no_tier():
    """The unrecognised-plan fixture must actually be unrecognised.

    `repo_test_helpers.UNKNOWN_PLAN` carries the history: it was `"pro"`, and
    two live tests used it to prove that a plan string nobody recognises is
    metered as `free`. Adding the `pro` tier broke one of them honestly and left
    the other passing while it quietly changed meaning.

    This guard is here rather than beside the constant because
    `test_project_sharing_tier_live.py` is skipped wholesale without a
    `DATABASE_URL`. A check that only runs in the `db` job would not have caught
    the drift on the pull requests where it matters.
    """
    from repo_test_helpers import UNKNOWN_PLAN

    assert UNKNOWN_PLAN not in PLAN_TIERS, (
        f"UNKNOWN_PLAN is {UNKNOWN_PLAN!r}, which now names the "
        f"{PLAN_TIERS[UNKNOWN_PLAN]!r} tier. The tests using it have stopped "
        "being about an unrecognised plan string — pick a value no tier claims."
    )
    assert resolve_tier("someone@example.test", plan=UNKNOWN_PLAN) == "free"
