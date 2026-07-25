import json
from pathlib import Path

from majorana_vqe.models import ComponentType
from majorana_vqe.portable import PORTABLE_SCIENTIFIC_ROLES

_MANIFEST = (
    Path(__file__).resolve().parents[4]
    / "docs"
    / "atlas"
    / "fixtures"
    / "h2_sto3g"
    / "registry_manifest_v0.2.json"
)


def test_registry_manifest_is_machine_valid_but_never_claims_human_review():
    manifest = json.loads(_MANIFEST.read_text())
    assert manifest["publication_state"] == "blocked_pending_human_review"
    assert manifest["review_gate"]["required"] is True
    assert manifest["review_gate"]["reviewer_identity"] is None
    assert manifest["workflow"]["human_review_state"] == "unreviewed"
    assert all(record["human_review_state"] == "unreviewed" for record in manifest["components"])


def test_registry_manifest_has_every_portable_role_once_and_no_registry_uuid():
    manifest = json.loads(_MANIFEST.read_text())
    roles = [ComponentType(record["role"]) for record in manifest["components"]]
    assert len(roles) == len(set(roles)) == len(PORTABLE_SCIENTIFIC_ROLES)
    assert set(roles) == set(PORTABLE_SCIENTIFIC_ROLES)
    assert "artifact_version_id" not in _MANIFEST.read_text()


def test_registry_manifest_pins_two_independent_framework_evidence_files():
    manifest = json.loads(_MANIFEST.read_text())
    evidence = manifest["runtime_spike_evidence"]
    assert {item["framework"] for item in evidence} == {"qiskit", "pennylane"}
    assert all(len(item["sha256"]) == 64 for item in evidence)
