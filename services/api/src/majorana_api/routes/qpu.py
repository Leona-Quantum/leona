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
import time
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from majorana_contracts import QpuRunRecord
from pydantic import BaseModel, ConfigDict, Field

from majorana_qpu import (
    IbmCredentialRejected,
    IbmRuntimeProvider,
    IbmVerificationUnavailable,
    QpuBackendInfo,
    QpuCostEstimate,
    QpuDisabledError,
    QpuQueueInfo,
    QpuRunJobPayload,
    QpuSubmissionBlockReason,
    UnknownDeviceError,
    backend_info,
    estimate as rate_card_estimate,
    list_backends,
    submission_block_reason,
    verify_ibm_api_key,
)
from majorana_qpu.mitigation import ZNE_SCALE_FACTORS, requested_zne_record

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


#: What a zero-noise-extrapolation submission sends: the circuit and its 3x and
#: 5x folds, one PUB each. Read from the scale factors so the price and the
#: worker cannot disagree about how many circuits there are.
ZNE_CIRCUITS = len(ZNE_SCALE_FACTORS)


def _circuits_for(zne: bool) -> int:
    return ZNE_CIRCUITS if zne else 1


class QpuEstimateRequest(RequestModel):
    model_config = ConfigDict(extra="forbid")

    device_id: str = Field(min_length=1, max_length=120)
    shots: int = Field(ge=1, le=MAX_ESTIMATE_SHOTS)
    #: Price the submission WITH zero-noise extrapolation, so the page can show
    #: what opting in costs before anyone opts in. Same flag, same arithmetic as
    #: the submission below, so the number shown is the number recorded.
    zne: bool = False


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
        return rate_card_estimate(body.device_id, body.shots, circuits=_circuits_for(body.zne))
    except UnknownDeviceError:
        raise HTTPException(status_code=404, detail="unknown QPU device") from None


async def _caller_can_submit(scope, session) -> bool:
    """Whether this caller holds a credential this deployment could actually use.

    Not "is there a row" — **is there a row this deployment can still decrypt**.
    A stored credential whose key has left `MAJORANA_CREDENTIAL_KEYS` cannot be
    read by the worker, so accepting a submission against it writes a durable
    attestation row and enqueues a job that fails hours later with a cause no
    user can act on.

    An earlier version of this function checked `storage_available()` and the
    row's existence, which are both true in exactly the case that matters: a key
    rotated by REPLACEMENT rather than by prepending. Measured — storage
    available, row present, row undecryptable, gate open. Comparing the row's
    own `key_id` against the configured keys' ids is what makes the docstring
    above true rather than aspirational.

    The comparison is deliberately stricter than `CredentialCipher.decrypt`,
    which tries every key and does not look at `key_id` at all. That asymmetry
    is correct: decrypt has the ciphertext and can simply try, while this has to
    decide whether to begin work whose failure is expensive and late.
    """
    # Configured keys first, and the row only if there are any. Not merely an
    # optimisation: with no key at all the answer cannot depend on the row, and
    # `test_the_gate_is_closed_when_credential_storage_is_unavailable` fails the
    # session outright if this path reads one — a deployment with no encryption
    # key should not be issuing queries about secrets it could not use.
    configured = credential_crypto.configured_key_ids()
    if not configured:
        return False
    return await credentials_repo.credential_key_id(scope, session, IBM_PROVIDER) in configured


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


#: How long a queue reading is trusted before another IBM call is made. Not
#: per-caller: every Open Plan account's submission draws from the SAME
#: backend pool, so the answer does not vary by whose credential asked, and a
#: shared window is what keeps a busy page — or several people looking at once
#: — from turning into repeated IBM calls for a number that has not changed.
QUEUE_STATUS_CACHE_TTL_S = 60.0

#: A reading that could not be fetched just now — a transient IBM hiccup, or a
#: credential that failed to decrypt — as opposed to a caller who was never
#: going to be able to ask (no credential, wrong provider, dependency missing,
#: which reuse `QpuSubmissionBlockReason`'s own values).
QUEUE_UNAVAILABLE = "queue_unavailable"


class _QueueCache:
    """One slot, shared by every caller. See `QUEUE_STATUS_CACHE_TTL_S`."""

    def __init__(self, ttl_s: float) -> None:
        self._ttl_s = ttl_s
        self._value: QpuQueueInfo | None = None
        self._fetched_monotonic: float | None = None

    def get(self) -> QpuQueueInfo | None:
        if self._value is None or self._fetched_monotonic is None:
            return None
        if time.monotonic() - self._fetched_monotonic >= self._ttl_s:
            return None
        return self._value

    def set(self, value: QpuQueueInfo) -> None:
        self._value = value
        self._fetched_monotonic = time.monotonic()


_queue_cache = _QueueCache(QUEUE_STATUS_CACHE_TTL_S)


class QpuQueueStatusResponse(BaseModel):
    """How busy the device is, for the panel shown before submitting.

    `pending_jobs` is IBM's own count, worded as "N jobs ahead of yours" —
    never a minutes figure IBM does not publish. None with a reason means the
    caller cannot be told right now; a client shows the reason's sentence
    (`hardwareBlockedReason`, the same copy the submission gate already
    renders) rather than hiding the panel.
    """

    device_id: str
    backend_name: str | None
    pending_jobs: int | None
    unavailable_reason: str | None
    checked_at: dt.datetime


def _queue_status_response(
    device_id: str, info: QpuQueueInfo | None, *, unavailable_reason: str | None
) -> QpuQueueStatusResponse:
    return QpuQueueStatusResponse(
        device_id=device_id,
        backend_name=info.backend_name if info else None,
        pending_jobs=info.pending_jobs if info else None,
        unavailable_reason=unavailable_reason,
        checked_at=dt.datetime.now(dt.UTC),
    )


@router.get("/qpu/backends/{device_id}/queue", response_model=QpuQueueStatusResponse)
async def qpu_queue_status(
    device_id: str, scope: CurrentScope, session: DbSession
) -> QpuQueueStatusResponse:
    """How busy `device_id` is right now, cached for `QUEUE_STATUS_CACHE_TTL_S`.

    Submittable only: a device Leona can only price (every Braket entry today
    — `SUBMITTABLE_PROVIDERS` has no Braket adapter, so there is no "before you
    submit" moment for one) answers `provider_not_supported`, the same reason
    the submission gate gives for the same devices. IBM's Open Plan is priced
    as ONE catalog entry (`ibm.open_plan`) because IBM picks the physical
    backend at submit time; this reports the queue for whichever backend
    `least_busy` would pick right now, which is the backend a real submission
    would actually go to.
    """
    try:
        backend = backend_info(device_id)
    except UnknownDeviceError:
        raise HTTPException(status_code=404, detail="unknown QPU device") from None
    if not backend.submittable:
        return _queue_status_response(
            device_id,
            None,
            unavailable_reason=QpuSubmissionBlockReason.PROVIDER_NOT_SUPPORTED.value,
        )
    reason = submission_block_reason(has_credential=await _caller_can_submit(scope, session))
    if reason is not None:
        return _queue_status_response(device_id, None, unavailable_reason=reason.value)
    cached = _queue_cache.get()
    if cached is not None:
        return _queue_status_response(device_id, cached, unavailable_reason=None)
    record = await credentials_repo.get(scope, session, IBM_PROVIDER)
    if record is None:
        # `_caller_can_submit` just confirmed a decryptable row exists; a
        # concurrent disconnect between that check and this read is the only
        # way this is reached, and it is exactly the "ask again" case the
        # transient reason names.
        return _queue_status_response(device_id, None, unavailable_reason=QUEUE_UNAVAILABLE)
    try:
        token = credential_crypto.load_cipher().decrypt(record.ciphertext, key_id=record.key_id)
    except credential_crypto.CredentialCryptoError:
        log.warning("qpu queue status: stored credential (key %s) failed to decrypt", record.key_id)
        return _queue_status_response(device_id, None, unavailable_reason=QUEUE_UNAVAILABLE)
    provider = IbmRuntimeProvider(token, instance=record.instance)
    try:
        info = await asyncio.to_thread(provider.queue_status)
    except QpuDisabledError as disabled:
        return _queue_status_response(device_id, None, unavailable_reason=disabled.reason.value)
    except Exception:  # noqa: BLE001 — a busy page must not 500 on an IBM hiccup
        log.warning("qpu queue status unavailable", exc_info=True)
        return _queue_status_response(device_id, None, unavailable_reason=QUEUE_UNAVAILABLE)
    _queue_cache.set(info)
    return _queue_status_response(device_id, info, unavailable_reason=None)


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
    #: An IBM Service CRN. Not a secret — it names an instance — which is
    #: exactly why it is stored UNENCRYPTED and echoed back on every GET.
    #:
    #: Hence the `crn:` prefix, which is a security constraint rather than
    #: validation for its own sake. This field sits directly beside the API key
    #: field in the UI, both are optional-looking text inputs, and a user who
    #: pastes their key into the wrong one would have it written to the row in
    #: plaintext and returned to the browser on every status poll — past every
    #: protection in this module. Refusing a value that is not shaped like a CRN
    #: makes that specific mistake impossible rather than unlikely.
    #:
    #: The cost is real and accepted: `QiskitRuntimeService` also accepts an
    #: instance NAME, and this refuses those. The UI labels the field "instance
    #: CRN", IBM's REST path needs a CRN in the `Service-CRN` header, and the
    #: field is optional — so the narrow shape is the right trade against
    #: storing somebody's credential in a column nothing encrypts.
    instance: str | None = Field(default=None, max_length=512, pattern=r"^crn:")
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
    #: Opt in to zero-noise extrapolation: the job also runs the circuit folded
    #: to 3x and 5x its gates. Off by default, because it triples the shots the
    #: provider executes (and, on IBM's free plan, the allowance time they use).
    zne: bool = False


def _to_qpu_run_resource(record: QpuRunRow) -> QpuRunRecord:
    return QpuRunRecord(
        id=record.id,
        workspace_id=record.workspace_id,
        user_id=record.user_id,
        artifact_version_id=record.artifact_version_id,
        provider=record.provider,
        device_id=record.device_id,
        provider_job_id=record.provider_job_id,
        backend_name=record.backend_name,
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
        mitigation=record.mitigation,
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
    # Before the credential gate: a priced device whose provider has no submit
    # adapter cannot be run by any credential, and the worker would otherwise
    # send the job to IBM under this device's label and price.
    if not backend.submittable:
        raise HTTPException(
            status_code=409,
            detail={"blocked_reason": QpuSubmissionBlockReason.PROVIDER_NOT_SUPPORTED.value},
        )
    reason = submission_block_reason(has_credential=await _caller_can_submit(scope, session))
    if reason is not None:
        raise HTTPException(status_code=409, detail={"blocked_reason": reason.value})
    # With ZNE the estimate covers all three circuits, and that multiplied figure
    # is what the spend reservation below checks and what the row records. The
    # page showed the same number before the user pressed submit, because the
    # estimate route prices it with this same call.
    estimate = rate_card_estimate(body.device_id, body.shots, circuits=_circuits_for(body.zne))
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
        # The opt-in goes on the row, not into the job payload: the worker reads
        # every attested value from the row, and the payload is `extra="forbid"`,
        # so a new field there would be refused by a worker one deploy older.
        mitigation=requested_zne_record() if body.zne else None,
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


class QpuRunHistoryItem(QpuRunRecord):
    """One run in the workspace's hardware history: the record, plus its program.

    `qasm` is here and not on `QpuRunRecord` because only a history needs it. The
    submitting Studio already holds the circuit it sent; a page listing past runs
    has nothing else to compute the ideal distribution from, and the
    measured-against-ideal reading is a pure function of exactly this text
    (`apps/web/lib/qpu-ideal.ts`). It is the workspace's own program, read under
    the same workspace predicate as the counts beside it.

    Route-local, on the precedent in this module's docstring: a read-only
    projection whose shape is this route's own business.
    """

    qasm: str


class QpuRunPage(BaseModel):
    items: list[QpuRunHistoryItem]
    #: Pass back as `cursor` for the next page. Null when this page was not full,
    #: which is the last page — the same rule `GET /runs` and `GET /notebooks` use.
    next_cursor: uuid.UUID | None


#: Default and ceiling for one page. The ceiling is the one every list route in
#: this API applies; each item carries its program, so the web asks for less.
QPU_RUN_PAGE_DEFAULT = 50
QPU_RUN_PAGE_MAX = 100


@router.get("/qpu/runs", response_model=QpuRunPage)
async def qpu_run_history(
    scope: CurrentScope,
    session: DbSession,
    cursor: uuid.UUID | None = None,
    limit: int = QPU_RUN_PAGE_DEFAULT,
    source_fingerprint: Annotated[str | None, Query(min_length=1, max_length=200)] = None,
) -> QpuRunPage:
    """This workspace's hardware runs, newest first, paged by cursor.

    Every row comes through `qpu_runs_repo.list_records`, which applies the
    workspace predicate itself; there is no parameter here that names a
    workspace, so there is nothing a caller can widen. `source_fingerprint`
    narrows to one circuit (Studio restoring its last run after a reload).

    No route-order hazard with `GET /qpu/runs/{record_id}` below: a literal path
    only loses to a templated sibling when both register the same method AND the
    template can match it, and `{record_id}` needs a segment `/qpu/runs` does not
    have. `test_qpu_run_history_is_reachable_beside_the_single_record_read`
    checks it with a request rather than leaving it to this comment.
    """
    limit = min(max(limit, 1), QPU_RUN_PAGE_MAX)
    rows = await qpu_runs_repo.list_records(
        scope, session, cursor=cursor, limit=limit, source_fingerprint=source_fingerprint
    )
    items = [
        QpuRunHistoryItem(**_to_qpu_run_resource(row).model_dump(), qasm=row.qasm) for row in rows
    ]
    return QpuRunPage(items=items, next_cursor=rows[-1].id if len(rows) == limit else None)


@router.get("/qpu/runs/{record_id}", response_model=QpuRunRecord)
async def qpu_run_record(
    record_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> QpuRunRecord:
    try:
        record = await qpu_runs_repo.get_record(scope, session, record_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="unknown qpu_run") from None
    return _to_qpu_run_resource(record)
