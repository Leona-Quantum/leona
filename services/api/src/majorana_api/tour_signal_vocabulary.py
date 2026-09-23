"""The bounded vocabulary a guided-tour signal may report (ai-ops 326).

`POST /v1/tour-signals` is anonymous — reachable by anyone, signed in or not,
with no credential — so the one thing standing between it and an attacker
storing arbitrary strings forever is this file: `track` and `step` are checked
against `KNOWN_TRACKS`/`KNOWN_STEPS` before anything is written, and an unknown
value is refused (422), never stored. `kind` is checked the same way against
`TOUR_SIGNAL_KINDS`, and is also enforced by a CHECK constraint at the database
(migration 0074) as a second, independent line.

## Mirrors the web side, and how it is kept from drifting silently

These three tuples mirror `apps/web/lib/tour/signal.ts` (`TOUR_SIGNAL_KINDS`)
and `apps/web/lib/tour/types.ts` + `tracks.ts` (every track id, show id, and
step id the tour runtime can actually emit). There is deliberately no shared
generated file the way `openapi.json` mirrors the Pydantic contracts: track and
step identifiers are tour CONTENT, not a request/response shape, and change at
the pace tours change rather than the pace the API's contract changes.

The drift this creates is caught by `apps/web/lib/tour/signal-vocabulary.test.ts`,
which DERIVES the current track/step/kind sets straight from `tracks.ts` and
`signal.ts` (never a second hand-copied list) and asserts them equal to the
literal mirror written into that same test file — a mirror of THIS file, kept
beside the derivation so both are visible in one diff. Adding a step to
`tracks.ts` without updating that test's mirror turns the derived set and the
mirror unequal, and the test goes red; the reverse (widening this file, or the
test's mirror of it, without a matching tour) is caught the same way, because
the assertion is set equality, not subset.

Mechanically derived from the source files on 2026-09-23 (`grep -oE 'id: "[a-z0-9-]+"'
against tracks.ts, deduplicated, with the five track headers subtracted out —
see the PR body for the exact command) rather than hand-transcribed, because a
hand-transcription of 43 strings is exactly the kind of step that silently
drops one.
"""

from __future__ import annotations

#: What `apps/web/lib/tour/signal.ts` sends for `step` on a track-level signal
#: — `tour_started`, `tour_done`, `ask_nala`, `ask_show_me` — none of which
#: name a specific step in `tour-runtime.tsx`/`tour-card.tsx`'s own call sites.
#: Deliberately outside `KNOWN_STEPS`: that set is a MECHANICAL derivation from
#: `tracks.ts`'s real step ids (see the drift test), and folding a sentinel
#: into it would make the derivation-vs-mirror equality check in
#: `signal-vocabulary.test.ts` lie about what it is comparing. `step` stays
#: NOT NULL and part of migration 0074's composite primary key — a NULL cannot
#: be, so a real (if sentinel) string is the only option, not merely the
#: chosen one. Starts with `_`, which no real `data-tour`-derived id in
#: `tracks.ts` does or ever will, by the same convention `TOUR_TRACK_IDS`'s
#: kebab-case ids already follow.
NO_STEP = "_track"

#: `apps/web/lib/tour/signal.ts`'s `TOUR_SIGNAL_KINDS`. Also mirrored, as a
#: literal, by migration 0074's CHECK constraint — see that file for why a
#: literal rather than an import.
TOUR_SIGNAL_KINDS: frozenset[str] = frozenset(
    {
        "tour_started",
        "step_done",
        "step_skipped",
        "did_it_for_me",
        "offline_skip",
        "tour_done",
        "tour_left",
        "step_missed",
        "ask_show_me",
        "ask_nala",
    }
)

#: Every `TourTrackId` (5) and `TourShowId` (12) in `apps/web/lib/tour/types.ts` —
#: the values `signal.ts` calls `tour`, and this module (and the request model)
#: calls `track`.
KNOWN_TRACKS: frozenset[str] = frozenset(
    {
        # Tracks (TOUR_TRACK_IDS)
        "around",
        "first-light",
        "build",
        "teach",
        "read",
        # Shows (TOUR_SHOW_IDS)
        "show-cirq",
        "show-visual",
        "show-simulate",
        "show-export",
        "show-mode",
        "show-framework",
        "show-attach",
        "show-usage",
        "show-theme",
        "show-lesson",
        "show-qapp",
        "show-atlas",
    }
)

#: Every step `id` that appears under any track or show in
#: `apps/web/lib/tour/tracks.ts`, deduplicated — a FLAT set, not paired to its
#: track. A few ids repeat across tracks/shows on purpose (e.g. "account" in
#: both `around` and `show-usage`, "code" in both `build` and `show-cirq`), and
#: a Show-me's own step objects usually carry a `copyKey` back to the track step
#: whose words they reuse, which is a copy-reuse mechanism, not a second
#: definition of the id. Flat rather than per-track: the API stores a
#: (track, step, kind) tuple and does not need to reject a real step name paired
#: with the "wrong" (but still real, for some other tour) track — bounding
#: cardinality is the goal, not modelling the tour graph.
KNOWN_STEPS: frozenset[str] = frozenset(
    {
        "account",
        "answer",
        "attach",
        "brief",
        "code",
        "convert",
        "course",
        "courses",
        "create",
        "entry",
        "export",
        "fields",
        "filters",
        "framework",
        "gates",
        "hello",
        "make",
        "map",
        "mode",
        "new-chat",
        "options",
        "plan",
        "playhead",
        "preferences",
        "prompt",
        "qapps",
        "rail",
        "result",
        "run",
        "save",
        "saved",
        "search",
        "settings",
        "simulation",
        "source",
        "split",
        "starter",
        "studio",
        "summary",
        "tours",
        "usage",
        "visual",
        "watch",
    }
)
