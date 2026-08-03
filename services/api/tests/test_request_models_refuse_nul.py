"""No request body may 500 on a NUL byte, and none may forget to say so.

`"a\\u0000b"` is valid JSON, valid Python `str`, and unstorable: psycopg raises
`PostgreSQL text fields cannot contain NUL (0x00) bytes` at the moment the row
is written. Before `RequestModel`, four of six probed write endpoints answered
**500** to it — including `POST /v1/runs`, the product's main action.

Two halves, and the second is the one that lasts:

- The behaviour: a body carrying NUL is refused 422, at the top level and
  nested inside a free-form dict.
- The structure: every `*Request` class in `routes/` inherits `RequestModel`.
  Fixing the four fields that were found would have left the fifty-first field
  somebody writes next month, and that one is invisible — it behaves perfectly
  until a client sends the byte.
"""

import importlib
import inspect
import pathlib
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from majorana_api.request_models import NUL_REFUSAL, RequestModel, _has_nul

ROUTES = pathlib.Path(__file__).resolve().parents[1] / "src" / "majorana_api" / "routes"


def _request_classes() -> list[tuple[str, type[BaseModel]]]:
    """(module, class) for every `*Request` model under routes/.

    The modules are imported and `issubclass` asks the real question. An earlier
    version read the base names out of the AST and reported
    `SwitchWorkspaceRequest(WorkspaceRefRequest)` as uncovered — it inherits the
    guard one level up. Approximating inheritance with source text is a gate
    that is wrong in whichever direction the approximation happens to lean, and
    a gate wrong in the quiet direction is worse than none.
    """
    found: list[tuple[str, type[BaseModel]]] = []
    for path in sorted(ROUTES.glob("*.py")):
        if path.name == "__init__.py":
            continue
        module = importlib.import_module(f"majorana_api.routes.{path.stem}")
        for name, obj in vars(module).items():
            if (
                inspect.isclass(obj)
                and issubclass(obj, BaseModel)
                and name.endswith("Request")
                # Declared here, not imported from a sibling — otherwise one
                # class is reported once per module that imports it.
                and obj.__module__ == module.__name__
            ):
                found.append((path.name, obj))
    return found


def test_every_request_body_inherits_the_guard():
    offenders = [
        f"{module}::{cls.__name__}"
        for module, cls in _request_classes()
        if not issubclass(cls, RequestModel)
    ]
    assert not offenders, (
        "these request bodies do not inherit the NUL guard, so a NUL byte in "
        f"any of their fields reaches Postgres and 500s: {offenders}. "
        "Inherit majorana_api.request_models.RequestModel instead."
    )


def test_the_scan_found_the_request_classes_it_is_guarding():
    """Positive control. A glob that matched nothing would pass the test above."""
    classes = _request_classes()
    assert len(classes) > 10, f"only {len(classes)} request classes found under {ROUTES}"
    names = {cls.__name__ for _module, cls in classes}
    # Named individually rather than counted: these are the bodies whose 500 was
    # actually measured, so a refactor that moves them somewhere this scan
    # cannot see must fail here rather than quietly reduce the count.
    for expected in ("CreateRunRequest", "CreateProjectRequest", "CreateFolderRequest"):
        assert expected in names, f"{expected} is no longer under {ROUTES}"


def test_a_plain_pydantic_model_would_be_caught():
    """The second control: the check must be able to say no.

    `test_every_request_body_inherits_the_guard` passes when the codebase is
    clean, which is also what it does if `issubclass` were inverted or the
    offender list built wrong.
    """

    class NotGuardedRequest(BaseModel):
        label: str

    assert not issubclass(NotGuardedRequest, RequestModel)
    assert NotGuardedRequest(label="a\x00b").label == "a\x00b"


class _Body(RequestModel):
    label: str
    payload: dict | None = None


def test_a_nul_at_the_top_level_is_refused():
    with pytest.raises(ValidationError) as caught:
        _Body(label="a\x00b")
    assert NUL_REFUSAL in str(caught.value)


def test_a_nul_nested_in_a_free_form_dict_is_refused():
    """`resource_estimates` and `framework_variants` go straight to JSONB.

    JSONB refuses NUL as well, so a guard that only read declared `str` fields
    would have moved the 500 rather than removed it.
    """
    with pytest.raises(ValidationError):
        _Body(label="fine", payload={"depth": {"nested": ["ok", "bad\x00"]}})
    with pytest.raises(ValidationError):
        _Body(label="fine", payload={"bad\x00key": 1})


def test_everything_else_a_person_might_type_still_goes_through():
    """The rule is "storable", not "tidy".

    Newlines, emoji, RTL marks and combining characters all round-trip through
    Postgres — every one of them was measured against the live database. A guard
    that refused them would be this module inventing a content policy.
    """
    for value in ["a\nb", "🧪 quantum", "مشروع الكم", "é" * 40, "量子回路", "tab\there"]:
        assert _Body(label=value).label == value


def test_the_helper_says_no_to_things_that_are_not_text():
    assert not _has_nul(None)
    assert not _has_nul(7)
    assert not _has_nul({"a": [1, 2, {"b": "fine"}]})
    assert _has_nul(["fine", ("also fine", "bad\x00")])


def test_a_deeply_nested_body_does_not_recurse_the_guard_into_a_500():
    """The guard must not be the thing that 500s.

    A few kilobytes of nested arrays parses fine and, walked recursively, goes
    past Python's recursion limit inside a validator — which is a 500 on the
    exact payload shape this module exists to refuse. Depth here is well past
    the default limit of 1000.
    """
    deep: Any = "bottom"
    for _ in range(5000):
        deep = [deep]
    assert _has_nul(deep) is False
    assert _Body(label="fine", payload={"deep": deep}).label == "fine"

    poisoned: Any = "bad\x00"
    for _ in range(5000):
        poisoned = [poisoned]
    assert _has_nul(poisoned) is True
    with pytest.raises(ValidationError):
        _Body(label="fine", payload={"deep": poisoned})


def test_a_wide_and_deep_mapping_is_walked_too():
    """Dicts nest as readily as lists, and their KEYS are walked as well."""
    nested: Any = {"leaf": "bad\x00"}
    for index in range(2000):
        nested = {f"level{index}": nested}
    assert _has_nul(nested) is True
