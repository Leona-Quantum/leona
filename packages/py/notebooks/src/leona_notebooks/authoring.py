"""A notebook version the READER wrote, from whichever of the three editors they use.

The in-browser editor posts a `NotebookSpec`, a text editor posts `.nb.py` percent
source, Jupyter posts an `.ipynb`. All three have to land as one kind of row, so this
module is the single place the three inputs collapse into a spec — the API route and
the worker both go through it rather than each deciding what "the notebook the reader
meant" is.

Two rules distinguish this from Nala's own build path:

1. **Exactly one input.** Two is a 400, not a precedence rule. A client that sends both
   `spec` and `ipynb` has a bug, and picking one silently would save the reader's work
   from the wrong editor.
2. **Structure is advisory.** `templates.check_structure` is a constraint on what Nala
   is asked to produce; on a reader's own edit it produces `advisory_structure()`
   warnings and nothing else. A notebook the reader is halfway through restructuring
   fails almost every rule, and refusing the save would make the editor unusable
   exactly when it is being used.
"""

from __future__ import annotations

import copy
from typing import Any

from leona_notebooks.ipynb import from_ipynb
from leona_notebooks.source import SourceParseError, parse_source
from leona_notebooks.spec import NotebookSpec
from leona_notebooks.templates import check_structure

__all__ = [
    "AuthoringInputError",
    "advisory_structure",
    "fill_cell_ids",
    "next_cell_id",
    "spec_from_author_request",
]


class AuthoringInputError(ValueError):
    """The reader's submission cannot be read as a notebook. The message is written to
    be shown to them — it carries the parser's own line-numbered complaint when the
    input was `.nb.py` source, because "could not parse" alone is useless in an
    editor."""


def next_cell_id(used: set[str], *, prefix: str = "c") -> str:
    """The lowest free `cNN` id. Same rule as `spec.assign_cell_ids` and as the
    editor's own `nextCellId` in `apps/web/lib/notebook-editing.ts`; the three have to
    agree or a client-minted id collides with a server-minted one on the next save."""
    index = 1
    while f"{prefix}{index:02d}" in used:
        index += 1
    return f"{prefix}{index:02d}"


def fill_cell_ids(cells: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Give every id-less cell dict the lowest free `cNN` id, leaving set ids alone.

    Operates on raw dicts rather than `Cell` objects, which is the whole reason it is
    not `spec.assign_cell_ids`: `Cell.id` is a required field with a regex validator
    that rejects the empty string, so a `Cell` in the state that function branches on
    (`if cell.id`) cannot be constructed at all — it can only ever be a no-op over
    well-formed input. A missing id is a property of the JSON on the wire, so it has to
    be repaired before validation, not after.
    """
    out = [dict(cell) for cell in cells]
    used = {str(cell["id"]) for cell in out if cell.get("id")}
    for cell in out:
        if not cell.get("id"):
            new_id = next_cell_id(used)
            used.add(new_id)
            cell["id"] = new_id
    return out


def spec_from_author_request(
    *,
    spec: NotebookSpec | dict[str, Any] | None = None,
    source: str | None = None,
    ipynb: dict[str, Any] | None = None,
    slug: str | None = None,
    title: str | None = None,
) -> NotebookSpec:
    """The reader's edit as a `NotebookSpec`, from exactly one of the three inputs.

    `slug` and `title` come from the notebook the version belongs to: a reader editing
    cells must not be able to move the notebook to a different slug by hand-editing the
    front matter of the source they pasted, and the title on the record stays the one
    the notebook resource carries unless the caller passes a new one.
    """
    given = [
        name
        for name, value in (("spec", spec), ("source", source), ("ipynb", ipynb))
        if value is not None
    ]
    if len(given) != 1:
        raise AuthoringInputError(
            "exactly one of spec, source or ipynb is required, got "
            + (", ".join(given) if given else "none")
        )

    if spec is not None:
        built = _spec_from_spec(spec)
    elif source is not None:
        built = _spec_from_source(source, slug=slug)
    else:
        assert ipynb is not None  # the exactly-one check above
        built = _spec_from_ipynb(ipynb, slug=slug)

    update: dict[str, Any] = {}
    if slug:
        update["slug"] = slug
    if title:
        update["title"] = title
    return built.model_copy(update=update) if update else built


def _spec_from_spec(spec: NotebookSpec | dict[str, Any]) -> NotebookSpec:
    if isinstance(spec, NotebookSpec):
        return spec
    payload = copy.deepcopy(spec)
    cells = payload.get("cells")
    if isinstance(cells, list) and all(isinstance(cell, dict) for cell in cells):
        payload["cells"] = fill_cell_ids(cells)
    try:
        return NotebookSpec.model_validate(payload)
    except Exception as exc:  # pydantic ValidationError, or a non-mapping payload
        raise AuthoringInputError(f"this notebook is not a valid spec: {exc}") from None


def _spec_from_source(source: str, *, slug: str | None) -> NotebookSpec:
    try:
        return parse_source(source, slug=slug)
    except SourceParseError as exc:
        # The parser's message names the offending line; it is the only thing that
        # makes a parse failure actionable inside an editor, so it is carried through
        # verbatim rather than replaced with a generic sentence.
        raise AuthoringInputError(f"could not read this notebook source: {exc}") from None
    except Exception as exc:
        raise AuthoringInputError(f"could not read this notebook source: {exc}") from None


def _spec_from_ipynb(ipynb: dict[str, Any], *, slug: str | None) -> NotebookSpec:
    try:
        return from_ipynb(ipynb, slug=slug)
    except Exception as exc:
        raise AuthoringInputError(f"could not read this .ipynb: {exc}") from None


def advisory_structure(spec: NotebookSpec) -> list[str]:
    """The structure requirements this spec does not meet, as warnings.

    Exactly `templates.check_structure`, relabelled: the same list that is a hard
    constraint on a generated notebook is advisory on an authored one. Returned rather
    than raised — nothing in the authoring path may refuse a reader's edit for
    structure, and a caller that turned this into a refusal would be reintroducing the
    thing the editor exists to avoid.
    """
    try:
        return list(check_structure(spec))
    except KeyError:
        # `_RULES` is keyed by NotebookKind; a kind with no rule table is not a reason
        # to fail a save, so an unknown kind simply has nothing to warn about.
        return []
