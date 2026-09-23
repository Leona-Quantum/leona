"""Guided-tour step signals (ai-ops 326): the request shape, nothing more.

The closed `kind` enum lives here because it is genuinely fixed — ten values,
changing about as often as the product ships a new category of tour
interaction, the same shape `TokenScope` is in `tokens.py`. `track` and `step`
do NOT get a matching enum here: they are tour CONTENT (every track, show and
step id in `apps/web/lib/tour/tracks.ts`), which changes at the pace tours
change, not the pace this contract changes. Enforcing them as a contracts-level
enum would mean bumping this package's version and regenerating `openapi.json`
+ the TS contracts every time a tour gains a step — coupling two things that
change for unrelated reasons.

So this model only bounds their SHAPE (non-empty, capped length); the closed
list itself — `KNOWN_TRACKS` / `KNOWN_STEPS` — is
`services/api/src/majorana_api/tour_signal_vocabulary.py`, checked by the route
before anything is written, and mirrored (with a drift test) on the web side.
See that module's docstring for the full reasoning and how the two are kept
from silently disagreeing.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import Field

from .models import _ResourceBase


class TourSignalKind(StrEnum):
    """What happened to a tour step. Mirrors `apps/web/lib/tour/signal.ts`'s
    `TOUR_SIGNAL_KINDS` exactly — ten members, no more, no fewer. A new kind
    needs a change here (contracts version bump) AND a matching CHECK
    constraint widening (a new migration), which is the review point: this
    codebase's kind lists (see `TokenScope`) are closed by construction rather
    than by convention.
    """

    TOUR_STARTED = "tour_started"
    STEP_DONE = "step_done"
    STEP_SKIPPED = "step_skipped"
    DID_IT_FOR_ME = "did_it_for_me"
    OFFLINE_SKIP = "offline_skip"
    TOUR_DONE = "tour_done"
    TOUR_LEFT = "tour_left"
    STEP_MISSED = "step_missed"
    ASK_SHOW_ME = "ask_show_me"
    ASK_NALA = "ask_nala"


class RecordTourSignalRequest(_ResourceBase):
    """`POST /v1/tour-signals`'s body. Anonymous — no `Scope`, no identifier of
    any kind, on purpose: this counts events, never people (the same ceiling
    `apps/web/lib/pageview-signal.ts` states for the pageview counter it sits
    beside in spirit).

    `track` and `step` are bounded here only by shape; the route rejects a
    value outside `tour_signal_vocabulary.KNOWN_TRACKS` /
    `.KNOWN_STEPS` with a 422 before anything reaches the repository. The 64
    character ceiling is generous headroom over the longest real id today
    (`first-light`, `preferences`) and exists so a request this model refuses
    is refused for being the wrong SHAPE, independent of whether it also
    happens to name a real track.
    """

    track: str = Field(min_length=1, max_length=64)
    step: str = Field(min_length=1, max_length=64)
    kind: TourSignalKind


__all__ = [
    "RecordTourSignalRequest",
    "TourSignalKind",
]
