"""Submission must fail closed at every gate, in order, with a typed reason."""

import pytest

from majorana_qpu import (
    IbmRuntimeProvider,
    QpuDisabledError,
    QpuJobRequest,
    QpuSubmissionBlockReason,
    submission_block_reason,
)

REQUEST = QpuJobRequest(
    device_id="ibm.open_plan",
    shots=128,
    qasm='OPENQASM 3.0; include "stdgates.inc"; qubit[2] q; bit[2] c; h q[0]; cx q[0], q[1]; c = measure q;',
    source_fingerprint="fnv1a-deadbeef",
)


def test_disabled_by_default():
    assert submission_block_reason({}) is QpuSubmissionBlockReason.SUBMISSION_DISABLED


def test_flag_alone_is_not_enough():
    assert (
        submission_block_reason({"MAJORANA_QPU_SUBMIT_ENABLED": "true"})
        is QpuSubmissionBlockReason.CREDENTIALS_UNCONFIGURED
    )


def test_blank_token_is_not_a_credential():
    env = {"MAJORANA_QPU_SUBMIT_ENABLED": "true", "MAJORANA_QPU_IBM_TOKEN": "   "}
    assert submission_block_reason(env) is QpuSubmissionBlockReason.CREDENTIALS_UNCONFIGURED


def test_missing_runtime_dependency_blocks_even_with_flag_and_token(monkeypatch):
    # qiskit-ibm-runtime IS installed now (worker depends on majorana-qpu[ibm]),
    # so its absence has to be simulated: a deployment built without the extra
    # must still report the typed reason rather than crash at submit time.
    import builtins

    real_import = builtins.__import__

    def blocking_import(name, *args, **kwargs):
        if name.startswith("qiskit_ibm_runtime"):
            raise ImportError("simulated absence of qiskit-ibm-runtime")
        return real_import(name, *args, **kwargs)

    monkeypatch.delitem(__import__("sys").modules, "qiskit_ibm_runtime", raising=False)
    monkeypatch.setattr(builtins, "__import__", blocking_import)
    env = {"MAJORANA_QPU_SUBMIT_ENABLED": "true", "MAJORANA_QPU_IBM_TOKEN": "tok"}
    assert submission_block_reason(env) is QpuSubmissionBlockReason.PROVIDER_DEPENDENCY_MISSING


def test_submit_raises_typed_error_when_blocked():
    provider = IbmRuntimeProvider(environ={})
    with pytest.raises(QpuDisabledError) as excinfo:
        provider.submit(REQUEST)
    assert excinfo.value.reason is QpuSubmissionBlockReason.SUBMISSION_DISABLED


def test_estimate_never_requires_credentials():
    provider = IbmRuntimeProvider(environ={})
    result = provider.estimate(REQUEST)
    assert result.total_usd is None  # free queue: no fabricated dollar figure
