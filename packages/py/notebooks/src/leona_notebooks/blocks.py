"""Block cells: an Atlas method placed in a notebook, with its cost worked out on the page.

A `role=block` cell carries a `BlockRef` (`majorana_contracts.notebooks`): the Atlas method,
and, when the method is a stage of one of the workflow planner's problems, the planner's
INPUTS (the problem, the parameter values, the method chosen at each stage). Never its
numbers. The web page re-runs the planner over those inputs every time it draws the
block, at whatever problem size the reader moves it to, and lists the notebook's own
check cells that name the block (`CheckProperty.block`) as evidence up to the size they
ran at (plan: ai-ops/desk/leona/plans/platform-vision-20260924/phase-b/PLAN.md, slice S1;
VISION §5.3).

This module owns the Python side:

1. **Prose** — `block_comment`, the cell's `source`: the block in words, so the cell reads
   as a paragraph in Jupyter or any other Markdown reader. It carries no number, because
   none is stored, and no authorship, because accepting a block must not change its text.
2. **Authorship** — `enforce_block_authorship`, the same rules as a check
   (`leona_notebooks.checks.authorship_stamp`): Nala may propose a block, only a person
   accepts one, a file upload can only lower trust, and a repair may not touch one
   (`leona_notebooks.checks.restore_checks` restores blocks too).

Learner redaction lives with the contract (`NotebookSpec.for_learner`), because a cost can
give an exercise's answer away and every door reads that one method.
"""

from __future__ import annotations

import json
from typing import Any

from majorana_contracts.notebooks import BlockRef

from leona_notebooks.checks import Actor, authorship_stamp, authorship_words
from leona_notebooks.spec import Cell, NotebookSpec

__all__ = [
    "ATLAS_METHOD_URL",
    "block_comment",
    "block_export_source",
    "enforce_block_authorship",
]

#: Where a reader outside Leona can read the method. The page's own link is relative
#: (`/repository/layers/<id>`); a notebook downloaded as a file needs the whole address.
ATLAS_METHOD_URL = "https://leonaqt.com/repository/layers/{method}"


def _number(value: float) -> str:
    return f"{value:g}"


def block_comment(ref: BlockRef) -> str:
    """The source of a `role=block` cell: the block in plain words, rendered from the ref.

    What the page shows in its place is a card; this is what every other reader of the
    notebook sees. No numbers the planner would compute, since none are stored, and no
    authorship, since accepting a block must not change its text.
    """
    lines = [f"**Leona block: `{ref.method}`**, a method from Leona's Atlas.", ""]
    if ref.plan is None:
        lines.append(
            "Its cost is the one the method's own source states, on its Atlas page. "
            "Leona shows it beside the checks in this notebook that are evidence for it."
        )
    else:
        plan = ref.plan
        given = [
            f"{key} = {_number(value)}" for key, value in plan.params.items() if value is not None
        ]
        with_values = f", with {', '.join(given)}" if given else ""
        lines.append(
            f"Its cost comes from Leona's workflow planner for the `{plan.problem}` "
            f"problem{with_values}. Leona works the numbers out again each time the "
            "notebook is opened, so none are written here."
        )
        if plan.choices:
            chosen = ", ".join(f"`{method}` at `{path}`" for path, method in plan.choices.items())
            lines.append("")
            lines.append(f"Methods chosen in the plan: {chosen}.")
        if ref.size_param is not None:
            lines.append("")
            lines.append(f"The problem size a reader can change is `{ref.size_param}`.")
    lines.append("")
    lines.append(f"Atlas page: {ATLAS_METHOD_URL.format(method=ref.method)}")
    return "\n".join(lines) + "\n"


def block_export_source(ref: BlockRef) -> str:
    """The source of a block cell in an exported `.ipynb`: the prose above, plus who wrote
    it and where the block itself is kept (the cell's `leona.block` metadata, which
    `from_ipynb` reads back)."""
    return (
        block_comment(ref)
        + f"\nWritten: {authorship_words(ref)}. The block itself is in this cell's "
        "metadata (leona.block).\n"
    )


def enforce_block_authorship(
    new: NotebookSpec, parent: NotebookSpec | None, actor: Actor
) -> NotebookSpec:
    """Stamp every block in `new` with who wrote it, compared by cell id with `parent`.

    The rules are a check's (`leona_notebooks.checks.enforce_check_authorship`, DESIGN
    §1.4), applied to `BlockRef` and by the same function (`authorship_stamp`):

    - **actor = nala**: a block Nala adds or changes is Nala's and unaccepted. Nala
      cannot promote one to `source` or to accepted.
    - **actor = user**: a new or changed block is the reader's, accepted, or `source` when
      they mark it so with a citation. An unchanged one keeps its author, and the reader
      may accept it.
    - **actor = user, no parent** (an uploaded `.ipynb`): a block the file says is Nala's
      stays Nala's and unaccepted; every other is the reader's; `source` is never taken
      from a file.

    "Changed" is `BlockRef.claim_key`: the method, the plan and the size parameter. For
    the reader a citation alone is not a change (it stays Nala's block with the reader's
    note); for Nala it is. A block matching one the parent had under another id is the
    same block, so renaming the cell launders nothing. Every block cell's source is
    re-rendered from its ref.
    """

    def key(ref: BlockRef) -> str:
        data: dict[str, Any] = ref.claim_key()
        if actor == "user":
            data.pop("citation", None)
        return json.dumps(data, sort_keys=True)

    by_id: dict[str, BlockRef] = {}
    by_key: dict[str, BlockRef] = {}
    if parent is not None:
        for earlier in parent.cells:
            if earlier.block is not None:
                by_id[earlier.id] = earlier.block
                by_key.setdefault(key(earlier.block), earlier.block)
    cells: list[Cell] = []
    for cell in new.cells:
        ref = cell.block
        if ref is None:
            cells.append(cell)
            continue
        prior = by_id.get(cell.id)
        if prior is None or key(prior) != key(ref):
            prior = by_key.get(key(ref))
        stamp = authorship_stamp(actor, prior=prior, submitted=ref, has_parent=parent is not None)
        stamped = ref.model_copy(update=stamp)
        cells.append(cell.model_copy(update={"block": stamped, "source": block_comment(stamped)}))
    return new.with_cells(cells)
