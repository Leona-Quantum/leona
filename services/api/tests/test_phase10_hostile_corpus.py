from __future__ import annotations

import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
THREAT_MATRIX = REPO_ROOT / "docs/atlas/evidence/phase10/threat_control_matrix_v1.json"
HOSTILE_CORPUS = REPO_ROOT / "docs/atlas/evidence/phase10/hostile_corpus_manifest_v1.json"


def _load(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def test_hostile_corpus_has_exactly_one_fixture_for_every_s1_threat():
    threats = _load(THREAT_MATRIX)["threats"]
    corpus = _load(HOSTILE_CORPUS)
    fixtures = corpus["fixtures"]

    expected_ids = {item["id"] for item in threats}
    actual_ids = [item["threat_id"] for item in fixtures]
    assert len(actual_ids) == len(set(actual_ids))
    assert set(actual_ids) == expected_ids


def test_fixture_identity_stage_and_failure_code_match_threat_authority():
    threats = {item["id"]: item for item in _load(THREAT_MATRIX)["threats"]}
    fixtures = _load(HOSTILE_CORPUS)["fixtures"]

    for fixture in fixtures:
        threat = threats[fixture["threat_id"]]
        assert fixture["fixture_id"] == threat["fixture_id"]
        assert fixture["target_stage"] == threat["target_stage"]
        assert fixture["expected_failure_code"] == threat["failure_code"]


def test_corpus_is_inert_unqualified_and_does_not_claim_live_success():
    corpus = _load(HOSTILE_CORPUS)

    assert corpus["schema_version"] == 1
    assert corpus["corpus_version"] == "phase10-hostile-corpus/1"
    assert corpus["execution_mode"] == "offline_inert_only"
    assert corpus["qualification_status"] == "unqualified"
    assert corpus["publication_status"] == "blocked"
    assert all(
        item["execution_state"] in {"offline_tested", "live_blocked", "recorded_only"}
        for item in corpus["fixtures"]
    )
    assert any(item["execution_state"] == "live_blocked" for item in corpus["fixtures"])
    assert any(item["execution_state"] == "recorded_only" for item in corpus["fixtures"])
    assert len(corpus["non_claims"]) >= 3


def test_every_fixture_locator_exists_and_no_fixture_embeds_executable_content():
    corpus = _load(HOSTILE_CORPUS)
    forbidden_keys = {"command", "source", "script", "environment", "credential"}

    for fixture in corpus["fixtures"]:
        assert set(fixture).isdisjoint(forbidden_keys)
        locator = REPO_ROOT / fixture["test_locator"]
        assert locator.is_file(), fixture["test_locator"]

    for control in corpus["benign_controls"]:
        assert (REPO_ROOT / control["test_locator"]).is_file()


def test_result_integrity_threats_are_backed_by_the_s9_verifier_suite():
    fixtures = _load(HOSTILE_CORPUS)["fixtures"]
    result_fixtures = [
        item
        for item in fixtures
        if item["threat_id"].startswith(("P10-RES-", "P10-SCI-", "P10-PUB-"))
    ]

    assert len(result_fixtures) == 6
    assert all(item["execution_state"] == "offline_tested" for item in result_fixtures)
    assert all(
        item["test_locator"] == "services/api/tests/test_phase10_result_verifier.py"
        for item in result_fixtures
    )
