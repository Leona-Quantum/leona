from __future__ import annotations

import copy
import dataclasses
import hashlib
import json
import uuid
from datetime import UTC, datetime

import pytest

from majorana_api.phase10_execution_policy import (
    POLICY_BLOCKING_REASONS,
    Phase10QualificationIdentityCandidate,
)
from majorana_api.phase10_executor_probe import (
    REQUIRED_EXECUTOR_PROBES,
    Phase10ExecutorProbeObservation,
    Phase10ExecutorProbeResult,
)
from majorana_api.phase10_result_verifier import (
    MAX_METRICS,
    MAX_RESULT_BYTES,
    VERIFIER_BLOCKING_REASONS,
    Phase10Metric,
    Phase10ResultVerifierError,
    Phase10ResultVerifierObservation,
    Phase10SourceResult,
    build_phase10_result_bindings,
    parse_phase10_source_result,
    verify_phase10_source_result,
)


def _identity() -> Phase10QualificationIdentityCandidate:
    return Phase10QualificationIdentityCandidate(
        repository_id=1234,
        full_name="example/vqe-source",
        immutable_ref="a" * 40,
        retrieval_manifest_sha256="b" * 64,
        normalized_source_manifest_sha256="c" * 64,
        static_candidate_sha256="d" * 64,
        policy_sha256="e" * 64,
        runtime_oci_index_digest=f"sha256:{'f' * 64}",
        platform="linux/amd64",
        blocking_reasons=POLICY_BLOCKING_REASONS,
    )


def _executor_observation() -> Phase10ExecutorProbeObservation:
    identity = _identity()
    probes = tuple(
        Phase10ExecutorProbeResult(
            probe_id=probe_id,
            passed=True,
            evidence_sha256=hashlib.sha256(probe_id.encode()).hexdigest(),
            failure_code=None,
        )
        for probe_id in REQUIRED_EXECUTOR_PROBES
    )
    return Phase10ExecutorProbeObservation(
        attempt_id="019faa00-0000-7000-8000-000000000001",
        observed_at="2026-08-05T00:00:00.000000Z",
        deployment_class="candidate.gvisor-v1",
        qualification_identity=identity.candidate_qualification_identity,
        policy_sha256=identity.policy_sha256,
        runtime_oci_index_digest=identity.runtime_oci_index_digest,
        platform=identity.platform,
        probes=probes,
    )


def _bindings():
    return build_phase10_result_bindings(
        identity=_identity(),
        executor_observation=_executor_observation(),
        workflow_sha256="1" * 64,
        component_configuration_sha256="2" * 64,
        input_sha256="3" * 64,
        seed_sha256="4" * 64,
    )


def test_bindings_reject_failed_executor_observation():
    observation = _executor_observation()
    failed_probe = dataclasses.replace(
        observation.probes[0],
        passed=False,
        failure_code="runtime_digest_mismatch",
    )
    failed_observation = dataclasses.replace(
        observation,
        probes=(failed_probe, *observation.probes[1:]),
    )

    with pytest.raises(Phase10ResultVerifierError, match="result_binding_mismatch"):
        build_phase10_result_bindings(
            identity=_identity(),
            executor_observation=failed_observation,
            workflow_sha256="1" * 64,
            component_configuration_sha256="2" * 64,
            input_sha256="3" * 64,
            seed_sha256="4" * 64,
        )


def _source_metric(
    name: str = "energy",
    value: int | float = -1.137306035753,
    unit: str = "Ha",
    protocol_id: str = "atlas.h2.energy/1",
) -> Phase10Metric:
    return Phase10Metric(
        name=name,
        value=value,
        unit=unit,
        protocol_id=protocol_id,
        origin="source_reported",
    )


def _observed_metric(
    name: str = "energy",
    value: int | float = -1.137306035753,
    unit: str = "Ha",
    protocol_id: str = "atlas.h2.energy/1",
) -> Phase10Metric:
    return Phase10Metric(
        name=name,
        value=value,
        unit=unit,
        protocol_id=protocol_id,
        origin="atlas_observed",
    )


def _payload(*, status: str = "succeeded", metric: Phase10Metric | None = None) -> dict:
    result = Phase10SourceResult(
        status=status,
        bindings=_bindings(),
        metrics=(metric or _source_metric(),),
    )
    return result.to_result()


def _raw(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()


def _rehash_result(payload: dict) -> None:
    body = {key: value for key, value in payload.items() if key != "result_sha256"}
    payload["result_sha256"] = hashlib.sha256(
        json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _verify(raw_result: bytes, observed: tuple[Phase10Metric, ...] | None = None):
    return verify_phase10_source_result(
        raw_result=raw_result,
        expected_bindings=_bindings(),
        atlas_observed_metrics=observed or (_observed_metric(),),
        attempt_id=uuid.UUID("019faa00-0000-7000-8000-000000000002"),
        verified_at=datetime(2026, 8, 5, tzinfo=UTC),
    )


def test_matching_result_is_accepted_but_never_qualified_or_public():
    observation = _verify(_raw(_payload()))

    assert observation.verification_outcome == "accepted_unqualified"
    assert observation.failure_code is None
    assert observation.qualification_status == "unqualified"
    assert observation.publication_status == "blocked"
    assert observation.blocking_reasons == VERIFIER_BLOCKING_REASONS
    assert observation.source_reported_metrics[0].origin == "source_reported"
    assert observation.atlas_observed_metrics[0].origin == "atlas_observed"
    assert (
        Phase10ResultVerifierObservation.from_observation(
            observation.to_observation()
        ).to_observation()
        == observation.to_observation()
    )


def test_numeric_json_format_does_not_change_real_metric_fingerprint():
    payload = _payload(
        metric=_source_metric(name="fidelity", value=1.0, unit="1", protocol_id="atlas.fidelity/1")
    )
    raw = _raw(payload).replace(b'"value":1.0', b'"value":1')
    parsed = parse_phase10_source_result(raw)

    assert parsed.metrics[0].value == 1.0
    assert parsed.result_sha256 == payload["result_sha256"]


@pytest.mark.parametrize(
    "raw_result",
    [
        b'{"status":"succeeded","status":"failed"}',
        b'{"value":NaN}',
        b'{"value":Infinity}',
        b"\xff\xfe",
        b"[]",
        b"{}",
    ],
)
def test_duplicate_nonfinite_non_utf8_or_wrong_shape_is_rejected(raw_result):
    observation = _verify(raw_result)
    assert observation.verification_outcome == "rejected"
    assert observation.failure_code == "result_schema_invalid"
    assert observation.source_result_sha256 is None


def test_oversized_and_extra_executable_content_are_rejected():
    assert _verify(b"x" * (MAX_RESULT_BYTES + 1)).failure_code == "result_schema_invalid"

    payload = _payload()
    payload["python"] = "import os"
    _rehash_result(payload)
    assert _verify(_raw(payload)).failure_code == "result_schema_invalid"


@pytest.mark.parametrize(
    "field",
    [
        "source_manifest_sha256",
        "static_candidate_sha256",
        "workflow_sha256",
        "component_configuration_sha256",
        "policy_sha256",
        "input_sha256",
        "seed_sha256",
        "executor_observation_sha256",
    ],
)
def test_each_digest_substitution_is_a_binding_failure(field):
    payload = _payload()
    payload["bindings"][field] = "0" * 64
    _rehash_result(payload)
    assert _verify(_raw(payload)).failure_code == "result_binding_mismatch"


def test_runtime_and_qualification_replay_are_binding_failures():
    for field, replacement in (
        ("runtime_oci_index_digest", f"sha256:{'0' * 64}"),
        ("qualification_identity", f"phase10-qic:{'0' * 64}"),
    ):
        payload = _payload()
        payload["bindings"][field] = replacement
        _rehash_result(payload)
        assert _verify(_raw(payload)).failure_code == "result_binding_mismatch"


def test_result_digest_tampering_is_a_binding_failure():
    payload = _payload()
    payload["metrics"][0]["value"] = -2.0
    assert _verify(_raw(payload)).failure_code == "result_binding_mismatch"


def test_source_cannot_self_certify_success_or_reference_value():
    payload = _payload(metric=_source_metric(value=-999.0))
    observation = _verify(_raw(payload))

    assert observation.verification_outcome == "rejected"
    assert observation.failure_code == "scientific_invariant_failed"
    assert observation.invariant_results[0].passed is False


def test_protocol_mismatch_and_missing_observation_never_become_zero():
    protocol_mismatch = _verify(
        _raw(_payload()),
        (_observed_metric(protocol_id="atlas.other-energy/1"),),
    )
    missing_metric = _verify(
        _raw(_payload()),
        (
            _observed_metric(
                name="cnot_count",
                value=0,
                unit="count",
                protocol_id="atlas.cnot/1",
            ),
        ),
    )

    assert protocol_mismatch.failure_code == "scientific_invariant_failed"
    assert missing_metric.failure_code == "scientific_invariant_failed"


def test_failed_source_status_is_preserved_without_becoming_verifier_success():
    observation = _verify(_raw(_payload(status="failed")))
    assert observation.source_status == "failed"
    assert observation.failure_code == "source_reported_failure"


def test_duplicate_metrics_and_out_of_domain_values_fail_closed():
    duplicate = _payload()
    duplicate["metrics"].append(copy.deepcopy(duplicate["metrics"][0]))
    _rehash_result(duplicate)
    assert _verify(_raw(duplicate)).failure_code == "result_schema_invalid"

    invalid_fidelity = _payload()
    invalid_fidelity["metrics"][0] = {
        "name": "fidelity",
        "value": 1.1,
        "unit": "1",
        "protocol_id": "atlas.fidelity/1",
        "origin": "source_reported",
    }
    _rehash_result(invalid_fidelity)
    assert _verify(_raw(invalid_fidelity)).failure_code == "scientific_invariant_failed"


def test_observation_tampering_or_status_escalation_is_rejected():
    payload = _verify(_raw(_payload())).to_observation()
    payload["publication_status"] = "public"
    payload["observation_sha256"] = hashlib.sha256(
        json.dumps(
            {key: value for key, value in payload.items() if key != "observation_sha256"},
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    with pytest.raises(Phase10ResultVerifierError, match="verifier_not_qualified"):
        Phase10ResultVerifierObservation.from_observation(payload)


def test_observation_rejects_cross_state_evidence_and_unbounded_metrics():
    accepted = _verify(_raw(_payload()))

    with pytest.raises(Phase10ResultVerifierError, match="invalid_verifier_observation"):
        dataclasses.replace(
            accepted,
            verification_outcome="rejected",
            failure_code="scientific_invariant_failed",
        )

    excessive_observations = tuple(
        _observed_metric(protocol_id=f"atlas.energy/{index}") for index in range(MAX_METRICS + 1)
    )
    with pytest.raises(Phase10ResultVerifierError, match="invalid_verifier_observation"):
        dataclasses.replace(accepted, atlas_observed_metrics=excessive_observations)


def test_bindings_refuse_an_executor_observation_for_another_identity():
    observation = dataclasses.replace(
        _executor_observation(),
        qualification_identity=f"phase10-qic:{'0' * 64}",
    )
    with pytest.raises(Phase10ResultVerifierError, match="result_binding_mismatch"):
        build_phase10_result_bindings(
            identity=_identity(),
            executor_observation=observation,
            workflow_sha256="1" * 64,
            component_configuration_sha256="2" * 64,
            input_sha256="3" * 64,
            seed_sha256="4" * 64,
        )
