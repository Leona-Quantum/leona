"""Independent, I/O-free verifier for hostile Phase 10 source results.

Source output is parsed as untrusted bytes.  This module accepts one bounded
JSON schema, binds it to the S7/S8 evidence chain, and compares source-reported
metrics with separately supplied Atlas observations.  It never executes source
content and cannot produce qualified or public evidence.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import math
import re
import uuid
from datetime import UTC, datetime
from typing import Any

from majorana_api.phase10_execution_policy import Phase10QualificationIdentityCandidate
from majorana_api.phase10_executor_probe import Phase10ExecutorProbeObservation
from majorana_api.phase10_static_candidate import OUTPUT_SCHEMA_ID

RESULT_VERIFIER_SCHEMA_VERSION = 1
RESULT_VERIFIER_CONTRACT_VERSION = "phase10-s9-result-verifier/1"
SOURCE_RESULT_SCHEMA_VERSION = 1
VERIFIER_QUALIFICATION_STATUS = "unqualified"
VERIFIER_PUBLICATION_STATUS = "blocked"
VERIFIER_BLOCKING_REASONS = (
    "external_result_owner_review_pending",
    "phase10_private_canary_pending",
    "publication_not_approved",
)

MAX_RESULT_BYTES = 256 * 1024
MAX_JSON_DEPTH = 8
MAX_JSON_NODES = 2048
MAX_METRICS = 32

_SHA256_RE = re.compile(r"[0-9a-f]{64}")
_OCI_INDEX_DIGEST_RE = re.compile(r"sha256:[0-9a-f]{64}")
_QUALIFICATION_ID_RE = re.compile(r"phase10-qic:[0-9a-f]{64}")
_PROTOCOL_ID_RE = re.compile(r"[a-z0-9][a-z0-9._/-]{0,127}")

# Metric semantics are intentionally narrow.  A metric absent from this table
# is unknown, not zero, and cannot enter a controlled comparison.
_METRIC_RULES: dict[str, tuple[str, str, float | None, float | None]] = {
    "energy": ("Ha", "real", None, None),
    "fidelity": ("1", "real", 0.0, 1.0),
    "cnot_count": ("count", "integer", 0.0, None),
    "depth": ("layers", "integer", 0.0, None),
    "parameter_count": ("count", "integer", 0.0, None),
    "iteration_count": ("count", "integer", 0.0, None),
    "measurement_count": ("shots", "integer", 0.0, None),
}
_ABSOLUTE_TOLERANCE = {
    "energy": 1e-9,
    "fidelity": 1e-12,
}


class Phase10ResultVerifierError(ValueError):
    """Hostile result or verifier evidence failed a stable S9 contract."""

    def __init__(self, failure_code: str):
        super().__init__(failure_code)
        self.failure_code = failure_code
        self.retryable = False


@dataclasses.dataclass(frozen=True)
class Phase10ResultBindings:
    qualification_identity: str
    source_manifest_sha256: str
    static_candidate_sha256: str
    workflow_sha256: str
    component_configuration_sha256: str
    runtime_oci_index_digest: str
    policy_sha256: str
    input_sha256: str
    seed_sha256: str
    executor_observation_sha256: str

    def __post_init__(self) -> None:
        if _QUALIFICATION_ID_RE.fullmatch(self.qualification_identity) is None:
            raise Phase10ResultVerifierError("result_binding_mismatch")
        digest_fields = (
            self.source_manifest_sha256,
            self.static_candidate_sha256,
            self.workflow_sha256,
            self.component_configuration_sha256,
            self.policy_sha256,
            self.input_sha256,
            self.seed_sha256,
            self.executor_observation_sha256,
        )
        if any(not _is_sha256(value) for value in digest_fields):
            raise Phase10ResultVerifierError("result_binding_mismatch")
        if _OCI_INDEX_DIGEST_RE.fullmatch(self.runtime_oci_index_digest) is None:
            raise Phase10ResultVerifierError("result_binding_mismatch")

    @property
    def bindings_sha256(self) -> str:
        return _canonical_sha256(self.descriptor())

    def descriptor(self) -> dict[str, str]:
        return dataclasses.asdict(self)

    @classmethod
    def from_descriptor(cls, value: Any) -> Phase10ResultBindings:
        expected = {field.name for field in dataclasses.fields(cls)}
        if not isinstance(value, dict) or set(value) != expected:
            raise Phase10ResultVerifierError("result_binding_mismatch")
        return cls(**value)


@dataclasses.dataclass(frozen=True)
class Phase10Metric:
    name: str
    value: int | float
    unit: str
    protocol_id: str
    origin: str

    def __post_init__(self) -> None:
        rule = _METRIC_RULES.get(self.name)
        if rule is None or self.origin not in {"source_reported", "atlas_observed"}:
            raise Phase10ResultVerifierError("result_schema_invalid")
        expected_unit, number_kind, minimum, maximum = rule
        if self.unit != expected_unit or _PROTOCOL_ID_RE.fullmatch(self.protocol_id) is None:
            raise Phase10ResultVerifierError("result_schema_invalid")
        if isinstance(self.value, bool) or not isinstance(self.value, (int, float)):
            raise Phase10ResultVerifierError("result_schema_invalid")
        if not math.isfinite(float(self.value)):
            raise Phase10ResultVerifierError("result_schema_invalid")
        if number_kind == "integer":
            if not isinstance(self.value, int):
                raise Phase10ResultVerifierError("result_schema_invalid")
        else:
            # Normalizing every real metric to float makes 1 and 1.0 share the
            # same format-independent fingerprint after JSON parsing.
            object.__setattr__(self, "value", float(self.value))
        numeric = float(self.value)
        if minimum is not None and numeric < minimum:
            raise Phase10ResultVerifierError("scientific_invariant_failed")
        if maximum is not None and numeric > maximum:
            raise Phase10ResultVerifierError("scientific_invariant_failed")

    @property
    def identity(self) -> tuple[str, str, str]:
        return self.name, self.unit, self.protocol_id

    def descriptor(self) -> dict[str, str | int | float]:
        return dataclasses.asdict(self)

    @classmethod
    def from_descriptor(cls, value: Any, *, required_origin: str) -> Phase10Metric:
        if not isinstance(value, dict) or set(value) != {
            "name",
            "value",
            "unit",
            "protocol_id",
            "origin",
        }:
            raise Phase10ResultVerifierError("result_schema_invalid")
        if value.get("origin") != required_origin:
            raise Phase10ResultVerifierError("result_schema_invalid")
        return cls(**value)


@dataclasses.dataclass(frozen=True)
class Phase10SourceResult:
    status: str
    bindings: Phase10ResultBindings
    metrics: tuple[Phase10Metric, ...]
    output_schema_id: str = OUTPUT_SCHEMA_ID

    def __post_init__(self) -> None:
        if self.status not in {"succeeded", "failed"} or self.output_schema_id != OUTPUT_SCHEMA_ID:
            raise Phase10ResultVerifierError("result_schema_invalid")
        if not self.metrics or len(self.metrics) > MAX_METRICS:
            raise Phase10ResultVerifierError("result_schema_invalid")
        if any(metric.origin != "source_reported" for metric in self.metrics):
            raise Phase10ResultVerifierError("result_schema_invalid")
        identities = tuple(metric.identity for metric in self.metrics)
        if len(set(identities)) != len(identities):
            raise Phase10ResultVerifierError("result_schema_invalid")

    def body(self) -> dict[str, Any]:
        return {
            "source_result_schema_version": SOURCE_RESULT_SCHEMA_VERSION,
            "output_schema_id": self.output_schema_id,
            "status": self.status,
            "bindings": self.bindings.descriptor(),
            "metrics": [metric.descriptor() for metric in self.metrics],
        }

    @property
    def result_sha256(self) -> str:
        return _canonical_sha256(self.body())

    def to_result(self) -> dict[str, Any]:
        return {**self.body(), "result_sha256": self.result_sha256}


@dataclasses.dataclass(frozen=True)
class Phase10InvariantResult:
    metric_name: str
    protocol_id: str
    passed: bool
    failure_code: str | None

    def __post_init__(self) -> None:
        if self.metric_name not in _METRIC_RULES:
            raise Phase10ResultVerifierError("invalid_verifier_observation")
        if _PROTOCOL_ID_RE.fullmatch(self.protocol_id) is None or not isinstance(self.passed, bool):
            raise Phase10ResultVerifierError("invalid_verifier_observation")
        expected = None if self.passed else "scientific_invariant_failed"
        if self.failure_code != expected:
            raise Phase10ResultVerifierError("invalid_verifier_observation")

    def descriptor(self) -> dict[str, str | bool | None]:
        return dataclasses.asdict(self)

    @classmethod
    def from_descriptor(cls, value: Any) -> Phase10InvariantResult:
        if not isinstance(value, dict) or set(value) != {
            "metric_name",
            "protocol_id",
            "passed",
            "failure_code",
        }:
            raise Phase10ResultVerifierError("invalid_verifier_observation")
        return cls(**value)


@dataclasses.dataclass(frozen=True)
class Phase10ResultVerifierObservation:
    attempt_id: str
    verified_at: str
    expected_bindings_sha256: str
    raw_result_sha256: str
    source_result_sha256: str | None
    source_status: str | None
    source_reported_metrics: tuple[Phase10Metric, ...]
    atlas_observed_metrics: tuple[Phase10Metric, ...]
    invariant_results: tuple[Phase10InvariantResult, ...]
    verification_outcome: str
    failure_code: str | None
    qualification_status: str = VERIFIER_QUALIFICATION_STATUS
    publication_status: str = VERIFIER_PUBLICATION_STATUS
    blocking_reasons: tuple[str, ...] = VERIFIER_BLOCKING_REASONS
    contract_version: str = RESULT_VERIFIER_CONTRACT_VERSION

    def __post_init__(self) -> None:
        _validate_verifier_observation(self)

    def body(self) -> dict[str, Any]:
        return {
            "result_verifier_schema_version": RESULT_VERIFIER_SCHEMA_VERSION,
            "contract_version": self.contract_version,
            "qualification_status": self.qualification_status,
            "publication_status": self.publication_status,
            "attempt_id": self.attempt_id,
            "verified_at": self.verified_at,
            "expected_bindings_sha256": self.expected_bindings_sha256,
            "raw_result_sha256": self.raw_result_sha256,
            "source_result_sha256": self.source_result_sha256,
            "source_status": self.source_status,
            "source_reported_metrics": [item.descriptor() for item in self.source_reported_metrics],
            "atlas_observed_metrics": [item.descriptor() for item in self.atlas_observed_metrics],
            "invariant_results": [item.descriptor() for item in self.invariant_results],
            "verification_outcome": self.verification_outcome,
            "failure_code": self.failure_code,
            "blocking_reasons": list(self.blocking_reasons),
        }

    @property
    def observation_sha256(self) -> str:
        return _canonical_sha256(self.body())

    def to_observation(self) -> dict[str, Any]:
        return {**self.body(), "observation_sha256": self.observation_sha256}

    @classmethod
    def from_observation(cls, payload: dict[str, Any]) -> Phase10ResultVerifierObservation:
        expected = {
            "result_verifier_schema_version",
            "contract_version",
            "qualification_status",
            "publication_status",
            "attempt_id",
            "verified_at",
            "expected_bindings_sha256",
            "raw_result_sha256",
            "source_result_sha256",
            "source_status",
            "source_reported_metrics",
            "atlas_observed_metrics",
            "invariant_results",
            "verification_outcome",
            "failure_code",
            "blocking_reasons",
            "observation_sha256",
        }
        if not isinstance(payload, dict) or set(payload) != expected:
            raise Phase10ResultVerifierError("invalid_verifier_observation")
        if payload["result_verifier_schema_version"] != RESULT_VERIFIER_SCHEMA_VERSION:
            raise Phase10ResultVerifierError("unsupported_result_verifier_schema")
        list_fields = (
            "source_reported_metrics",
            "atlas_observed_metrics",
            "invariant_results",
            "blocking_reasons",
        )
        if any(not isinstance(payload[field], list) for field in list_fields):
            raise Phase10ResultVerifierError("invalid_verifier_observation")
        observation = cls(
            attempt_id=payload["attempt_id"],
            verified_at=payload["verified_at"],
            expected_bindings_sha256=payload["expected_bindings_sha256"],
            raw_result_sha256=payload["raw_result_sha256"],
            source_result_sha256=payload["source_result_sha256"],
            source_status=payload["source_status"],
            source_reported_metrics=tuple(
                Phase10Metric.from_descriptor(item, required_origin="source_reported")
                for item in payload["source_reported_metrics"]
            ),
            atlas_observed_metrics=tuple(
                Phase10Metric.from_descriptor(item, required_origin="atlas_observed")
                for item in payload["atlas_observed_metrics"]
            ),
            invariant_results=tuple(
                Phase10InvariantResult.from_descriptor(item)
                for item in payload["invariant_results"]
            ),
            verification_outcome=payload["verification_outcome"],
            failure_code=payload["failure_code"],
            qualification_status=payload["qualification_status"],
            publication_status=payload["publication_status"],
            blocking_reasons=tuple(payload["blocking_reasons"]),
            contract_version=payload["contract_version"],
        )
        if payload["observation_sha256"] != observation.observation_sha256:
            raise Phase10ResultVerifierError("verifier_observation_digest_mismatch")
        return observation


def build_phase10_result_bindings(
    *,
    identity: Phase10QualificationIdentityCandidate,
    executor_observation: Phase10ExecutorProbeObservation,
    workflow_sha256: str,
    component_configuration_sha256: str,
    input_sha256: str,
    seed_sha256: str,
) -> Phase10ResultBindings:
    if not isinstance(identity, Phase10QualificationIdentityCandidate):
        raise Phase10ResultVerifierError("result_binding_mismatch")
    if not isinstance(executor_observation, Phase10ExecutorProbeObservation):
        raise Phase10ResultVerifierError("result_binding_mismatch")
    if (
        executor_observation.qualification_identity != identity.candidate_qualification_identity
        or executor_observation.policy_sha256 != identity.policy_sha256
        or executor_observation.runtime_oci_index_digest != identity.runtime_oci_index_digest
        or executor_observation.probe_outcome != "passed"
    ):
        raise Phase10ResultVerifierError("result_binding_mismatch")
    return Phase10ResultBindings(
        qualification_identity=identity.candidate_qualification_identity,
        source_manifest_sha256=identity.normalized_source_manifest_sha256,
        static_candidate_sha256=identity.static_candidate_sha256,
        workflow_sha256=workflow_sha256,
        component_configuration_sha256=component_configuration_sha256,
        runtime_oci_index_digest=identity.runtime_oci_index_digest,
        policy_sha256=identity.policy_sha256,
        input_sha256=input_sha256,
        seed_sha256=seed_sha256,
        executor_observation_sha256=executor_observation.observation_sha256,
    )


def parse_phase10_source_result(raw_result: bytes) -> Phase10SourceResult:
    if not isinstance(raw_result, bytes) or not raw_result or len(raw_result) > MAX_RESULT_BYTES:
        raise Phase10ResultVerifierError("result_schema_invalid")
    try:
        text = raw_result.decode("utf-8")
        payload = json.loads(
            text,
            object_pairs_hook=_strict_object,
            parse_constant=lambda _value: _raise_schema_invalid(),
        )
    except (UnicodeDecodeError, json.JSONDecodeError, Phase10ResultVerifierError) as exc:
        if isinstance(exc, Phase10ResultVerifierError):
            raise
        raise Phase10ResultVerifierError("result_schema_invalid") from exc
    _validate_json_bounds(payload)
    expected = {
        "source_result_schema_version",
        "output_schema_id",
        "status",
        "bindings",
        "metrics",
        "result_sha256",
    }
    if not isinstance(payload, dict) or set(payload) != expected:
        raise Phase10ResultVerifierError("result_schema_invalid")
    if payload["source_result_schema_version"] != SOURCE_RESULT_SCHEMA_VERSION:
        raise Phase10ResultVerifierError("result_schema_invalid")
    if not isinstance(payload["metrics"], list):
        raise Phase10ResultVerifierError("result_schema_invalid")
    result = Phase10SourceResult(
        status=payload["status"],
        bindings=Phase10ResultBindings.from_descriptor(payload["bindings"]),
        metrics=tuple(
            Phase10Metric.from_descriptor(item, required_origin="source_reported")
            for item in payload["metrics"]
        ),
        output_schema_id=payload["output_schema_id"],
    )
    if payload["result_sha256"] != result.result_sha256:
        raise Phase10ResultVerifierError("result_binding_mismatch")
    return result


def verify_phase10_source_result(
    *,
    raw_result: bytes,
    expected_bindings: Phase10ResultBindings,
    atlas_observed_metrics: tuple[Phase10Metric, ...],
    attempt_id: uuid.UUID,
    verified_at: datetime,
) -> Phase10ResultVerifierObservation:
    """Return append-only verifier evidence; hostile source failures are data."""

    if not isinstance(expected_bindings, Phase10ResultBindings):
        raise Phase10ResultVerifierError("result_binding_mismatch")
    if not isinstance(attempt_id, uuid.UUID):
        raise Phase10ResultVerifierError("invalid_verifier_observation")
    if any(metric.origin != "atlas_observed" for metric in atlas_observed_metrics):
        raise Phase10ResultVerifierError("invalid_verifier_observation")
    observed_ids = tuple(metric.identity for metric in atlas_observed_metrics)
    if not atlas_observed_metrics or len(set(observed_ids)) != len(observed_ids):
        raise Phase10ResultVerifierError("invalid_verifier_observation")

    raw_sha256 = hashlib.sha256(raw_result if isinstance(raw_result, bytes) else b"").hexdigest()
    source_result: Phase10SourceResult | None = None
    failure_code: str | None = None
    invariants: tuple[Phase10InvariantResult, ...] = ()
    try:
        source_result = parse_phase10_source_result(raw_result)
        if source_result.bindings != expected_bindings:
            raise Phase10ResultVerifierError("result_binding_mismatch")
        if source_result.status != "succeeded":
            raise Phase10ResultVerifierError("source_reported_failure")
        invariants = _compare_metrics(source_result.metrics, atlas_observed_metrics)
        if not all(item.passed for item in invariants):
            raise Phase10ResultVerifierError("scientific_invariant_failed")
    except Phase10ResultVerifierError as exc:
        failure_code = exc.failure_code

    accepted = failure_code is None
    return Phase10ResultVerifierObservation(
        attempt_id=str(attempt_id),
        verified_at=_canonical_timestamp(verified_at),
        expected_bindings_sha256=expected_bindings.bindings_sha256,
        raw_result_sha256=raw_sha256,
        source_result_sha256=source_result.result_sha256 if source_result else None,
        source_status=source_result.status if source_result else None,
        source_reported_metrics=source_result.metrics if source_result else (),
        atlas_observed_metrics=atlas_observed_metrics,
        invariant_results=invariants,
        verification_outcome="accepted_unqualified" if accepted else "rejected",
        failure_code=failure_code,
    )


def _compare_metrics(
    source_metrics: tuple[Phase10Metric, ...],
    observed_metrics: tuple[Phase10Metric, ...],
) -> tuple[Phase10InvariantResult, ...]:
    observed = {metric.identity: metric for metric in observed_metrics}
    results: list[Phase10InvariantResult] = []
    for metric in source_metrics:
        independent = observed.get(metric.identity)
        passed = independent is not None and _metric_values_match(metric, independent)
        results.append(
            Phase10InvariantResult(
                metric_name=metric.name,
                protocol_id=metric.protocol_id,
                passed=passed,
                failure_code=None if passed else "scientific_invariant_failed",
            )
        )
    return tuple(results)


def _metric_values_match(source: Phase10Metric, observed: Phase10Metric) -> bool:
    tolerance = _ABSOLUTE_TOLERANCE.get(source.name)
    if tolerance is None:
        return source.value == observed.value
    return math.isclose(float(source.value), float(observed.value), rel_tol=0.0, abs_tol=tolerance)


def _validate_verifier_observation(observation: Phase10ResultVerifierObservation) -> None:
    if (
        observation.contract_version != RESULT_VERIFIER_CONTRACT_VERSION
        or observation.qualification_status != VERIFIER_QUALIFICATION_STATUS
        or observation.publication_status != VERIFIER_PUBLICATION_STATUS
        or observation.blocking_reasons != VERIFIER_BLOCKING_REASONS
    ):
        raise Phase10ResultVerifierError("verifier_not_qualified")
    try:
        uuid.UUID(observation.attempt_id)
    except (ValueError, TypeError) as exc:
        raise Phase10ResultVerifierError("invalid_verifier_observation") from exc
    if _parse_canonical_timestamp(observation.verified_at) is None:
        raise Phase10ResultVerifierError("invalid_verifier_observation")
    digests = (
        observation.expected_bindings_sha256,
        observation.raw_result_sha256,
    )
    if any(not _is_sha256(value) for value in digests):
        raise Phase10ResultVerifierError("invalid_verifier_observation")
    if observation.source_result_sha256 is not None and not _is_sha256(
        observation.source_result_sha256
    ):
        raise Phase10ResultVerifierError("invalid_verifier_observation")
    if any(item.origin != "source_reported" for item in observation.source_reported_metrics):
        raise Phase10ResultVerifierError("invalid_verifier_observation")
    if any(item.origin != "atlas_observed" for item in observation.atlas_observed_metrics):
        raise Phase10ResultVerifierError("invalid_verifier_observation")
    source_identities = tuple(item.identity for item in observation.source_reported_metrics)
    observed_identities = tuple(item.identity for item in observation.atlas_observed_metrics)
    invariant_identities = tuple(
        (item.metric_name, item.protocol_id) for item in observation.invariant_results
    )
    expected_invariant_identities = tuple(
        (item.name, item.protocol_id) for item in observation.source_reported_metrics
    )
    if (
        len(observation.source_reported_metrics) > MAX_METRICS
        or len(observation.atlas_observed_metrics) > MAX_METRICS
        or len(observation.invariant_results) > MAX_METRICS
        or len(set(source_identities)) != len(source_identities)
        or len(set(observed_identities)) != len(observed_identities)
        or len(set(invariant_identities)) != len(invariant_identities)
    ):
        raise Phase10ResultVerifierError("invalid_verifier_observation")
    if observation.verification_outcome == "accepted_unqualified":
        if (
            observation.failure_code is not None
            or observation.source_result_sha256 is None
            or observation.source_status != "succeeded"
            or not observation.invariant_results
            or not all(item.passed for item in observation.invariant_results)
            or invariant_identities != expected_invariant_identities
        ):
            raise Phase10ResultVerifierError("invalid_verifier_observation")
    elif observation.verification_outcome == "rejected":
        if observation.failure_code not in {
            "result_schema_invalid",
            "result_binding_mismatch",
            "scientific_invariant_failed",
            "source_reported_failure",
        }:
            raise Phase10ResultVerifierError("invalid_verifier_observation")
        if observation.failure_code == "result_schema_invalid" and (
            observation.source_result_sha256 is not None
            or observation.source_status is not None
            or observation.source_reported_metrics
            or observation.invariant_results
        ):
            raise Phase10ResultVerifierError("invalid_verifier_observation")
        if observation.failure_code == "result_binding_mismatch" and observation.invariant_results:
            raise Phase10ResultVerifierError("invalid_verifier_observation")
        if observation.failure_code == "source_reported_failure" and (
            observation.source_result_sha256 is None
            or observation.source_status != "failed"
            or not observation.source_reported_metrics
            or observation.invariant_results
        ):
            raise Phase10ResultVerifierError("invalid_verifier_observation")
        if observation.failure_code == "scientific_invariant_failed":
            scientific_parse_failure = (
                observation.source_result_sha256 is None
                and observation.source_status is None
                and not observation.source_reported_metrics
                and not observation.invariant_results
            )
            scientific_comparison_failure = (
                observation.source_result_sha256 is not None
                and observation.source_status == "succeeded"
                and bool(observation.source_reported_metrics)
                and bool(observation.invariant_results)
                and not all(item.passed for item in observation.invariant_results)
                and invariant_identities == expected_invariant_identities
            )
            if not (scientific_parse_failure or scientific_comparison_failure):
                raise Phase10ResultVerifierError("invalid_verifier_observation")
    else:
        raise Phase10ResultVerifierError("invalid_verifier_observation")


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise Phase10ResultVerifierError("result_schema_invalid")
        result[key] = value
    return result


def _raise_schema_invalid() -> None:
    raise Phase10ResultVerifierError("result_schema_invalid")


def _validate_json_bounds(value: Any) -> None:
    nodes = 0

    def walk(item: Any, depth: int) -> None:
        nonlocal nodes
        nodes += 1
        if nodes > MAX_JSON_NODES or depth > MAX_JSON_DEPTH:
            raise Phase10ResultVerifierError("result_schema_invalid")
        if isinstance(item, dict):
            for key, child in item.items():
                if not isinstance(key, str) or len(key) > 128:
                    raise Phase10ResultVerifierError("result_schema_invalid")
                walk(child, depth + 1)
        elif isinstance(item, list):
            for child in item:
                walk(child, depth + 1)
        elif isinstance(item, str) and len(item) > 512:
            raise Phase10ResultVerifierError("result_schema_invalid")

    walk(value, 0)


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _canonical_timestamp(value: datetime) -> str:
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise Phase10ResultVerifierError("invalid_verifier_observation")
    return value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _parse_canonical_timestamp(value: str) -> datetime | None:
    if not isinstance(value, str) or not value.endswith("Z"):
        return None
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        return None
    if _canonical_timestamp(parsed) != value:
        return None
    return parsed


def _is_sha256(value: Any) -> bool:
    return isinstance(value, str) and _SHA256_RE.fullmatch(value) is not None
