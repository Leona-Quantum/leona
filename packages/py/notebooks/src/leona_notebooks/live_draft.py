"""Redact a `.nb.py` draft/repair stream AS it is written.

Why this exists: the "Live" lane (plan 10-notebook-ide) streams the model's raw text
onto the run's event stream so a reader watches Nala write a notebook cell by cell,
before the pipeline ever parses a finished draft. The run's event stream is
workspace-scoped, not author-scoped — `services/api/src/majorana_api/repos/runs.py`
`get_run` filters on `Run.workspace_id` alone, with no check against the notebook's
`owner_user_id` the way `routes/notebooks.py::get_notebook_version` has for the
finished spec (ai-ops#260: *"a shared notebook arrives with the answers stripped, and
only the person who created it sees them."*). That redaction lives entirely in
`NotebookSpec.for_learner()`, called once a version is saved — it does nothing for a
character that already went out on the wire while the model was still typing. A later,
correctly redacted `notebook.draft.parsed` event cannot un-send it.

The percent format's own grammar (`source.py`) makes live redaction tractable: `role=`,
`check=` and `answer=` are HEADER attributes on the `# %%` line that STARTS a cell (see
`source.py`'s module docstring), so a cell's sensitivity is knowable the instant its
header line is complete — before a single character of its body has streamed.

`LiveDraftGuard` is a line-buffered state machine, not a parser: it never calls
`parse_source`, so a still-incomplete draft (missing cells, an unterminated string) is
never a reason for it to raise. It withholds a cell's header AND body from the moment
its header names it `role=solution`/`role=answer` or carries `check=`/`answer=`, and it
releases everything else (the YAML front-matter, ordinary cells, blank lines) as soon as
each line completes. It is intentionally MORE conservative than `for_learner()`: a
`role=solution` cell that also carries a `stub=` would, once parsed, show the stub with
its role relabelled `exercise` — but this guard has no way to show "a stub, once we see
it" mid-stream, so it withholds the whole cell live. Erring toward showing less is the
direction a redaction bug should fail in.
"""

from __future__ import annotations

import re

from leona_notebooks.spec import SOLUTION_ONLY_ROLES

#: A cell marker line, per `source.py`: `# %%`, optionally `[markdown]`/`[md]`, then
#: any number of `key=value` pairs — all on one line (the grammar has no continuation).
_CELL_MARK = re.compile(r"^# %%")
#: `role=foo` or `role="foo"` — the VALUE only needs to be recognized, not decoded, so
#: this does not need `source.py`'s full JSON-value scanner.
_ROLE_TOKEN = re.compile(r'(?:^|\s)role=("?)([A-Za-z0-9_-]+)\1')
#: Presence only. `check=` and `answer=` values are their own thing to redact (an
#: assertion, an answer key); the guard does not need to parse either to know a
#: cell that carries one must be withheld. `property=` is a check cell's expectation: it
#: is secret only in a notebook with a solution or an exercise (`for_learner()`), and the
#: solution may stream AFTER the check, so live, every check cell is withheld. The parsed
#: event that follows the draft releases the checks `for_learner()` keeps.
_SENSITIVE_KEY = re.compile(r"(?:^|\s)(?:check|answer|property)=")

_SENSITIVE_ROLE_NAMES = frozenset(role.value for role in SOLUTION_ONLY_ROLES)


def _cell_header_is_sensitive(header_line: str) -> bool:
    if _SENSITIVE_KEY.search(header_line):
        return True
    match = _ROLE_TOKEN.search(header_line)
    return bool(match) and match.group(2) in _SENSITIVE_ROLE_NAMES | {"check"}


class LiveDraftGuard:
    """Feed it text fragments in the order the provider streamed them; each call to
    `feed()` returns the SAFE portion of the input released so far (may be empty — an
    empty return is not an error, it means nothing new was decided yet). Call `flush()`
    exactly once, after the stream ends (success or failure), for whatever a completed
    line could not release because it had not yet reached its own `\\n`.

    One instance covers one streamed response (one draft attempt, or one repair
    fragment) — construct a fresh one per `_complete()` call.
    """

    def __init__(self) -> None:
        self._buffer = ""
        #: Whether the CELL CURRENTLY BEING WRITTEN is safe to release. Starts `True`:
        #: text before the first `# %%` marker is the YAML front-matter (title, kind,
        #: objectives, …), which carries no per-cell secret and `for_learner()` does
        #: not touch either.
        self._cell_safe = True

    def feed(self, text: str) -> str:
        if not text:
            return ""
        self._buffer += text
        released: list[str] = []
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            released.append(self._consume_line(line + "\n"))
        return "".join(released)

    def flush(self) -> str:
        """End of stream. A trailing partial line is released only when it is more of
        an already-classified SAFE cell's body — proven safe once, still safe. A
        partial line that has not yet finished declaring a NEW cell's header (most
        visibly: the stream ended mid-header, so a `role=`/`check=`/`answer=` token
        could have been one character away) is dropped rather than guessed at."""
        tail = self._buffer
        self._buffer = ""
        if not tail:
            return ""
        if _CELL_MARK.match(tail.lstrip("\n")):
            # An unterminated header line: sensitivity is not decidable yet.
            return ""
        return tail if self._cell_safe else ""

    def _consume_line(self, line: str) -> str:
        stripped = line[:-1] if line.endswith("\n") else line
        if _CELL_MARK.match(stripped):
            self._cell_safe = not _cell_header_is_sensitive(stripped)
            return line if self._cell_safe else ""
        # A blank/prose line between cells, or a body line of the current cell:
        # both inherit the current cell's safety — nothing outside a cell carries a
        # secret `for_learner()` would redact either.
        return line if self._cell_safe else ""


__all__ = ["LiveDraftGuard"]
