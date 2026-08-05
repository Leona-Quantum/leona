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


def test_braket_local_simulation_passes():
    local = (
        "from braket.circuits import Circuit\n"
        "from braket.devices import LocalSimulator\n"
        "circuit = Circuit().h(0).measure([0])\n"
        "counts = LocalSimulator().run(circuit, shots=10).result().measurement_counts\n"
    )
    assert check_python_code(local).ok


@pytest.mark.parametrize(
    "cloud",
    [
        (
            "from braket.aws import AwsDevice\n"
            "device = AwsDevice('arn:aws:braket:::device/quantum-simulator/example')\n"
        ),
        (
            "from braket import aws\n"
            "device = aws.AwsDevice('arn:aws:braket:::device/quantum-simulator/example')\n"
        ),
        (
            "from braket import aws as cloud\n"
            "task = cloud.AwsQuantumTask('arn:aws:braket:region:account:quantum-task/id')\n"
        ),
    ],
)
def test_braket_aws_submission_is_blocked_across_import_styles(cloud):
    result = check_python_code(cloud)
    assert not result.ok
    assert any(violation.startswith("denied_token:") for violation in result.violations)


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


@pytest.mark.parametrize(
    "code,needle",
    [
        # `io` is allowed for matplotlib's BytesIO buffers, and `io.open` IS the
        # `open` builtin — so the bare-call denial above was reachable around.
        # Measured passing the guard cleanly before this was added.
        ("import io\nf = io.open('/etc/passwd')", "denied_token:io.open"),
        # numpy is allowed for obvious reasons; these are its filesystem
        # primitives, and `np.load` executes pickles when asked to.
        ("import numpy as np\nnp.fromfile('/etc/passwd')", "denied_token:.fromfile"),
        ("import numpy as np\nnp.zeros(3).tofile('/tmp/x')", "denied_token:.tofile"),
        ("import numpy as np\nnp.load('/tmp/x.npy', allow_pickle=True)", "denied_token:np.load"),
    ],
)
def test_an_allowed_library_cannot_be_used_to_reach_the_filesystem(code, needle):
    """The guard is defence in depth, so a gap here is not a breach.

    It is still a gap the author closed elsewhere in the same file: `open(` is
    denied by name. Reaching the identical capability through a module on the
    allowlist denies nothing.
    """
    result = check_python_code(code)
    assert not result.ok
    assert any(needle in v for v in result.violations), result.violations


def test_defining_a_method_called_eval_is_not_calling_eval():
    """A definition binds a name; it does not invoke the builtin.

    `def eval(self, x)` has a space before the name, so the lookbehind that
    exempts `expr.eval(...)` did not exempt this — and the class was refused
    with a message about network and subprocess access, which is neither what
    the code did nor something its author could act on.
    """
    code = "class Cost:\n    def eval(self, x):\n        return x * 2\n"
    assert check_python_code(code).ok, check_python_code(code).violations
    # And the bare builtin is still denied, so the exemption did not widen.
    assert not check_python_code("eval('1+1')").ok


def test_matplotlib_may_still_write_its_own_output():
    """Deliberately NOT blocked, recorded so it is not read as an oversight.

    Writing a PNG is how a circuit diagram is produced, and the sandbox is
    ephemeral and network-locked. Denying it would remove a feature to prevent
    a file that nothing outlives.
    """
    code = "import matplotlib.pyplot as plt\nplt.plot([1,2])\nplt.savefig('/tmp/a.png')\n"
    assert check_python_code(code).ok, check_python_code(code).violations


@pytest.mark.parametrize(
    "code",
    [
        "import io as i\nf = i.open('/etc/passwd')",
        "from io import open\nf = open('/etc/passwd')",
        "from io import open as read\nf = read('/etc/passwd')",
        "import numpy as n\nn.load('/tmp/x.npy')",
        "from numpy import load\nload('/tmp/x.npy')",
        "from numpy import load as grab\ngrab('/tmp/x.npy')",
        "from numpy import fromfile, zeros\nfromfile('/etc/passwd')",
    ],
)
def test_a_rename_does_not_get_past_the_denial(code):
    """Substring checks see the spelling people write, not the one they rename to.

    `import numpy as np` is how every file in this repository imports numpy, so
    the aliased form is not an exotic evasion — it is the ordinary style. Each
    line here reached a denied function cleanly before `_aliased_violations`.
    """
    result = check_python_code(code)
    assert not result.ok, code


@pytest.mark.parametrize(
    "code",
    [
        "class Cost:\n    def eval(self, x):\n        return x\n",
        "class Cost:\n    def  eval(self, x):\n        return x\n",
        "def open(path):\n    return path\n",
    ],
)
def test_a_definition_with_any_spacing_is_not_a_call(code):
    """`(?<!def\\s)` is fixed-width, so it exempted one space and not two."""
    assert check_python_code(code).ok, check_python_code(code).violations


def test_the_alias_scan_leaves_ordinary_numpy_alone():
    """The negative control. Denying `np.` wholesale would break every circuit."""
    code = (
        "import numpy as np\n"
        "state = np.zeros(4)\n"
        "state[0] = 1.0\n"
        "print(np.linalg.norm(state), np.random.default_rng(1234).uniform())\n"
    )
    assert check_python_code(code).ok, check_python_code(code).violations
