"""@-mentions: how a member's handle is derived, and how a comment body resolves
to the people it names.

Pure, with no database, so the rules can be tested directly and exist in one
place on the server. `repos/comments.py` supplies the member list, and it only
ever supplies the CURRENT members of the caller's own workspace; nothing in here
can reach anyone else, because there is nobody else in its input.

## The one invariant

**Every handle this module hands out is a token its own parser reads back as
that member, and as nobody else.** `GET /v1/comments/people` serves these
handles, the composer inserts `@handle ` from that list, and the server parses
the body with `mention_tokens`. A handle the parser cannot read, or reads as two
people, is a member nobody can mention, with a suggestion list that says they
can. `test_comment_mentions.py` checks the invariant for every member of many
generated workspaces, non-ASCII and colliding addresses included.

## The handle, in the order it is tried

Members have an email address and, optionally, a display name. A display name is
not usable after `@`: it has spaces, it is not unique, and a person can change it
at will. The part of the email address before the `@` is what the signed-in
shell already falls back to as a name (`app/(app)/layout.tsx`), and every member
can read it in the workspace's members list.

1. **The short form**: that local part, with accents folded to ASCII (`josé` to
   `jose`), lowercased, and reduced to the characters a token can carry. Used
   when it is non-empty and no other current member's short form is the same.
   When two members share one, NEITHER gets it: `@alex` meaning whoever joined
   first would reach the wrong person silently, and a mention that reaches the
   wrong person is worse than one that reaches no one.
2. **The full address**, lowercased, when the short form was not usable, the
   address is itself a token the parser reads whole (ASCII, a dotted domain), and
   no other member has the same address.
3. **`member-` and the tail of the user id**, when neither of the above can be
   read back: an address in another script (`山田@例え.jp`), a short form that
   folds to nothing, two accounts that share one address. Not pretty, but it is a
   handle that works, which the alternatives are not.

Every handle is checked against the ones already given before it is used, so
the three kinds can never collide with one another either.

The full address also works as a mention whenever it is unique and readable,
whichever handle the member was given, so a reader can always be specific.

## What never resolves

- Anyone who is not a current member. The input is the member list, so a token
  naming anyone else matches nothing, and the result is the same whether that
  person has a Leona account or not. Nothing about the outcome says which.
- The author. Being told you mentioned yourself is noise.
- A short form two members share, as above.
- A token inside a URL path (`https://example.org/@alex`), or glued to a word
  (`me@example.org` is an address someone typed, not a mention of `example.org`).
"""

from __future__ import annotations

import dataclasses
import re
import unicodedata
import uuid
from collections import Counter
from collections.abc import Iterable, Sequence

#: A comment that names more people than this is a broadcast, not a
#: conversation. The first twenty distinct people are kept, in the order they
#: appear, and the rest of the body is still saved as written.
MAX_MENTIONS_PER_COMMENT = 20

#: `@` then a handle, optionally `@domain` for the full-address form. The
#: lookbehind is what keeps `me@example.org` and `https://host/@name` from reading
#: as mentions: a mention starts a word, it is never the middle of one.
#: Mirrored by `MENTION_PATTERN` in apps/web/lib/comment-text.ts.
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


def _read_back(handle: str) -> str | None:
    """What the parser makes of `@handle`, or None when it reads nothing.

    The one definition of "a handle the parser accepts": a candidate is usable
    only if this returns it unchanged.
    """
    tokens = mention_tokens(f"@{handle}")
    return tokens[0] if len(tokens) == 1 else None


def _readable(handle: str) -> bool:
    return bool(handle) and _read_back(handle) == handle


def _short_form(email: str) -> str:
    local = email.rpartition("@")[0] if "@" in email else email
    folded = unicodedata.normalize("NFKD", local).encode("ascii", "ignore").decode("ascii")
    # Dots are trimmed from BOTH ends: a trailing one is sentence punctuation to
    # the parser (`thanks @sam.`), and a leading one reads fine but looks like a typo.
    return _UNSAFE.sub("", folded.lower()).strip(".")


def _address_form(email: str) -> str:
    return email.strip().lower()


def _fallback_forms(user_id: uuid.UUID) -> Iterable[str]:
    # The id's tail, not its head: uuid7 ids lead with a timestamp, so two
    # accounts made in the same millisecond share a prefix but not a tail.
    tail = user_id.hex
    yield f"member-{tail[-8:]}"
    yield f"member-{tail[-12:]}"
    yield f"member-{tail}"
    n = 2
    while True:
        yield f"member-{tail}-{n}"
        n += 1


@dataclasses.dataclass(frozen=True)
class _Forms:
    shorts: dict[uuid.UUID, str]
    addresses: dict[uuid.UUID, str]
    short_counts: Counter[str]
    address_counts: Counter[str]

    @classmethod
    def of(cls, members: Sequence[Member]) -> _Forms:
        shorts = {m.user_id: _short_form(m.email) for m in members}
        addresses = {m.user_id: _address_form(m.email) for m in members}
        return cls(shorts, addresses, Counter(shorts.values()), Counter(addresses.values()))

    def address_usable(self, user_id: uuid.UUID) -> bool:
        """This member's full address names them and nobody else.

        Unique among addresses, readable by the parser, and not a short form some
        OTHER member has. The last only bites on a stored address with no `@`
        (`bob`), which is both its own short form and its own address: it must not
        become a way to reach one of two members who share the short form `bob`.
        """
        address = self.addresses[user_id]
        others_short = self.short_counts[address] - (self.shorts[user_id] == address)
        return self.address_counts[address] == 1 and others_short == 0 and _readable(address)


def handles_for(members: Iterable[Member]) -> dict[uuid.UUID, str]:
    """Each current member's handle. See the module docstring for the order."""
    members = list(members)
    forms = _Forms.of(members)
    shorts, addresses = forms.shorts, forms.addresses
    short_counts = forms.short_counts

    handles: dict[uuid.UUID, str] = {}
    # Every string any member COULD be read as. A fallback must avoid all of
    # them, including short forms nobody was given because two people share them:
    # handing one of those to a third member would make it ambiguous again.
    reserved = set(shorts.values()) | set(addresses.values())
    taken: set[str] = set()

    def give(member: Member, handle: str) -> None:
        handles[member.user_id] = handle
        taken.add(handle)

    for member in members:
        short = shorts[member.user_id]
        if short_counts[short] == 1 and _readable(short):
            give(member, short)
    for member in members:
        if member.user_id in handles:
            continue
        address = addresses[member.user_id]
        if forms.address_usable(member.user_id) and address not in taken:
            give(member, address)
    for member in members:
        if member.user_id in handles:
            continue
        for candidate in _fallback_forms(member.user_id):
            if candidate not in taken and candidate not in reserved:
                give(member, candidate)
                break
    return handles


def _index(members: Sequence[Member]) -> dict[str, uuid.UUID]:
    """Every token that names exactly one member: the handles, plus each unique,
    readable full address as an alias."""
    handles = handles_for(members)
    index = {handle: user_id for user_id, handle in handles.items()}
    forms = _Forms.of(members)
    for member in members:
        if forms.address_usable(member.user_id):
            # setdefault: an address never displaces a handle already given.
            index.setdefault(forms.addresses[member.user_id], member.user_id)
    return index


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
    index = _index(members)
    resolved: list[uuid.UUID] = []
    for token in mention_tokens(body):
        user_id = index.get(token)
        if user_id is None or user_id == author_user_id or user_id in resolved:
            continue
        resolved.append(user_id)
        if len(resolved) >= MAX_MENTIONS_PER_COMMENT:
            break
    return resolved
