"""`mentions.py`: handles, tokens, and who a comment body resolves to.

Pure, no database. The live suite (`authz/test_comments_live.py`) proves the
member list handed to these functions is the caller's own workspace and nobody
else's; this file proves what the functions do with it.
"""

import uuid

from majorana_api.mentions import (
    MAX_MENTIONS_PER_COMMENT,
    Member,
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
