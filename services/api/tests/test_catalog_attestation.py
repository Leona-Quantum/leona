"""Pure-policy tests for the owner bulk license attestation (Slice C.5).

No database: this is the layer that decides *which* records a human grant
covers, and every property worth defending here is about failing closed rather
than about persistence. The live half (provenance + approval actually landing on
staged rows) is test_catalog_attestation_live.py.
"""

import json

import pytest

from majorana_api.catalog_admin import _bootstrap_plan
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
    """The shipped policy must classify all 285 pinned records with nothing
    left over — that total is what makes the 283/2 split a decision rather
    than an accident of which records happened to match."""
    policy = AttestationPolicy.load()
    plan = _bootstrap_plan(BootstrapManifestSource(), policy)
    assert policy.spdx_id == "CC-BY-4.0"
    assert len(plan.included) + len(plan.excluded) == 285
    assert len(plan.included) == 283
    assert sorted(r.upstream_identity for r in plan.excluded) == [
        "grover-4bit-search",
        "simon-query-circuit",
    ]


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
