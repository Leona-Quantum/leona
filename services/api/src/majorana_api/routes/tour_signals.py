"""`POST /v1/tour-signals`: where the guided tours' step signals land (ai-ops 326).

Anonymous by design — the owner's stated destination on ai-ops 324, option 1:
"our own API, on a small endpoint that stores the counts", which he noted "adds
a route that anyone can post to without signing in" and therefore goes through
the security review first (`05-security.md` §1a) before it ships. What that
review buys, concretely, in this file:

- **Cardinality is bounded before anything is parsed.** `track`/`step`/`kind`
  are checked against `tour_signal_vocabulary`'s fixed sets; an unknown value
  is a 422 and is never written. There is no free-text field anywhere in the
  request.
- **The body is capped far below the API's general 1 MiB ceiling.** A real
  signal is `{"track":"build","step":"code","kind":"step_done"}` — under 60
  bytes. `MAX_TOUR_SIGNAL_BODY_BYTES` (1 KiB) is refused with a 413 before the
  bytes are handed to a JSON parser at all.
- **Rate limiting is the existing anonymous limiter, not a new one.**
  `/v1/tour-signals` is in `rate_limit.LIMITED_PATH_PREFIXES`, so
  `app.py`'s `_anon_rate_limit` middleware meters it per address at
  `DEFAULT_ANON_LIMIT`, the same ceiling `/v1/catalog/*` already lives under.
  Nothing in this module touches a limiter directly.
- **Nothing identifying is stored or logged.** No IP, user agent, session or
  timestamp finer than a UTC day reaches `record_signal`, and this handler
  never logs the request at all — see `test_tour_signals_live.py`'s
  `test_no_identifying_data_stored_or_logged` for the check that proves it,
  not just states it.

**Ships OFF** (`Settings.tour_signals_enabled`, default `False`) — the one §2
item this PR could not tick is the k6 abuse run; see that setting's own
docstring for why, and `docs/gates/k6-tour-signals-2026-09-23.md` for the two
attempts. Everything else the gate asks of a new anonymous route is met and
tested. Off, this route 404s rather than answering 422/204/413, the same
"does not advertise it exists elsewhere" reasoning `tokens.py`'s `_enabled`
carries.
"""

from __future__ import annotations

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from majorana_contracts.tour_signals import RecordTourSignalRequest
from pydantic import ValidationError

from ..auth.deps import DbSession, get_settings
from ..repos import tour_signals as tour_signals_repo
from ..settings import Settings
from ..tour_signal_vocabulary import KNOWN_STEPS, KNOWN_TRACKS, NO_STEP

router = APIRouter()

#: Far below the API's general `rate_limit.MAX_REQUEST_BYTES` (1 MiB): a real
#: signal is `{"track":"build","step":"code","kind":"step_done"}`, under 60
#: bytes. Refused before the body is even handed to a JSON parser.
MAX_TOUR_SIGNAL_BODY_BYTES = 1024


def _refused(status: int, error: str, reason: str) -> HTTPException:
    return HTTPException(status, detail={"error": error, "reason": reason})


def _enabled(settings: Annotated[Settings, Depends(get_settings)]) -> None:
    """404 this route while `tour_signals_enabled` is false — see the module
    and setting docstrings for why it ships that way. 404 rather than 403/422:
    a deployment where the feature is off should look like one where it does
    not exist, the same reasoning `tokens.py::_enabled` gives.
    """
    if not settings.tour_signals_enabled:
        raise HTTPException(404, "not found")


@router.post("/tour-signals", status_code=204, dependencies=[Depends(_enabled)])
async def record_tour_signal(request: Request, session: DbSession) -> None:
    """Count one guided-tour signal. Always anonymous; never returns a body.

    Reads and bounds the raw body itself rather than taking a
    `RecordTourSignalRequest` parameter — FastAPI's automatic body binding has
    no hook for a per-route size cap tighter than the app-wide one, and that
    tighter cap is the whole point of this route's own gate (05-security.md
    §1a, "input size caps"). The 1 MiB app-wide cap in `app.py`'s
    `_anon_rate_limit` middleware already buffered and bounded this body before
    this handler ever ran, so the read below is in-memory and costs nothing
    further to the network.
    """
    raw = await request.body()
    if len(raw) > MAX_TOUR_SIGNAL_BODY_BYTES:
        raise _refused(
            413,
            f"Request body exceeds the {MAX_TOUR_SIGNAL_BODY_BYTES} byte limit.",
            "request_too_large",
        )
    try:
        body = RecordTourSignalRequest.model_validate_json(raw)
    except ValidationError:
        raise _refused(422, "That is not a valid tour signal.", "validation_error") from None

    if body.track not in KNOWN_TRACKS:
        raise _refused(422, "Unrecognised tour track.", "unknown_tour_track")
    # NO_STEP marks a track-level signal (tour_started, tour_done, ask_nala,
    # ask_show_me) that names no specific step — see tour_signal_vocabulary's
    # docstring for why that is a sentinel outside KNOWN_STEPS rather than a
    # NULL or an addition to it.
    if body.step != NO_STEP and body.step not in KNOWN_STEPS:
        raise _refused(422, "Unrecognised tour step.", "unknown_tour_step")

    today = dt.datetime.now(dt.UTC).date()
    await tour_signals_repo.record_signal(
        session, day=today, track=body.track, step=body.step, kind=body.kind.value
    )
