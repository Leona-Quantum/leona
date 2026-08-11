"""The reviewer report is the whole input to a grant decision, so its rule is tested.

`format_reviewer_report` looks like display code. It is not: these lines are
everything a person sees when deciding who may attest to the public corpus, and
they are read out of a deploy log rather than out of a database. A wrong mark —
an eligible account labelled retired, or a retired one not labelled — sends the
reader to the wrong answer with nothing to notice it by.

No database, for the same reason as the sibling files: the query is two lines and
the rule is the part that decides.
"""

from __future__ import annotations

import uuid

from majorana_contracts.enums import Role

from majorana_api.catalog_admin import format_reviewer_report

IMPORTER = uuid.UUID("019f5b84-0000-4000-8000-00000000aaa1")
READER = uuid.UUID("019f5b84-0000-4000-8000-00000000aaa2")
OWNER_HUMAN = uuid.UUID("019f5b84-0000-4000-8000-00000000bbb1")
SECOND_HUMAN = uuid.UUID("019f5b84-0000-4000-8000-00000000bbb2")

SERVICE_IDS = frozenset({IMPORTER, READER})
LIVE = "user_01LIVEWORKOSID"
RETIRED = f"retired-workos-env:2026-07-30T00:00:00Z:{OWNER_HUMAN}"
PROVISIONED = [
    (IMPORTER, Role.OWNER, "system-catalog-importer"),
    (READER, Role.VIEWER, "system-catalog-reader"),
]


def report(rows, signed):
    return "\n".join(format_reviewer_report(rows, signed=signed, service_ids=SERVICE_IDS))


def test_the_production_shape_reaches_a_verdict_rather_than_leaving_arithmetic() -> None:
    """Two grants, one of them signed — the state that parked the sync.

    The report has to end in an answer. Printing the rows and stopping would
    reproduce exactly the problem it was written for: somebody deciding an
    authorization question from raw rows.
    """
    text = report(
        [*PROVISIONED, (OWNER_HUMAN, Role.ADMIN, LIVE), (SECOND_HUMAN, Role.ADMIN, "user_01B")],
        {OWNER_HUMAN: 283},
    )
    assert "2 ADMIN membership(s)" in text
    assert "signed=283" in text and "signed=0" in text
    assert "VERDICT: exactly one eligible account has signed" in text
    assert "CATALOG_SYNC_ENABLED" in text


def test_two_signatories_say_a_person_must_pick_rather_than_offering_a_command() -> None:
    text = report(
        [*PROVISIONED, (OWNER_HUMAN, Role.ADMIN, LIVE), (SECOND_HUMAN, Role.ADMIN, "user_01B")],
        {OWNER_HUMAN: 283, SECOND_HUMAN: 2},
    )
    assert "VERDICT: 2 eligible accounts have signed" in text
    assert "--attested-by explicitly" in text
    # The unpark command must NOT appear: this is the case where running it
    # would redden the deploy, and a command in the output reads as a suggestion.
    assert "CATALOG_SYNC_ENABLED" not in text


def test_a_retired_signatory_is_marked_and_does_not_count_as_eligible() -> None:
    """The row most likely to carry signatures is the one nobody can sign in as."""
    text = report(
        [*PROVISIONED, (OWNER_HUMAN, Role.ADMIN, RETIRED)],
        {OWNER_HUMAN: 283},
    )
    assert "RETIRED workos id" in text
    assert "VERDICT: 0 eligible accounts have signed" in text


def test_a_service_identity_holding_admin_is_marked_never_eligible() -> None:
    text = report([(IMPORTER, Role.ADMIN, "system-catalog-importer")], {IMPORTER: 283})
    assert "SERVICE IDENTITY" in text
    assert "VERDICT: 0 eligible" in text


def test_both_marks_appear_together_rather_than_only_the_first() -> None:
    """An account can be both, and reporting one would hide the other.

    Cumulative rather than exclusive marks — a reader who sees only "SERVICE
    IDENTITY" on a row that is also retired learns one true thing and one
    absence they will read as "and otherwise fine".
    """
    text = report([(IMPORTER, Role.ADMIN, RETIRED)], {})
    assert "SERVICE IDENTITY" in text and "RETIRED workos id" in text


def test_only_admin_memberships_are_reported() -> None:
    """The importer OWNs the workspace and the reader is a VIEWER; neither is a grant."""
    text = report(PROVISIONED, {})
    assert "0 ADMIN membership(s)" in text
    assert str(IMPORTER) not in text and str(READER) not in text


def test_an_unsigned_eligible_account_is_not_a_verdict() -> None:
    """Holding the grant is not having used it — the distinction the whole flag rests on."""
    text = report([*PROVISIONED, (OWNER_HUMAN, Role.ADMIN, LIVE)], {})
    assert "signed=0" in text
    assert "VERDICT: 0 eligible accounts have signed" in text
