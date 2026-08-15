"""`orphaned_identities` — the rule that decides what `retire-bootstrap` withdraws.

Tested without a database for the reason `plan_re_attestation` is: this set is
what a `--authorize` run soft-deletes out of the public catalog, so the rule that
computes it should be checkable without standing a Postgres up first.

The failure it exists to close: the importer reconciles absent -> create,
unchanged -> no-op, changed -> new version, and has no fourth branch. A record
deleted from the corpus is never visited again and keeps its ACCEPTED/PUBLIC row,
so before `retire-bootstrap` existed, deleting 90 records changed the corpus, the
manifest and five pinned test counts, and changed nothing a visitor to
/repository saw.
"""

from __future__ import annotations

import uuid

from majorana_api.catalog_admin import orphaned_identities


def _published(*identities: str) -> dict[str, uuid.UUID]:
    return {identity: uuid.uuid4() for identity in identities}


def test_a_record_the_manifest_stopped_claiming_is_an_orphan():
    published = _published("benchmark-ghz-chain-3q", "benchmark-ghz-chain-4q")
    orphans = orphaned_identities(published, {"benchmark-ghz-chain-3q"})

    assert set(orphans) == {"benchmark-ghz-chain-4q"}
    # The artifact id travels with the identity: the caller soft-deletes by id,
    # and re-resolving it from the identity afterwards would race this read.
    assert orphans["benchmark-ghz-chain-4q"] == published["benchmark-ghz-chain-4q"]


def test_a_manifest_that_claims_everything_published_retires_nothing():
    published = _published("a", "b", "c")

    assert orphaned_identities(published, {"a", "b", "c"}) == {}


def test_a_claimed_identity_that_is_not_published_is_not_an_orphan():
    """The asymmetry is the point, and it is load-bearing.

    An identity the manifest claims but which is not published is a record
    mid-import, or one whose attestation refused — both states the import path
    already reports. A symmetric difference here would read a refused attestation
    as something to delete, which is the one direction that destroys work.
    """
    published = _published("a")
    orphans = orphaned_identities(published, {"a", "not-yet-imported", "refused-signature"})

    assert orphans == {}


def test_an_empty_manifest_orphans_the_whole_catalog_rather_than_pretending_otherwise():
    """The dangerous case, stated rather than defended against here.

    If manifest generation breaks and produces nothing, every published record is
    genuinely unclaimed and this returns all of them. That is the honest answer,
    and it is exactly why `_retire_bootstrap` reports by default and requires
    `--authorize N` to match the count exactly: the guard against a bad manifest
    belongs at the point of action, not hidden inside the rule, where it would
    also suppress a legitimate large deletion.
    """
    published = _published("a", "b", "c")

    assert set(orphaned_identities(published, set())) == {"a", "b", "c"}


def test_the_rule_does_not_mutate_what_it_is_given():
    published = _published("a", "b")
    before = dict(published)

    orphaned_identities(published, {"a"})

    assert published == before
