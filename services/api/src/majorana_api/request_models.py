"""The base every request body inherits, and the one thing it refuses.

## Why this exists

`POST /v1/runs` with `{"task_prompt": "a\\u0000b"}` answered **500**. So did
creating a project, creating a folder, and setting a display name — four of the
six write endpoints probed. The cause is one line down in psycopg:

    PostgreSQL text fields cannot contain NUL (0x00) bytes

`\\u0000` is valid JSON and valid Python `str`, so it passes every length,
pattern and enum check a request model has, and fails at the moment the row is
written. Nothing in the service refused it, which means any client could produce
an unhandled server error on the product's main action with a two-character
payload — and a user who pastes text out of a binary file gets "internal error"
for something that is not internal at all.

## Why the check is here and not on the fields

Annotating the fields would mean annotating the fields that exist today. There
were 51 string-ish fields across the route models when this was written, and
the one that gets forgotten is invisible: it behaves correctly until somebody
sends the byte. `test_request_models_refuse_nul.py` closes that by asserting
every `*Request` class in `routes/` inherits this, so a new request body is
covered by being written rather than by being remembered.

## Why the whole payload is walked, not just the top-level strings

JSONB refuses NUL too (`unsupported Unicode escape sequence`), and several
bodies carry free-form dicts — `resource_estimates`, `framework_variants` —
straight into a JSON column. A guard that only read top-level `str` fields
would move the 500 rather than remove it.

## Why NUL specifically, and nothing else

Newlines, emoji, RTL marks, combining characters and every other control byte
are storable and were measured to round-trip correctly. Refusing them would be
this module inventing a content policy. NUL is refused because Postgres refuses
it: the rule is "storable", not "tidy".
"""

from typing import Any

from pydantic import BaseModel, model_validator

#: What a caller is told. Deliberately names the character rather than the
#: database: "text fields cannot contain NUL" describes their payload, whereas
#: a psycopg sentence describes our storage engine to somebody who did not ask.
NUL_REFUSAL = "text may not contain a NUL (\\u0000) character"


def _has_nul(value: Any) -> bool:
    """Whether a NUL appears anywhere in a parsed JSON value.

    Walks dicts and sequences, and checks dict KEYS as well as values — a JSON
    object may be keyed by any string, and those keys reach the same JSONB
    columns the values do.

    **Iterative, with an explicit stack.** The recursive version was one line
    shorter and could produce the exact failure this module exists to prevent:
    a small body of deeply nested arrays (`[[[[...]]]]`, a few kilobytes) parses
    fine and then walks past Python's recursion limit, and a `RecursionError`
    inside a validator is a 500. A guard that 500s on a payload shape is not a
    guard, it is a second way in.

    No depth cap is needed once the walk is iterative: the work is bounded by
    the size of the body, which the ASGI layer already bounds.
    """
    stack: list[Any] = [value]
    while stack:
        current = stack.pop()
        if isinstance(current, str):
            if "\x00" in current:
                return True
        elif isinstance(current, dict):
            for key, item in current.items():
                stack.append(key)
                stack.append(item)
        elif isinstance(current, (list, tuple, set)):
            stack.extend(current)
    return False


class RequestModel(BaseModel):
    """A request body. Refuses NUL anywhere in its payload, with a 422.

    `mode="before"` on purpose: the check runs on the raw parsed JSON, so it
    covers fields this model does not declare (which `extra="forbid"` would
    otherwise reject with a less useful message) and fields whose declared type
    is not `str`.
    """

    @model_validator(mode="before")
    @classmethod
    def _refuse_nul(cls, data: Any) -> Any:
        if _has_nul(data):
            raise ValueError(NUL_REFUSAL)
        return data
