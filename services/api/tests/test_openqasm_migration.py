import importlib.util
from pathlib import Path

import pytest
from qiskit.qasm2 import QASM2ParseError


def _migration_module(filename: str):
    path = Path(__file__).resolve().parents[3] / "db" / "migrations" / "versions" / filename
    spec = importlib.util.spec_from_file_location("migration_0008", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_normalizes_legacy_qasm2_standard_gates():
    source = "OPENQASM 2.0;\nqreg q[1];\nu(0.1, 0.2, 0.3) q[0];\n"
    canonical = _migration_module("0008_openqasm_canonical.py")._normalize_qasm(source)
    assert canonical.startswith("OPENQASM 3.0;")
    assert "U(0.1, 0.2, 0.3) q[0];" in canonical


def test_migration_still_rejects_unknown_legacy_gates():
    source = "OPENQASM 2.0;\nqreg q[1];\nnot_a_gate q[0];\n"
    with pytest.raises(QASM2ParseError):
        _migration_module("0008_openqasm_canonical.py")._normalize_qasm(source)


def test_fingerprint_repair_hashes_normalized_qasm_bytes():
    module = _migration_module("0009_qasm_fingerprints.py")
    assert module._qasm_fingerprint("OPENQASM 3.0;\n") == (
        "1ab41b2be4d7a99a983b0ee62a63b557ea08b99c859c1204d24523cbbdacb740"
    )
