from datetime import datetime, timezone
from uuid import uuid4

from majorana_openqasm import fingerprint, normalize, resource_metrics

from majorana_api.repos.system import (
    STARTER_BELL_CODE,
    STARTER_BELL_QASM,
    insert_seed_artifact_version,
    starter_bell_slug,
)
from majorana_api.routes.artifacts import _canonical_public_qasm


def test_starter_bell_payload_is_a_valid_lossless_reference():
    metrics = resource_metrics(STARTER_BELL_QASM)

    assert metrics.qubits == 2
    assert metrics.gate_count == 2
    assert metrics.measurement_count == 2
    assert normalize(STARTER_BELL_QASM).startswith("OPENQASM 3.0;")
    assert len(fingerprint(STARTER_BELL_QASM)) == 64
    assert "QuantumCircuit" in STARTER_BELL_CODE
    assert STARTER_BELL_QASM.startswith("OPENQASM 3.0;")


def test_starter_bell_slug_is_workspace_specific():
    workspace_a = uuid4()
    workspace_b = uuid4()

    assert starter_bell_slug(workspace_a) != starter_bell_slug(workspace_b)
    assert starter_bell_slug(workspace_a).endswith(workspace_a.hex)


def test_public_qasm_is_normalized_before_persistence():
    qasm2 = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[1];\nh q[0];\n'
    qasm, version, digest = _canonical_public_qasm(qasm2)

    assert qasm and qasm.startswith("OPENQASM 3.0;")
    assert version == "3.0"
    assert digest and len(digest) == 64


def test_seed_version_helper_normalizes_and_fingerprints_qasm():
    class RecordingCursor:
        statement = None
        params = None

        def execute(self, statement, params):
            self.statement = statement
            self.params = params

    cursor = RecordingCursor()
    qasm2 = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[1];\nh q[0];\n'
    insert_seed_artifact_version(
        cursor,
        version_id=uuid4(),
        artifact_id=uuid4(),
        seq=1,
        qasm=qasm2,
        code="print('seed')",
        code_lang="python",
        fallback_fingerprint="unused",
        export_status="lossless",
        resource_estimates="{}",
        created_at=datetime.now(timezone.utc),
    )

    assert cursor.params[3] == "3.0"
    assert cursor.params[8].startswith("OPENQASM 3.0;")
    assert cursor.params[6] == fingerprint(cursor.params[8])
