"""The attest-plan report is what somebody reads before signing, so its rule is tested.

`format_attest_plan_report` looks like display code, and is not, for the same
reason `format_reviewer_report` is not: these lines are read out of a deploy log
by a person deciding whether to put their name on a corpus, and the database that
would let them check is one they are told not to reach from a laptop.

The property that matters most here is that the refused list is **complete**. A
run that printed 20 of 25 refusals is what made this command necessary at all:
`--re-attest` refuses unless the named set equals the refused set exactly, in both
directions, so a truncated list is not a shorter answer — it is an unusable one.

No database, for the reason the sibling files give: the queries are two lines and
the rule is the part that decides.
"""

from __future__ import annotations

from majorana_api.catalog_admin import ReAttestationPlan, format_attest_plan_report


def plan(*, first=(), carried=(), needs=()) -> ReAttestationPlan:
    return ReAttestationPlan(
        first_signature=tuple(first),
        carried_forward=tuple(carried),
        re_signed=(),
        needs_signature=tuple(needs),
    )


def report(decision: ReAttestationPlan, *, unimported=()) -> str:
    return "\n".join(format_attest_plan_report(decision, unimported=list(unimported)))


def test_every_refused_identity_is_printed_rather_than_the_first_twenty() -> None:
    """The whole point. Twenty-five refusals print twenty-five identities.

    Written as a range rather than a handful because the failure it guards is a
    slice, and a slice is invisible at four items.
    """
    refused = tuple(f"algorithms/record-{n:03d}" for n in range(25))
    text = report(plan(carried=("gates/h",), needs=refused))
    for identity in refused:
        assert identity in text
    assert "needs a fresh signature: 25" in text


def test_the_refusals_are_not_handed_back_as_a_pasteable_argument() -> None:
    """One per line, deliberately.

    `--re-attest` exists to buy a look at each record. A ready-to-paste comma
    string would make not looking the cheapest path, which would turn this
    command into a way around the guard instead of the way to reach it.
    """
    refused = ("algorithms/vqe-h2", "algorithms/qaoa-maxcut")
    text = report(plan(needs=refused))
    assert "algorithms/vqe-h2,algorithms/qaoa-maxcut" not in text
    assert text.count("needs a fresh signature (provenance claim changed)") == 2


def test_a_refusal_says_the_sync_publishes_nothing_not_merely_that_it_fails() -> None:
    """The consequence is the part a reader cannot derive from a count.

    "3 records need a signature" reads as three rows missing. What actually
    happens is that the attest step exits and `publish-bootstrap` never runs, so
    the entire corpus content of that deploy stays off the public listing.
    """
    text = report(plan(carried=("gates/h",), needs=("algorithms/vqe-h2",)))
    assert "REFUSES" in text
    assert "publishes nothing" in text


def test_no_refusals_reaches_a_verdict_and_does_not_claim_the_other_half() -> None:
    """An empty refusal set settles the attest question and nothing else.

    Whether an unattended run can name a reviewer is `reviewers`' verdict. Two
    reports both concluding "the sync can run" is how a green half gets read as a
    green whole.
    """
    text = report(plan(first=("gates/h",), carried=("gates/x",)))
    assert "VERDICT: no record needs a fresh signature" in text
    assert "reviewers" in text
    assert "REFUSES" not in text


def test_unimported_records_are_split_out_of_the_first_signature_count() -> None:
    """New corpus content and a missing grant are different situations.

    Both take a first signature. Reported as one number, forty new records read
    as forty grants the database lost.
    """
    text = report(
        plan(first=("gates/h", "gates/x", "gates/y"), carried=("gates/z",)),
        unimported=("gates/x", "gates/y"),
    )
    assert "first signature:         3 (2 of them not imported yet)" in text


def test_an_all_imported_corpus_does_not_print_an_empty_parenthetical() -> None:
    text = report(plan(first=("gates/h",), carried=("gates/x",)))
    assert "not imported yet" not in text
    assert "first signature:         1" in text


def test_the_total_is_the_three_dispositions_and_is_never_asserted_separately() -> None:
    """A record is in exactly one bucket, so the header adds up or the planner is wrong."""
    text = report(plan(first=("a",), carried=("b", "c"), needs=("d", "e", "f")))
    assert "attestation plan: 6 records included by the policy" in text
