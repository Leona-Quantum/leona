"""Static-guard tests. The guard is defense-in-depth; these assert it blocks the
high-confidence dangerous classes and passes legitimate quantum code."""

import pytest
from majorana_sandbox import check_python_code

LEGIT = """
import numpy as np
from qiskit import QuantumCircuit
import json

qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
print(json.dumps({"ok": True}))
"""


def test_legitimate_quantum_code_passes():
    assert check_python_code(LEGIT).ok


@pytest.mark.parametrize(
    "code, needle",
    [
        ("import os\nos.system('id')", "denied_token:os.system"),
        ("import socket", "denied_token:socket"),
        ("import urllib.request", "denied_token:urllib"),
        ("import subprocess", "denied_token:subprocess"),
        ("__import__('os')", "denied_token:__import__"),
        ("import requests\nrequests.get('http://x')", "denied_token:requests."),
        ("open('/etc/passwd')", "denied_call:open"),
        ("eval('1+1')", "denied_call:eval"),
        ("exec('x=1')", "denied_call:exec"),
        ("import pickle", "denied_token:pickle"),
        ("x = ().__class__.__bases__[0].__subclasses__()", "denied_token:__subclasses__"),
        (
            "import urllib.request\nurllib.request.urlopen('http://169.254.169.254')",
            "169.254.169.254",
        ),
    ],
)
def test_dangerous_constructs_are_blocked(code, needle):
    result = check_python_code(code)
    assert not result.ok
    assert any(needle in v for v in result.violations)


def test_disallowed_import_is_flagged():
    result = check_python_code("import antigravity")
    assert not result.ok
    assert "disallowed_import:antigravity" in result.violations


def test_method_eval_is_not_a_denied_call():
    # `expr.eval(...)` on a library object is legitimate; only bare eval( is denied.
    assert check_python_code("import sympy\nsympy.Symbol('x')").ok
