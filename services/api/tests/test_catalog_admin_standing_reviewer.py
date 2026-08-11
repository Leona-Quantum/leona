"""Which account an unattended run may attest as — the rule CI depends on.

`pick_live_reviewer` answers "which `users` row is this human", from an email an
operator typed. This answers a different question: with **nobody at the
keyboard**, whose attestation is the deploy pipeline continuing?

The safety property under test is that the answer can only ever be an account a
human already granted ADMIN by running `attest-bootstrap` explicitly. An
automated run must not be able to widen who holds the catalog grant — so every
case below that could invent, escalate, or silently choose a principal refuses
instead.

No database, for the same reason as the sibling file: the query is one line and
the rule is the part that grants ADMIN.
"""

from __future__ import annotations

import uuid

import pytest
from majorana_contracts.enums import Role

from majorana_api.catalog_admin import pick_standing_reviewer

IMPORTER = uuid.UUID("019f5b84-0000-4000-8000-00000000aaa1")
READER = uuid.UUID("019f5b84-0000-4000-8000-00000000aaa2")
OWNER_HUMAN = uuid.UUID("019f5b84-0000-4000-8000-00000000bbb1")
SECOND_HUMAN = uuid.UUID("019f5b84-0000-4000-8000-00000000bbb2")

SERVICE_IDS = frozenset({IMPORTER, READER})

LIVE = "user_01LIVEWORKOSID"
RETIRED = f"retired-workos-env:2026-07-30T00:00:00Z:{OWNER_HUMAN}"

# What `ensure_system_catalog_authority` actually writes, plus the one ADMIN row
# `grant_catalog_reviewer` adds the first time a human attests. Tests build from
# this so they fail if provisioning's shape ever changes underneath them.
PROVISIONED = [
    (IMPORTER, Role.OWNER, "system-catalog-importer"),
    (READER, Role.VIEWER, "system-catalog-reader"),
]


def test_the_single_admin_is_the_standing_reviewer() -> None:
    rows = [*PROVISIONED, (OWNER_HUMAN, Role.ADMIN, LIVE)]
    assert pick_standing_reviewer(rows, service_ids=SERVICE_IDS) == OWNER_HUMAN
    # …and independent of the order the database returned the memberships in.
    assert pick_standing_reviewer(list(reversed(rows)), service_ids=SERVICE_IDS) == OWNER_HUMAN


def test_the_importer_is_not_a_reviewer_even_though_it_owns_the_workspace() -> None:
    """OWNER is the higher-sounding role and the wrong one.

    The importer owns the catalog workspace, so a rule that reached for "the
    most privileged membership" would attest as the service identity that staged
    the content — collapsing the importer/reviewer separation ADR-0016 exists to
    keep. Only ADMIN is the reviewer grant.
    """
    with pytest.raises(SystemExit, match="no human account holds"):
        pick_standing_reviewer(PROVISIONED, service_ids=SERVICE_IDS)


def test_a_human_holding_owner_is_not_a_reviewer_either() -> None:
    """The ADMIN check, tested where the service-id filter cannot cover for it.

    Written because a mutation survived: widening the rule to
    `role in (ADMIN, OWNER)` broke nothing, since in every other fixture the
    OWNER *is* the importer and the service-id filter excluded it anyway. So the
    role check was only ever exercised through the other clause, and a rule that
    reached for "the most privileged membership" would have passed the suite.

    Here the OWNER is a human, so nothing else can exclude them. The grant is
    ADMIN specifically — `grant_catalog_reviewer` writes no other role, and
    owning the workspace is not having been made its reviewer.
    """
    with pytest.raises(SystemExit, match="no human account holds"):
        pick_standing_reviewer(
            [(READER, Role.VIEWER, "system-catalog-reader"), (OWNER_HUMAN, Role.OWNER, LIVE)],
            service_ids=SERVICE_IDS,
        )


def test_an_unprovisioned_workspace_refuses_rather_than_inventing_a_principal() -> None:
    with pytest.raises(SystemExit) as excinfo:
        pick_standing_reviewer([], service_ids=SERVICE_IDS)
    # The refusal has to say what to do next: this fires on the very first
    # deploy after the feature ships, when nobody has attested yet, and the
    # remedy is one explicit human run — not a retry.
    assert "--attested-by-email" in str(excinfo.value)


def test_a_service_identity_holding_admin_is_still_excluded() -> None:
    """Defence in depth against a different function's invariant.

    `grant_catalog_reviewer` refuses to grant ADMIN to either service identity,
    so this row should be unreachable. It is excluded anyway, because the cost
    of being wrong about *that* function is an unattended run attesting as the
    importer — and this rule should not inherit an invariant it cannot see.
    """
    with pytest.raises(SystemExit, match="no human account holds"):
        pick_standing_reviewer(
            [(IMPORTER, Role.ADMIN, "system-catalog-importer")], service_ids=SERVICE_IDS
        )


def test_two_reviewers_refuse_and_name_both_rather_than_choosing() -> None:
    with pytest.raises(SystemExit) as excinfo:
        pick_standing_reviewer(
            [
                *PROVISIONED,
                (OWNER_HUMAN, Role.ADMIN, LIVE),
                (SECOND_HUMAN, Role.ADMIN, "user_01OTHER"),
            ],
            service_ids=SERVICE_IDS,
        )
    message = str(excinfo.value)
    assert str(OWNER_HUMAN) in message and str(SECOND_HUMAN) in message
    # Points at the escape hatch, which is an operator naming one deliberately.
    assert "--attested-by" in message


def test_the_retired_half_of_a_split_account_is_not_a_second_reviewer() -> None:
    """The realistic two-ADMIN state, and it is not an ambiguity.

    The WorkOS environment switch minted a second `users` row per account. An
    attestation run before the reattachment and one after can therefore have
    granted ADMIN to both rows of the same person — so this workspace can carry
    two reviewer memberships without two people ever having held the grant.

    Refusing here would take the deploy down over a duplicate the project has
    already decided how to read: the retired row is an account nobody can sign
    in to, and `pick_live_reviewer` excludes it for exactly this reason.
    """
    rows = [
        *PROVISIONED,
        (SECOND_HUMAN, Role.ADMIN, RETIRED),
        (OWNER_HUMAN, Role.ADMIN, LIVE),
    ]
    assert pick_standing_reviewer(rows, service_ids=SERVICE_IDS) == OWNER_HUMAN
    assert pick_standing_reviewer(list(reversed(rows)), service_ids=SERVICE_IDS) == OWNER_HUMAN


def test_a_grant_held_only_by_retired_rows_refuses() -> None:
    """Attesting as a dead account succeeds and reaches nobody.

    That is worse than stopping: the sync would report success while the
    attestation it wrote hangs off a row no session can ever authenticate as.
    """
    with pytest.raises(SystemExit, match="no human account holds"):
        pick_standing_reviewer(
            [*PROVISIONED, (OWNER_HUMAN, Role.ADMIN, RETIRED)], service_ids=SERVICE_IDS
        )


def test_two_live_reviewers_still_refuse_even_with_a_retired_row_present() -> None:
    """Excluding retired rows narrows the set; it never resolves a real tie."""
    with pytest.raises(SystemExit) as excinfo:
        pick_standing_reviewer(
            [
                *PROVISIONED,
                (OWNER_HUMAN, Role.ADMIN, LIVE),
                (SECOND_HUMAN, Role.ADMIN, "user_01OTHERLIVE"),
                (uuid.UUID("019f5b84-0000-4000-8000-00000000bbb3"), Role.ADMIN, RETIRED),
            ],
            service_ids=SERVICE_IDS,
        )
    message = str(excinfo.value)
    assert str(OWNER_HUMAN) in message and str(SECOND_HUMAN) in message
    # The retired row is not offered to the operator as a choice.
    assert "bbb3" not in message


def test_one_account_listed_twice_is_one_account() -> None:
    """A duplicated membership row is not a second reviewer.

    Refusing here would take an unattended deploy down over a repeated row that
    names the same principal both times — an ambiguity that is not one.
    """
    rows = [*PROVISIONED, (OWNER_HUMAN, Role.ADMIN, LIVE), (OWNER_HUMAN, Role.ADMIN, LIVE)]
    assert pick_standing_reviewer(rows, service_ids=SERVICE_IDS) == OWNER_HUMAN
