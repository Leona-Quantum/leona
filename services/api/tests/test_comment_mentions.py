"""`mentions.py`: handles, tokens, and who a comment body resolves to.

Pure, no database. The live suite (`authz/test_comments_live.py`) proves the
member list handed to these functions is the caller's own workspace and nobody
else's; this file proves what the functions do with it.
"""

import random
import uuid
from collections import Counter

from majorana_api.mentions import (
    MAX_MENTIONS_PER_COMMENT,
    Member,
    _short_form,
    handles_for,
    mention_tokens,
    resolve_mentions,
)

ALEX = Member(uuid.uuid4(), "Alex.Kim@lab.example", "Alex Kim")
SAM = Member(uuid.uuid4(), "sam@lab.example", "Sam")
AUTHOR = Member(uuid.uuid4(), "writer@lab.example", "Writer")


def _resolve(body: str, members, author=AUTHOR) -> list[uuid.UUID]:
    return resolve_mentions(body, list(members), author_user_id=author.user_id)


def test_the_handle_is_the_address_before_the_at_sign_lowercased():
    handles = handles_for([ALEX, SAM])
    assert handles == {ALEX.user_id: "alex.kim", SAM.user_id: "sam"}


def test_characters_a_token_cannot_carry_are_dropped_from_the_handle():
    odd = Member(uuid.uuid4(), "O'Brien!@lab.example")
    assert handles_for([odd]) == {odd.user_id: "obrien"}
    assert _resolve("thanks @obrien", [odd, AUTHOR]) == [odd.user_id]


def test_two_members_sharing_a_short_handle_both_get_their_full_address():
    """Neither short form names anyone: `@alex` meaning whoever joined first
    would reach the wrong person silently."""
    alex_a = Member(uuid.uuid4(), "alex@one.example")
    alex_b = Member(uuid.uuid4(), "alex@two.example")
    members = [alex_a, alex_b, AUTHOR]
    assert handles_for(members)[alex_a.user_id] == "alex@one.example"
    assert handles_for(members)[alex_b.user_id] == "alex@two.example"
    assert _resolve("@alex can you look", members) == []
    assert _resolve("@alex@two.example can you look", members) == [alex_b.user_id]


def test_the_full_address_always_works_even_without_a_collision():
    assert _resolve("cc @sam@lab.example", [SAM, AUTHOR]) == [SAM.user_id]
    assert _resolve("cc @SAM@Lab.Example", [SAM, AUTHOR]) == [SAM.user_id]


def test_only_members_in_the_list_resolve_and_nobody_else_is_consulted():
    """The resolver's input is the workspace's current members. A token naming
    anyone else, with or without an account somewhere, matches nothing."""
    assert _resolve("@sam and @stranger and @stranger@elsewhere.example", [SAM, AUTHOR]) == [
        SAM.user_id
    ]
    assert _resolve("@sam", [AUTHOR]) == [], "a member who has left is not in the list"


def test_the_author_is_never_mentioned_and_repeats_count_once_in_first_order():
    body = "@writer @sam @alex.kim @sam @writer"
    assert _resolve(body, [ALEX, SAM, AUTHOR]) == [SAM.user_id, ALEX.user_id]


def test_an_address_or_a_url_path_in_the_text_is_not_a_mention():
    assert mention_tokens("write to me@lab.example") == []
    assert mention_tokens("see https://social.example/@sam for it") == []
    assert mention_tokens("@@sam") == []


def test_sentence_punctuation_is_not_part_of_the_handle():
    assert mention_tokens("thanks @alex.kim.") == ["alex.kim"]
    assert mention_tokens("(@sam), @sam!") == ["sam", "sam"]
    assert mention_tokens("@sam\n@alex.kim") == ["sam", "alex.kim"]


def test_a_mention_straight_after_japanese_text_still_reads():
    assert _resolve("確認お願いします@sam", [SAM, AUTHOR]) == [SAM.user_id]


def test_a_comment_names_at_most_twenty_people():
    crowd = [Member(uuid.uuid4(), f"person{i}@lab.example") for i in range(30)]
    body = " ".join(f"@person{i}" for i in range(30))
    resolved = _resolve(body, [*crowd, AUTHOR])
    assert len(resolved) == MAX_MENTIONS_PER_COMMENT
    assert resolved == [m.user_id for m in crowd[:MAX_MENTIONS_PER_COMMENT]]


def test_an_empty_local_part_falls_back_to_the_address():
    odd = Member(uuid.uuid4(), "...@lab.example")
    assert handles_for([odd]) == {odd.user_id: "...@lab.example"}


# ------------------------------------------------------------------ the invariant
#
# Every handle `handles_for` gives out is read back by the parser as that member
# and nobody else (Greptile on PR 968: a full address in another script was served
# as a handle the parser could not read, so autocomplete offered a member nobody
# could reach). Checked over named hard cases and over many generated workspaces.

HARD_EMAILS = [
    "José@lab.example",  # folds to `jose`
    "jose@lab.example",  # ...and collides with it
    "山田@例え.jp",  # nothing ASCII in the local part or the domain
    "ÅSA@exämple.com",  # folds to `asa`; its address is not a token
    "asa@lab.example",  # collides with the one above
    "dup@lab.example",  # two accounts, one address
    "DUP@lab.example",
    "...@lab.example",  # short form folds to nothing
    "o'brien@lab.example",
    "obrien@lab.example",  # collides after the apostrophe goes
    "+tag@lab.example",
    "sam.@lab.example",  # trailing dot is sentence punctuation to the parser
    "a_b@under_score.example",  # domain the parser cannot read
    "bob",  # a stored address with no @ at all
    "bob@lab.example",  # shares the short form `bob` with it
    "member-00000001@lab.example",  # shaped like a fallback handle
]


def _members(emails, seed=0):
    rng = random.Random(seed)
    return [Member(uuid.UUID(int=rng.getrandbits(128)), email) for email in emails]


def _assert_every_handle_round_trips(members):
    handles = handles_for(members)
    assert set(handles) == {m.user_id for m in members}, "every member gets a handle"
    assert len(set(handles.values())) == len(handles), f"two members share a handle: {handles}"
    outsider = uuid.uuid4()
    for member in members:
        handle = handles[member.user_id]
        assert mention_tokens(f"@{handle}") == [handle], f"the parser cannot read {handle!r}"
        # As the composer inserts it (`@handle ` and more text), mid-sentence.
        body = f"thanks @{handle} for checking."
        assert resolve_mentions(body, members, author_user_id=outsider) == [member.user_id], (
            f"{member.email!r} was given {handle!r}, which does not reach them"
        )
    # And the collision rule: a short form two current members share reaches
    # neither of them, nor anybody else who happens to be handed that string.
    shorts = Counter(_short_form(m.email) for m in members)
    for short, count in shorts.items():
        if count > 1 and short:
            assert resolve_mentions(f"@{short}", members, author_user_id=outsider) == [], (
                f"the shared short form {short!r} reaches someone"
            )
    everyone = " ".join(f"@{handles[m.user_id]}" for m in members)
    assert (
        resolve_mentions(everyone, members, author_user_id=outsider)
        == [m.user_id for m in members][:MAX_MENTIONS_PER_COMMENT]
    )


def test_every_handle_in_a_workspace_of_hard_addresses_reaches_its_member():
    members = _members(HARD_EMAILS)
    _assert_every_handle_round_trips(members)
    handles = {
        m.email: h for m, h in zip(members, [handles_for(members)[m.user_id] for m in members])
    }
    assert handles["山田@例え.jp"].startswith("member-")
    # The named expectations, so a regression says which rule moved.
    assert handles["o'brien@lab.example"].startswith("member-"), (
        "its short form is shared with obrien, and an apostrophe is not a token character"
    )
    assert handles["obrien@lab.example"] == "obrien@lab.example"
    assert handles["jose@lab.example"] == "jose@lab.example"
    assert handles["José@lab.example"].startswith("member-"), (
        "its address is not ASCII, and its short form is shared, so only the fallback works"
    )
    assert handles["asa@lab.example"] == "asa@lab.example"
    assert handles["ÅSA@exämple.com"].startswith("member-")
    assert handles["dup@lab.example"].startswith("member-")
    assert handles["DUP@lab.example"].startswith("member-")
    assert handles["+tag@lab.example"] == "+tag"
    assert handles["sam.@lab.example"] == "sam"
    assert handles["a_b@under_score.example"] == "a_b", (
        "underscore is a token character; the domain is not"
    )
    assert handles["bob@lab.example"] == "bob@lab.example"
    assert handles["bob"].startswith("member-"), "`bob` alone must not reach one of two bobs"
    assert handles["member-00000001@lab.example"] == "member-00000001"


def test_a_fallback_never_takes_a_short_form_two_other_members_share():
    """Two members share the short form `member-deadbeef`, so it names nobody. A third
    member whose fallback would be exactly that string must be given another."""
    a = Member(uuid.UUID("00000000-0000-7000-8000-0000deadbeef"), "山田@例え.jp")
    c = Member(uuid.uuid4(), "member-deadbeef@one.example")
    d = Member(uuid.uuid4(), "member-deadbeef@two.example")
    handles = handles_for([a, c, d])
    assert handles[a.user_id] != "member-deadbeef"
    assert handles[a.user_id].startswith("member-")
    _assert_every_handle_round_trips([a, c, d])


def test_a_lone_accented_address_gets_its_folded_short_form():
    [jose] = _members(["José@lab.example"])
    assert handles_for([jose]) == {jose.user_id: "jose"}
    assert resolve_mentions("@jose", [jose], author_user_id=uuid.uuid4()) == [jose.user_id]


def test_a_shared_short_form_still_reaches_nobody():
    members = _members(["jose@one.example", "José@two.example", "writer@lab.example"])
    assert resolve_mentions("@jose", members, author_user_id=members[2].user_id) == []


def test_every_handle_round_trips_in_generated_workspaces():
    """Property-style: 400 workspaces drawn from local parts and domains chosen to
    collide, fold, vanish, or be unreadable."""
    locals_ = [
        "alex",
        "Alex",
        "ALEX",
        "alex.",
        ".alex",
        "al.ex",
        "José",
        "jose",
        "Jöse",
        "山田",
        "yamada",
        "Ωmega",
        "omega",
        "o'brien",
        "obrien",
        "a+b",
        "+b",
        "-",
        "...",
        "_",
        "member-1a2b3c4d",
        "sam",
        "Sam",
        "dup",
        "x" * 40,
        "ñ",
        "n",
        "é",
        "e",
        "bob",
    ]
    domains = ["lab.example", "one.example", "exämple.com", "例え.jp", "under_score.example", ""]
    rng = random.Random(968)
    for _ in range(400):
        size = rng.randint(1, 12)
        emails = []
        for _ in range(size):
            local, domain = rng.choice(locals_), rng.choice(domains)
            emails.append(f"{local}@{domain}" if domain else local)
        # Some workspaces hold two accounts with the very same address.
        if rng.random() < 0.3 and emails:
            emails.append(rng.choice(emails))
        _assert_every_handle_round_trips(_members(emails, seed=rng.getrandbits(32)))
