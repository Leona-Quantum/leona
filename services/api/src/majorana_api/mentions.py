"""@-mentions: how a member's handle is derived, and how a comment body resolves
to the people it names.

Pure, with no database, so the rules can be tested directly and exist in one
place on the server. `repos/comments.py` supplies the member list, and it only
ever supplies the CURRENT members of the caller's own workspace; nothing in here
can reach anyone else, because there is nobody else in its input.

## The handle

Members have an email address and, optionally, a display name. A display name is
not usable after `@`: it has spaces, it is not unique, and a person can change it
at will. The part of the email address before the `@` is what the signed-in
shell already falls back to as a name (`app/(app)/layout.tsx`), every member can
read it in the workspace's members list, and it is almost always unique inside
one workspace. So that is the handle, lowercased and reduced to the characters a
mention token can carry.

"Almost always" is the case that needs a rule. When two current members share
one, BOTH are shown with their full address as the handle and the short form
names nobody. Picking one of them for the short form would make `@alex` mean
whoever joined first, silently, and a mention that reaches the wrong person is
worse than one that reaches no one.

The full address always works as a mention, collision or not, so a reader can
always be specific.

## What never resolves

- Anyone who is not a current member. The input is the member list, so a token
  naming anyone else matches nothing, and the result is the same whether that
  person has a Leona account or not. Nothing about the outcome says which.
- The author. Being told you mentioned yourself is noise.
- An ambiguous token, as above.
- A token inside a URL path (`https://example.org/@alex`), or glued to a word
  (`me@example.org` is an address someone typed, not a mention of `example.org`).
"""

from __future__ import annotations

import dataclasses
import re
import uuid
from collections import defaultdict
from collections.abc import Iterable, Sequence

#: A comment that names more people than this is a broadcast, not a
#: conversation. The first twenty distinct people are kept, in the order they
#: appear, and the rest of the body is still saved as written.
MAX_MENTIONS_PER_COMMENT = 20

#: `@` then a handle, optionally `@domain` for the full-address form. The
#: lookbehind is what keeps `me@example.org` and `https://host/@name` from reading
#: as mentions: a mention starts a word, it is never the middle of one.
MENTION_TOKEN = re.compile(
    r"(?<![A-Za-z0-9._+\-@/])@([A-Za-z0-9._+\-]+(?:@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+)?)"
)

_UNSAFE = re.compile(r"[^a-z0-9._+\-]")


@dataclasses.dataclass(frozen=True)
class Member:
    """A current member, as the resolver needs them."""

    user_id: uuid.UUID
    email: str
    display_name: str | None = None


def _local_handle(email: str) -> str:
    local = email.rpartition("@")[0] if "@" in email else email
    return _UNSAFE.sub("", local.lower()).strip(".")


def _address_handle(email: str) -> str:
    return email.strip().lower()


def handles_for(members: Iterable[Member]) -> dict[uuid.UUID, str]:
    """Each current member's handle, with the collision rule applied."""
    members = list(members)
    by_local: dict[str, list[Member]] = defaultdict(list)
    for member in members:
        by_local[_local_handle(member.email)].append(member)
    handles: dict[uuid.UUID, str] = {}
    for local, group in by_local.items():
        for member in group:
            handles[member.user_id] = (
                local if local and len(group) == 1 else _address_handle(member.email)
            )
    return handles


def mention_tokens(body: str) -> list[str]:
    """Every mention token in `body`, lowercased, in order, duplicates kept.

    A trailing full stop is sentence punctuation (`thanks @alex.`), not part of
    the handle, so it is dropped. A handle may still contain a dot in the middle.
    """
    tokens = []
    for match in MENTION_TOKEN.finditer(body):
        token = match.group(1).rstrip(".").lower()
        if token:
            tokens.append(token)
    return tokens


def resolve_mentions(
    body: str, members: Sequence[Member], *, author_user_id: uuid.UUID
) -> list[uuid.UUID]:
    """The distinct current members `body` mentions, in order of first mention."""
    handles = handles_for(members)
    index: dict[str, set[uuid.UUID]] = defaultdict(set)
    for member in members:
        index[handles[member.user_id]].add(member.user_id)
        index[_address_handle(member.email)].add(member.user_id)

    resolved: list[uuid.UUID] = []
    for token in mention_tokens(body):
        matches = index.get(token)
        if not matches or len(matches) != 1:
            continue
        (user_id,) = matches
        if user_id == author_user_id or user_id in resolved:
            continue
        resolved.append(user_id)
        if len(resolved) >= MAX_MENTIONS_PER_COMMENT:
            break
    return resolved
