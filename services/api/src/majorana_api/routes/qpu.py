"""QPU catalog, deterministic estimates, the submission gate, submission, and
the caller's own IBM Quantum credential.

The rate card is code (majorana_qpu) and the estimate is arithmetic over it.
Submission is fail-closed behind the deployment gates; when every gate is
open, POST /qpu/submissions writes the durable qpu_runs attestation row
(migration 0034) and its qpu.run job in one transaction and returns the
record. The worker owns every provider interaction after that.

## The credential surface

`GET/PUT/DELETE /v1/qpu/credentials` manage the caller's own IBM Quantum API
key. They live here rather than in a new router because the submission gate is
now a question about the caller — "may this deployment submit" AND "does this
person have an account to submit through" — and splitting the two halves across
files is how they drift.

There is no OAuth flow. IBM Quantum Platform publishes none that would let a
third-party application obtain an API key on a user's behalf, so the shape is:
the user creates their own free key on IBM's dashboard and pastes it here. What
this surface owes them in exchange is that the paste is verified before it is
stored, that a bad key produces a sentence they can act on, and that the key is
never readable again by anything — including them, including us.

Response models are route-local, on the precedent stated at the top of
`routes/usage.py`: a read-only projection whose shape is this route's own
business does not need a CONTRACTS_VERSION bump.
"""

import asyncio
import datetime as dt
import logging
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from majorana_contracts import QpuRunRecord
from pydantic import BaseModel, ConfigDict, Field

from majorana_qpu import (
    IbmCredentialRejected,
    IbmVerificationUnavailable,
    QpuBackendInfo,
    QpuCostEstimate,
    QpuRunJobPayload,
    UnknownDeviceError,
    backend_info,
    estimate as rate_card_estimate,
    list_backends,
    submission_block_reason,
    verify_ibm_api_key,
)

from .. import credential_crypto
from ..auth.deps import CurrentIdentity, CurrentScope, DbSession, get_settings
from ..request_models import RequestModel
from ..jobs import QPU_RUN_JOB_KIND
from ..orm import ProviderCredential, QpuRun as QpuRunRow
from ..repos import provider_credentials as credentials_repo
from ..repos import qpu_runs as qpu_runs_repo
from ..repos import system
from ..settings import Settings
from ..tiers import TIER_WINDOW, limits_for, tier_of

router = APIRouter()

log = logging.getLogger("majorana_api.qpu")

MAX_ESTIMATE_SHOTS = 1_000_000
# Generous bound for a submitted OpenQASM program; the Studio surface caps far
# lower — this only stops abuse of the raw endpoint.
MAX_SUBMISSION_QASM_CHARS = 200_000

#: The one provider a credential may name today. A constant rather than a
#: literal at four call sites: the day a second provider lands, the compiler
#: cannot help and a missed string is a route that reads the wrong row.
IBM_PROVIDER = "ibm"


class QpuBackendsResponse(BaseModel):
    backends: list[QpuBackendInfo]


class QpuEstimateRequest(RequestModel):
    model_config = ConfigDict(extra="forbid")

    device_id: str = Field(min_length=1, max_length=120)
    shots: int = Field(ge=1, le=MAX_ESTIMATE_SHOTS)


class QpuSubmissionGateResponse(BaseModel):
    """Whether this deployment could submit to hardware right now, and if not,
    the exact reason. `blocked_reason` is None only when every gate is open."""

    submission_available: bool
    blocked_reason: str | None


@router.get("/qpu/backends", response_model=QpuBackendsResponse)
async def qpu_backends(scope: CurrentScope) -> QpuBackendsResponse:
    return QpuBackendsResponse(backends=list(list_backends()))


@router.post("/qpu/estimates", response_model=QpuCostEstimate)
async def qpu_estimate(body: QpuEstimateRequest, scope: CurrentScope) -> QpuCostEstimate:
    try:
        return rate_card_estimate(body.device_id, body.shots)
    except UnknownDeviceError:
        raise HTTPException(status_code=404, detail="unknown QPU device") from None


async def _caller_can_submit(scope, session) -> bool:
    """Whether this caller holds a credential this deployment could actually use.

    Two conditions, ANDed, and the second one is the non-obvious half: a stored
    row whose key is no longer in `MAJORANA_CREDENTIAL_KEYS` cannot be decrypted
    by the worker, so accepting a submission against it would produce a job that
    fails hours later with a cause no user can act on. Reporting the caller as
    unconfigured is fail-closed and it is what the operator-facing
    `storage_available: false` on the status route exists to explain.
    """
    if not credential_crypto.storage_available():
        return False
    return await credentials_repo.has_credential(scope, session, IBM_PROVIDER)


@router.get("/qpu/submission-gate", response_model=QpuSubmissionGateResponse)
async def qpu_submission_gate(scope: CurrentScope, session: DbSession) -> QpuSubmissionGateResponse:
    """Caller-aware. The deployment gates are the same for everybody; the
    credential is not, and a gate that answered "available" to an account with
    no IBM key would send them to a submission that refuses."""
    reason = submission_block_reason(has_credential=await _caller_can_submit(scope, session))
    return QpuSubmissionGateResponse(
        submission_available=reason is None,
        blocked_reason=None if reason is None else reason.value,
    )


class QpuCredentialStatus(BaseModel):
    """What the caller has connected. Never the key.

    Every field here is either a timestamp, a user-supplied label, or the
    instance CRN — which names an IBM instance and authorizes nothing on its
    own. There is no field for the API key and there is deliberately no
    fingerprint, prefix or masked form of it either: a "last four" is a real
    reduction of the search space for a 44-character secret, and it buys the
    user nothing they cannot get from `last_verified_at`.
    """

    provider: str
    connected: bool
    label: str | None
    instance: str | None
    #: When this credential was first connected. "Connected since" — it does not
    #: move when the key is replaced, because the connection did not lapse.
    created_at: dt.datetime | None
    #: **The last time a provider actually accepted this key**, not the last time
    #: it was saved. Written by the PUT that stored it (IBM's IAM endpoint
    #: exchanged it for a token right then) and REFRESHED by the worker every
    #: time a provider call made with it succeeds — a submission handed to IBM,
    #: a poll answered by IBM. Both are proof the key still works.
    #:
    #: Written down because the alternative was a trap: a field only the store
    #: path ever wrote would be a creation timestamp wearing a verification
    #: label, saying nothing `created_at` does not, while a UI rendered "Last
    #: verified" beside it. A key revoked on IBM's dashboard yesterday would
    #: still have reported "verified" as of the day it was pasted. With the
    #: worker refreshing it, a stale value means something: nothing has
    #: successfully used this credential since then.
    last_verified_at: dt.datetime | None
    #: The last time the credential was HANDED to a provider on this account's
    #: behalf. Null for a credential that has been connected but never used.
    #: Distinct from `last_verified_at` at exactly one moment — connect time,
    #: when the key has been verified and not yet used — and after a
    #: reconnection, when verification moves and use does not.
    last_used_at: dt.datetime | None
    #: Operator-facing. False means `MAJORANA_CREDENTIAL_KEYS` is unset or
    #: malformed on this service, so nothing can be connected until it is fixed.
    #: Surfaced rather than hidden behind a 503 because a user staring at a
    #: refusing form needs to know it is not their key that is wrong.
    storage_available: bool


class QpuCredentialRequest(RequestModel):
    """The connect body.

    `api_key` carries NO pydantic constraints, and that is a security decision
    rather than laziness. A pydantic failure produces a `RequestValidationError`
    whose `errors()` include the offending `input` — so a `min_length` on this
    field would echo the user's API key back in the 422. This app's validation
    handler already collapses that to a fixed body (`app.py`), which is what
    makes the echo survivable at all; not putting the constraint here removes
    the second half of the problem, since the value would still have been
    formatted into an exception object first. Length is checked in the handler,
    where the refusal is ours to write.
    """

    model_config = ConfigDict(extra="forbid")

    provider: Literal["ibm"] = IBM_PROVIDER
    api_key: str
    #: An IBM Service CRN. Not a secret — it names an instance.
    instance: str | None = Field(default=None, max_length=512)
    label: str | None = Field(default=None, max_length=120)


def _credential_status(
    record: ProviderCredential | None, provider: str = IBM_PROVIDER
) -> QpuCredentialStatus:
    available = credential_crypto.storage_available()
    if record is None:
        return QpuCredentialStatus(
            provider=provider,
            connected=False,
            label=None,
            instance=None,
            created_at=None,
            last_verified_at=None,
            last_used_at=None,
            storage_available=available,
        )
    return QpuCredentialStatus(
        provider=record.provider,
        connected=True,
        label=record.label,
        instance=record.instance,
        created_at=record.created_at,
        last_verified_at=record.last_verified_at,
        last_used_at=record.last_used_at,
        storage_available=available,
    )


def _storage_unavailable(diagnostic: str) -> HTTPException:
    """503 with a `reason` and nothing else.

    The diagnostic goes to the log, deliberately. Every field in an
    `HTTPException` detail is rendered by `app._http_exc` into a body the web
    client shows a person, and "MAJORANA_CREDENTIAL_KEYS is not set" is a
    sentence for whoever runs the service — putting it on an end user's screen
    tells them nothing they can act on and describes our deployment to somebody
    who did not ask. Only `credential_rejected` carries a user-facing `error`,
    because only that one is about something the user did.
    """
    log.error("credential storage unavailable: %s", diagnostic)
    return HTTPException(status_code=503, detail={"reason": "credential_storage_unavailable"})


@router.get("/qpu/credentials", response_model=QpuCredentialStatus)
async def qpu_credential_status(
    scope: CurrentScope,
    session: DbSession,
    provider: Annotated[Literal["ibm"], Query()] = IBM_PROVIDER,
) -> QpuCredentialStatus:
    """What this caller has connected for `provider`.

    Takes the same `provider` parameter DELETE does, and defaults the same way.
    A GET with no parameter that answered `"provider": "ibm"` would presume one
    provider per account forever, and the day a second one lands (Braket, IonQ
    direct) every existing caller would have to change; a `Literal` keeps the
    single valid value enforced meanwhile, so an unknown provider is a 422 rather
    than a confidently empty answer about something that does not exist.

    One object for the provider asked about, never a list: a client that wants
    two asks twice, and a list would make "which of these is the IBM one"
    everybody's problem.

    Readable with storage unavailable, on purpose: the row's metadata is not
    encrypted, and an account that cannot see whether it is connected has no way
    to understand why submission refuses.
    """
    record = await credentials_repo.get(scope, session, provider)
    return _credential_status(record, provider)


@router.put("/qpu/credentials", response_model=QpuCredentialStatus)
async def qpu_connect_credential(
    body: QpuCredentialRequest, scope: CurrentScope, session: DbSession
) -> QpuCredentialStatus:
    """Verify the key with IBM, then store it encrypted. Never echo it.

    ## Verify first, store second

    A key IBM refuses is a 400 and is not written anywhere. Storing an unusable
    credential moves the failure from this form — where the user is looking at
    the IBM dashboard they just copied it from — into a job hours later, where
    it appears as a hardware run that failed for reasons nobody can attribute.

    ## Three different refusals, because the user does three different things

    - **400 `credential_rejected`**: IBM answered and said no. Go back to the
      dashboard. The ONLY one of the three that carries a `detail.error`
      sentence, because it is the only one about something the user did — the
      web client renders it verbatim.
    - **502 `credential_verification_unavailable`**: IBM could not be reached.
      Try again shortly; nothing is wrong with the key.
    - **503 `credential_storage_unavailable`**: this deployment has no
      encryption key configured. Nothing the user can do; an operator must set
      `MAJORANA_CREDENTIAL_KEYS`.

    Collapsing the first two would send somebody to regenerate a perfectly good
    credential because a TLS handshake timed out.

    502 and 503 carry `reason` and nothing else. Their diagnostics are logged
    rather than returned: the client renders whatever `error` it finds, so an
    operator-facing string in one of those bodies is an operator-facing string
    on an end user's screen.

    ## Where the plaintext goes

    Into `verify_ibm_api_key`, into `cipher.encrypt`, and nowhere else. It is not
    logged, not returned (the response model has no field for it), and not
    carried into any exception: every raise on this path is `from None`, because
    the frame being chained is the frame holding the key.
    """
    try:
        cipher = credential_crypto.load_cipher()
    except credential_crypto.CredentialStorageUnavailable as unavailable:
        # Loaded BEFORE the key is sent anywhere. A deployment that cannot store
        # the credential has no business exchanging it with IBM: the round trip
        # would prove a key it is about to throw away, and refusing first is the
        # only way to be certain plaintext is never persisted.
        raise _storage_unavailable(str(unavailable)) from None
    api_key = body.api_key.strip()
    try:
        # `to_thread`: urllib is blocking and this is an async handler. Running
        # it inline would stall the event loop for the whole IAM round trip on
        # every connect.
        await asyncio.to_thread(verify_ibm_api_key, api_key)
    except IbmCredentialRejected as rejected:
        raise HTTPException(
            status_code=400,
            detail={"reason": "credential_rejected", "error": str(rejected)},
        ) from None
    except IbmVerificationUnavailable as unavailable:
        log.warning("IBM credential verification unavailable: %s", unavailable)
        raise HTTPException(
            status_code=502,
            detail={"reason": "credential_verification_unavailable"},
        ) from None
    ciphertext, key_id = cipher.encrypt(api_key)
    record = await credentials_repo.upsert(
        scope,
        session,
        provider=body.provider,
        ciphertext=ciphertext,
        key_id=key_id,
        instance=(body.instance or None),
        label=(body.label or None),
        # Stamped from the verification that just succeeded, not from "now" at
        # some later point in the handler: the fact recorded is that IBM
        # accepted this key, and it is only true of this request. The worker
        # refreshes it on every later provider call that succeeds, so the field
        # keeps meaning "last accepted" rather than decaying into "first saved".
        last_verified_at=dt.datetime.now(dt.UTC),
    )
    return _credential_status(record, body.provider)


@router.delete("/qpu/credentials", status_code=204)
async def qpu_disconnect_credential(
    scope: CurrentScope,
    session: DbSession,
    provider: Annotated[Literal["ibm"], Query()] = IBM_PROVIDER,
) -> Response:
    """Remove the caller's credential. 204 whether or not one was there.

    Idempotent on purpose: a user who clicks disconnect twice, or whose first
    request timed out after committing, must not be told that something went
    wrong. There is nothing to report — after either call, the key is gone.
    """
    await credentials_repo.delete(scope, session, provider)
    return Response(status_code=204)


class QpuSubmissionRequest(RequestModel):
    model_config = ConfigDict(extra="forbid")

    device_id: str = Field(min_length=1, max_length=120)
    shots: int = Field(ge=1, le=MAX_ESTIMATE_SHOTS)
    qasm: str = Field(min_length=1, max_length=MAX_SUBMISSION_QASM_CHARS)
    source_fingerprint: str = Field(min_length=1, max_length=200)


def _to_qpu_run_resource(record: QpuRunRow) -> QpuRunRecord:
    return QpuRunRecord(
        id=record.id,
        workspace_id=record.workspace_id,
        user_id=record.user_id,
        artifact_version_id=record.artifact_version_id,
        provider=record.provider,
        device_id=record.device_id,
        provider_job_id=record.provider_job_id,
        shots=record.shots,
        status=record.status,
        source_fingerprint=record.source_fingerprint,
        estimate_basis=record.estimate_basis,
        estimated_total_usd=(
            float(record.estimated_total_usd) if record.estimated_total_usd is not None else None
        ),
        rate_source=record.rate_source,
        rate_confirmed_on=record.rate_confirmed_on,
        raw_counts=record.raw_counts,
        error=record.error,
        submitted_at=record.submitted_at,
        completed_at=record.completed_at,
        created_at=record.created_at,
    )


def qpu_spend_refusal(spent: float, limit: float, estimate: float) -> HTTPException:
    """The refusal an account sees when a hardware submission does not fit.

    Unreachable on the tiers that ship today: none of them sets a ceiling, so
    `reserve_qpu_spend_slot` never raises. Kept whole — sentence, reason code and
    all three fields — because the removal is conditional on submissions running
    on the user's own provider credential, and a user-set budget refuses through
    this same path. See `tiers.TierLimits.qpu_spend_usd_per_week`.

    Names all three numbers, because "you cannot do that" is unactionable for a
    limit denominated in money: what the user needs to know is whether to wait
    for the window to roll, pick a cheaper device, or drop the shot count.

    429 rather than 402: this is an allowance that refills, the same shape as
    `tier_allowance_refusal` next door, not a demand for payment.

    The numeric fields are rounded to cents, and not only for tidiness. `spent`
    is a sum of floats read back from a `Numeric` column, so it can land at
    `25.000000000000004` — and a client that renders these fields rather than
    parsing the sentence would put that on screen as an amount of money. The
    sentence itself has always been formatted to two places; these now agree
    with it rather than disagreeing in the twelfth decimal.
    """
    return HTTPException(
        status_code=429,
        detail={
            "error": (
                f"This submission is estimated at ${estimate:,.2f}. Your plan includes "
                f"${limit:,.2f} of hardware time per week and ${spent:,.2f} is already "
                "authorized. Free-queue devices and browser simulation stay available."
            ),
            "reason": "qpu_spend_exhausted",
            "spent_usd": round(spent, 2),
            "limit_usd": round(limit, 2),
            "estimate_usd": round(estimate, 2),
        },
    )


@router.post("/qpu/submissions", response_model=QpuRunRecord, status_code=201)
async def qpu_submit(
    body: QpuSubmissionRequest,
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
    settings: Annotated[Settings, Depends(get_settings)],
) -> QpuRunRecord:
    """Real submission: device validated, every deployment gate consulted, the
    account's weekly hardware spend reserved under its own lock, and on an open
    path the durable qpu_run attestation row and the qpu.run job are written in
    the same transaction — neither can become visible alone. The estimate is
    snapshotted onto the row exactly as the rate card computes it now, so the
    record proves what was agreed to at confirmation time.

    `identity` is here for one reason: without it this handler has no tier, and
    a handler with no tier cannot check an allowance. It had none, and the
    result was $96,006.30 accepted from a free account over twenty-one requests
    — see `qpu_runs.reserve_qpu_spend_slot`, which carries the measurement.

    That reservation refuses nothing today: no tier sets a hardware ceiling
    (2026-08-02, the owner's ruling), so what it does now is record the estimate
    on the row and let `GET /v1/usage` report the total. The number the tier
    table gives is still what reaches it — never a constant here — so a ceiling
    reintroduced there binds this route without an edit.

    The spend check runs AFTER the deployment gate deliberately. A closed
    deployment is not the account's problem, and telling somebody their budget
    is spent when nothing in this deployment could have submitted anything would
    be the wrong sentence.

    The gate is now caller-aware: an account with no IBM credential is refused
    with `credentials_unconfigured` HERE, before any row is written and any job
    is enqueued. Letting it through would create a durable attestation row and a
    `qpu.run` job for a submission that cannot be made, and the worker would
    close it as an errored hardware run — a failure record for something that
    never reached a provider, on a table whose whole purpose is attesting to
    things that did."""
    try:
        backend = backend_info(body.device_id)
    except UnknownDeviceError:
        raise HTTPException(status_code=404, detail="unknown QPU device") from None
    reason = submission_block_reason(has_credential=await _caller_can_submit(scope, session))
    if reason is not None:
        raise HTTPException(status_code=409, detail={"blocked_reason": reason.value})
    estimate = rate_card_estimate(body.device_id, body.shots)
    user, _workspace = identity
    limits = limits_for(tier_of(user, settings))
    try:
        await qpu_runs_repo.reserve_qpu_spend_slot(
            scope,
            session,
            dt.datetime.now(dt.timezone.utc) - TIER_WINDOW,
            limits.qpu_spend_usd_per_week,
            # A free-queue device has no total to charge, and this `or 0.0` is
            # what keeps it free of any ceiling that exists: the reservation
            # returns on a zero estimate, so an account whose ceiling is $0
            # still reaches the IBM Open Plan queue. `None` here would compare
            # against the sum as a type error rather than as free.
            estimate.total_usd or 0.0,
        )
    except qpu_runs_repo.QpuSpendReached as reached:
        raise qpu_spend_refusal(reached.spent, reached.limit, reached.estimate) from reached
    record = await qpu_runs_repo.create_record(
        scope,
        session,
        device_id=body.device_id,
        provider=backend.provider.value,
        shots=body.shots,
        qasm=body.qasm,
        source_fingerprint=body.source_fingerprint,
        estimate_basis=estimate.basis.value,
        estimated_total_usd=estimate.total_usd,
        rate_source=estimate.rate_source,
        rate_confirmed_on=estimate.rate_confirmed_on,
    )
    payload = QpuRunJobPayload(
        workspace_id=str(scope.workspace_id),
        user_id=str(scope.user_id),
        qpu_run_id=str(record.id),
        device_id=body.device_id,
        shots=body.shots,
        qasm=body.qasm,
        source_fingerprint=body.source_fingerprint,
    )
    await system.enqueue_job(
        session,
        kind=QPU_RUN_JOB_KIND,
        payload=payload.model_dump(mode="json"),
    )
    return _to_qpu_run_resource(record)


@router.get("/qpu/runs/{record_id}", response_model=QpuRunRecord)
async def qpu_run_record(
    record_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> QpuRunRecord:
    try:
        record = await qpu_runs_repo.get_record(scope, session, record_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="unknown qpu_run") from None
    return _to_qpu_run_resource(record)
