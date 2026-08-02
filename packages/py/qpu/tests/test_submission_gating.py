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


def test_the_caller_half_of_the_gate_fails_closed_by_default():
    """`has_credential` defaults to False, so a call site that has not been
    taught to ask blocks rather than submits. The wrong direction here is a
    hardware job that proceeds without anyone knowing whose key it spends."""
    import inspect

    signature = inspect.signature(submission_block_reason)
    assert signature.parameters["has_credential"].default is False


def test_no_environment_token_can_open_the_credential_gate(monkeypatch):
    """The shared operator token is GONE, not merely deprecated.

    `MAJORANA_QPU_IBM_TOKEN` used to be the third gate, which meant IBM's free
    Open Plan allowance — ten minutes of QPU time per 28-day window per account —
    was shared by every user of the platform. If setting it again opened the
    gate, a deployment could quietly go back to one shared identity without any
    code change, and nothing would report it.
    """
    env = {
        "MAJORANA_QPU_SUBMIT_ENABLED": "true",
        "MAJORANA_QPU_IBM_TOKEN": "a" * 44,
        "IBM_QUANTUM_TOKEN": "a" * 44,
        "QISKIT_IBM_TOKEN": "a" * 44,
    }
    assert submission_block_reason(env) is QpuSubmissionBlockReason.CREDENTIALS_UNCONFIGURED


def test_a_caller_credential_opens_the_third_gate():
    env = {"MAJORANA_QPU_SUBMIT_ENABLED": "true"}
    assert submission_block_reason(env, has_credential=True) is None


def test_a_blank_token_is_not_a_credential():
    """Whitespace is not a key, and a provider built from one must not submit."""
    provider = IbmRuntimeProvider("   ", environ={"MAJORANA_QPU_SUBMIT_ENABLED": "true"})
    with pytest.raises(QpuDisabledError) as excinfo:
        provider.submit(REQUEST)
    assert excinfo.value.reason is QpuSubmissionBlockReason.CREDENTIALS_UNCONFIGURED


def test_the_provider_passes_the_callers_credentials_explicitly():
    """Never a saved account, never the environment.

    IBM's guidance for untrusted environments is to pass credentials on the
    call, and a worker that read a saved account would submit under whichever
    user's key was written to that container's disk first.
    """
    provider = IbmRuntimeProvider("tok-abc", instance="crn:v1:bluemix:public:quantum:us-east:a/1")
    kwargs = provider._service_kwargs()
    assert kwargs["token"] == "tok-abc"
    assert kwargs["channel"] == "ibm_quantum_platform"
    assert kwargs["instance"].startswith("crn:")


def test_the_instance_is_omitted_when_the_user_did_not_supply_one():
    """IBM resolves a single-instance account by itself; sending an empty CRN
    would be sending a header that names nothing."""
    assert "instance" not in IbmRuntimeProvider("tok-abc")._service_kwargs()


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
    env = {"MAJORANA_QPU_SUBMIT_ENABLED": "true"}
    assert (
        submission_block_reason(env, has_credential=True)
        is QpuSubmissionBlockReason.PROVIDER_DEPENDENCY_MISSING
    )


def test_submit_raises_typed_error_when_blocked():
    provider = IbmRuntimeProvider("tok", environ={})
    with pytest.raises(QpuDisabledError) as excinfo:
        provider.submit(REQUEST)
    assert excinfo.value.reason is QpuSubmissionBlockReason.SUBMISSION_DISABLED


def test_estimate_never_requires_credentials():
    provider = IbmRuntimeProvider("", environ={})
    result = provider.estimate(REQUEST)
    assert result.total_usd is None  # free queue: no fabricated dollar figure
