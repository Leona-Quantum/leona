"""Pure-policy tests for the owner bulk license attestation (Slice C.5).

No database: this is the layer that decides *which* records a human grant
covers, and every property worth defending here is about failing closed rather
than about persistence. The live half (provenance + approval actually landing on
staged rows) is test_catalog_attestation_live.py.
"""

import json

import pytest

from majorana_api.catalog_admin import (
    _bootstrap_plan,
    parse_re_attest,
    plan_re_attestation,
)
from majorana_api.catalog_attestation import (
    AttestationPolicy,
    AttestationPolicyError,
    UnclassifiedRecordError,
    default_policy_path,
)
from majorana_api.catalog_bootstrap_manifest import BootstrapManifestSource

BASE_POLICY = {
    "policy_version": 1,
    "statement": "I attest that these records are first-party works.",
    "spdx_id": "CC-BY-4.0",
    "assertion_kind": "declared",
    "license_scope": "whole",
    "source_kind": "literature",
    "include_source_kinds": ["curated_reference"],
    "excluded_identities": {"skipme": "third-party contribution"},
}

RECORDS = {
    "alpha": {"kind": "curated_reference", "license": "CC BY 4.0-compatible reference metadata"},
    "skipme": {"kind": "curated_reference", "license": "whatever"},
}


def _policy(**overrides) -> AttestationPolicy:
    return AttestationPolicy.from_dict({**BASE_POLICY, **overrides})


def test_plan_includes_covered_records_and_excludes_named_ones():
    plan = _policy().plan(RECORDS)
    assert [r.upstream_identity for r in plan.included] == ["alpha"]
    assert [(r.upstream_identity, r.reason) for r in plan.excluded] == [
        ("skipme", "third-party contribution")
    ]


def test_exclusion_overrides_an_otherwise_included_source_kind():
    """`skipme` has an included source kind; naming it must still win, or an
    owner could not withhold a record without also withholding its whole class."""
    plan = _policy().plan(RECORDS)
    assert "skipme" not in plan.identities


def test_uncovered_source_kind_raises_instead_of_defaulting():
    """The fail-closed hinge: a record the policy never considered must stop the
    run rather than be silently published or silently dropped."""
    records = {**RECORDS, "surprise": {"kind": "community_submission", "license": "x"}}
    with pytest.raises(UnclassifiedRecordError, match="surprise"):
        _policy().plan(records)


def test_record_with_no_source_claim_is_uncovered():
    with pytest.raises(UnclassifiedRecordError, match="nosource"):
        _policy().plan({**RECORDS, "nosource": {}})


def test_stale_exclusion_raises():
    """An exclusion naming a record the manifest no longer has means the policy
    describes a corpus that moved; the owner must reconfirm."""
    with pytest.raises(AttestationPolicyError, match="absent from the manifest"):
        _policy().plan({"alpha": RECORDS["alpha"]})


def test_evidence_hash_pins_the_claim_it_was_made_against():
    first = _policy().plan(RECORDS).included[0]
    changed = {**RECORDS, "alpha": {**RECORDS["alpha"], "license": "something else"}}
    second = _policy().plan(changed).included[0]
    assert first.evidence_hash != second.evidence_hash


def test_evidence_hash_also_moves_when_only_the_content_changed():
    """The gap owner decision B closes.

    A record's `source` object is its provenance claim, and editing the record's
    code leaves it untouched — that is exactly the shape of the 156 content fixes
    the reconciling importer exists to carry. With a claim-only hash the audit row
    said a human approved "this record" while being unable to tell any two
    revisions of it apart, so the policy's own change-detector was blind to the
    change being imported.
    """
    plan = _policy().plan(RECORDS, {"alpha": "d" * 64})
    rewritten = _policy().plan(RECORDS, {"alpha": "e" * 64})
    assert plan.included[0].evidence_hash != rewritten.included[0].evidence_hash
    # ...and the claim hash does not move, because the claim did not.
    assert plan.included[0].claim_hash == rewritten.included[0].claim_hash


def test_a_grant_carries_forward_when_only_the_content_changed():
    """Option B: the attestation is about identity and provenance, so a content
    revision binds to the existing grant without collecting a fresh signature."""
    before = _policy().plan(RECORDS, {"alpha": "d" * 64}).included[0]
    after = _policy().plan(RECORDS, {"alpha": "e" * 64}).included[0]
    assert after.grant_carries_forward(before.claim_hash)


def test_a_grant_refuses_to_carry_forward_when_the_provenance_claim_changed():
    """Where B stops being defensible: a changed claim is the signal that the
    record's origin may no longer be first-party, which is the one thing the
    owner's sentence actually asserts. Refuse and fall back to a human signature."""
    before = _policy().plan(RECORDS, {"alpha": "d" * 64}).included[0]
    reoriginated = {**RECORDS, "alpha": {**RECORDS["alpha"], "license": "third-party, GPL-3.0"}}
    after = _policy().plan(reoriginated, {"alpha": "d" * 64}).included[0]
    assert not after.grant_carries_forward(before.claim_hash)


def test_a_record_with_no_prior_grant_is_not_a_carry_forward():
    """Absence of a previous assertion is a first signature, not a renewal — the
    difference between 'nobody has objected' and 'somebody approved this'."""
    record = _policy().plan(RECORDS, {"alpha": "d" * 64}).included[0]
    assert not record.grant_carries_forward(None)


def test_evidence_hash_falls_back_to_the_claim_hash_without_a_digest():
    """An older manifest offers no content digest. That must degrade to the
    previous behaviour rather than hashing the string "None" into the audit row."""
    record = _policy().plan(RECORDS).included[0]
    assert record.evidence_hash == record.claim_hash


def test_the_real_corpus_supplies_a_content_digest_for_every_attested_record():
    """The widening is only real if the digests actually arrive. A silently empty
    map would make every evidence_hash fall back to the claim hash and the gate
    would read as passing while covering nothing."""
    source = BootstrapManifestSource()
    plan = _bootstrap_plan(source, AttestationPolicy.load())
    assert plan.included
    for record in plan.included:
        assert record.evidence_hash != record.claim_hash, record.upstream_identity


def test_policy_checksum_is_content_derived_and_key_order_independent():
    reordered = dict(reversed(list(BASE_POLICY.items())))
    assert AttestationPolicy.from_dict(reordered).checksum == _policy().checksum
    assert _policy(spdx_id="MIT").checksum != _policy().checksum


@pytest.mark.parametrize(
    ("overrides", "match"),
    [
        ({"policy_version": 2}, "unsupported policy_version"),
        ({"statement": "  "}, "statement is missing"),
        ({"spdx_id": ""}, "concrete spdx_id"),
        ({"include_source_kinds": []}, "include_source_kinds"),
        ({"excluded_identities": {"x": ""}}, "non-empty reason"),
        ({"assertion_kind": "guessed"}, "enum value is invalid"),
    ],
)
def test_malformed_policy_is_rejected(overrides, match):
    with pytest.raises(AttestationPolicyError, match=match):
        _policy(**overrides)


def test_audit_meta_carries_the_signed_sentence_and_checksum():
    meta = _policy().audit_meta()
    assert meta["statement"] == BASE_POLICY["statement"]
    assert meta["spdx_id"] == "CC-BY-4.0"
    assert meta["policy_checksum"] == _policy().checksum


def test_committed_policy_covers_the_real_corpus_exactly():
    """The shipped policy must classify every pinned record with nothing left
    over. The two community submissions the grant could not reach were removed
    from the corpus outright, so the policy now needs no exclusions — and an
    empty exclusion list must still mean full coverage, not a gap.

    Counted against the manifest rather than against a literal: "all of them"
    is the property, and a pinned corpus size states it only until the next
    intake, at which point it fails for the one reason that is not a defect."""
    policy = AttestationPolicy.load()
    source = BootstrapManifestSource()
    pinned = len(source.identities())
    plan = _bootstrap_plan(source, policy)
    assert policy.spdx_id == "CC-BY-4.0"
    assert len(plan.included) + len(plan.excluded) == pinned
    assert len(plan.included) == pinned
    assert plan.excluded == ()


def test_committed_policy_excludes_every_non_first_party_record():
    """The grant is a first-party assertion, so no record the manifest itself
    labels a community submission may end up inside it."""
    source = BootstrapManifestSource()
    plan = _bootstrap_plan(source, AttestationPolicy.load())
    for identity in plan.identities:
        claim = json.loads(source.read_bytes(identity)).get("source") or {}
        assert claim.get("kind") != "community_submission", identity


def test_committed_policy_file_is_loadable_from_its_default_path():
    assert default_policy_path().is_file()
    assert AttestationPolicy.load().policy_version == 1


# --- deliberate re-attestation (`--re-attest`) -------------------------------
#
# The refusal above was a dead end for the whole life of the feature: the
# message said "re-attest them deliberately" and the complete flag surface was
# --attested-by / --attested-by-email, neither of which reaches the claim-hash
# comparison. A production sync-bootstrap imported 283 records, refused 9, and
# could only ever refuse the same 9 again — publish never ran.
#
# No database here for the same reason pick_live_reviewer has none: the rule is
# the part that decides whether a human's signature is required, and a test that
# needs Postgres is a test the unit suite does not run.

RE_ATTEST_CORPUS = {
    "carried": {"kind": "curated_reference", "license": "x"},
    "fresh": {"kind": "curated_reference", "license": "x"},
    "moved": {"kind": "curated_reference", "license": "x"},
    "moved-too": {"kind": "curated_reference", "license": "x"},
}


def _re_attest_records():
    """Four records, one per disposition the planner can reach."""
    return _policy(excluded_identities={}).plan(RE_ATTEST_CORPUS).included


def _previous_claims(records):
    """`carried` unchanged, `fresh` never signed, the two `moved*` re-originated."""
    claims = {r.upstream_identity: r.claim_hash for r in records}
    claims["fresh"] = None
    claims["moved"] = "a" * 64
    claims["moved-too"] = "b" * 64
    return claims


def test_without_the_flag_a_changed_claim_still_refuses_and_nothing_is_re_signed():
    """The production run's behaviour, pinned. Adding an escape hatch must not
    open one for a run that did not ask for it — `--re-attest` absent has to stay
    byte-identical to the fail-closed path that existed before it."""
    records = _re_attest_records()
    plan = plan_re_attestation(records, _previous_claims(records), None)
    assert plan.needs_signature == ("moved", "moved-too")
    assert plan.re_signed == ()
    assert plan.carried_forward == ("carried",)
    assert plan.first_signature == ("fresh",)


def test_naming_exactly_the_refused_set_re_signs_exactly_that_set():
    """The happy path, and the assertion that matters is the *exactly*: the two
    records whose claim did not move stay where they were, so an operator cannot
    launder a carry-forward or a first signature through this flag."""
    records = _re_attest_records()
    plan = plan_re_attestation(
        records, _previous_claims(records), frozenset({"moved", "moved-too"})
    )
    assert plan.re_signed == ("moved", "moved-too")
    assert plan.needs_signature == ()
    assert plan.carried_forward == ("carried",)
    assert plan.first_signature == ("fresh",)


def test_a_name_that_was_not_refused_refuses_the_whole_run():
    """A stale list. The operator looked at *something*, but not at what this run
    is doing — and a flag that silently ignored the surplus name would report
    success against a decision made about a different corpus."""
    records = _re_attest_records()
    with pytest.raises(SystemExit) as excinfo:
        plan_re_attestation(
            records,
            _previous_claims(records),
            frozenset({"moved", "moved-too", "carried"}),
        )
    message = str(excinfo.value)
    assert "named but not refused" in message
    assert "carried" in message


def test_a_refusal_nobody_named_refuses_the_whole_run():
    """The direction a `--force` cannot express, and the one that protects the
    corpus: a refusal that appeared after the list was written would otherwise be
    attested on the strength of a human decision about other records."""
    records = _re_attest_records()
    with pytest.raises(SystemExit) as excinfo:
        plan_re_attestation(records, _previous_claims(records), frozenset({"moved"}))
    message = str(excinfo.value)
    assert "refused but not named" in message
    assert "moved-too" in message


def test_an_identity_that_is_not_in_the_corpus_is_reported_as_its_own_case():
    """A typo and a stale list are both "named but not refused" and the operator's
    fix differs — retype versus re-read the diff. Told apart so the message says
    which."""
    records = _re_attest_records()
    with pytest.raises(SystemExit) as excinfo:
        plan_re_attestation(
            records,
            _previous_claims(records),
            frozenset({"moved", "moved-too", "vqe-adpat"}),
        )
    message = str(excinfo.value)
    assert "not in the corpus" in message
    assert "vqe-adpat" in message


def test_both_directions_are_reported_in_one_refusal():
    """Two runs to learn two things about one list is two chances to give up and
    reach for a blunter tool."""
    records = _re_attest_records()
    with pytest.raises(SystemExit) as excinfo:
        plan_re_attestation(records, _previous_claims(records), frozenset({"carried"}))
    message = str(excinfo.value)
    assert "named but not refused" in message
    assert "refused but not named" in message
    assert "moved" in message and "moved-too" in message


def test_an_all_carried_corpus_accepts_no_re_attest_list_at_all():
    """Nothing refused means nothing to re-sign, so any list is stale — including
    a list of records that were genuinely refused by an *earlier* run and have
    since been attested. Re-running the same command must not re-sign twice."""
    records = _re_attest_records()
    claims = {r.upstream_identity: r.claim_hash for r in records}
    with pytest.raises(SystemExit, match="named but not refused"):
        plan_re_attestation(records, claims, frozenset({"moved"}))
    assert plan_re_attestation(records, claims, None).needs_signature == ()


def test_no_flag_and_an_empty_flag_are_different_answers():
    """`--re-attest ""` is an operator who believes they authorised something and
    did not; treating it as "no flag" would print `re_signed=0` under a command
    line that says otherwise."""
    assert parse_re_attest(None) is None
    with pytest.raises(SystemExit, match="no identities"):
        parse_re_attest("")
    with pytest.raises(SystemExit, match="no identities"):
        parse_re_attest("  ")


def test_the_list_is_whitespace_tolerant_but_refuses_a_hole():
    assert parse_re_attest(" moved , moved-too ") == frozenset({"moved", "moved-too"})
    with pytest.raises(SystemExit, match="empty identity"):
        parse_re_attest("moved,,moved-too")


def test_a_repeated_identity_refuses_rather_than_being_deduplicated():
    """A repeat is the signature of a list assembled from two sources, and the
    second source is exactly the stale list the reconciliation exists to catch."""
    with pytest.raises(SystemExit, match="more than once"):
        parse_re_attest("moved,moved-too,moved")
