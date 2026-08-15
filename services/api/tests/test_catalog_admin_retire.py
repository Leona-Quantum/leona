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


def test_the_orphan_lookup_is_made_with_the_importer_scope_not_the_reviewer_one():
    """The bug this file did not catch the first time.

    `list_public_upstream_identities` resolves its workspace through
    `get_importer_workspace`, which admits ONLY the configured importer user at
    `Role.OWNER`. The first version of `_orphaned_identities` handed it the ADMIN
    reviewer scope it had built for the soft delete, which fails
    `is_importer_scope` and raises `AuthzError` before a single row is read — so
    every `sync-bootstrap` report and every `retire-bootstrap` run would have
    failed outright, in production, on the first call.

    Five green tests of `orphaned_identities` said nothing about it, because the
    rule was right and the call was wrong. This asserts the call: whatever scope
    reaches the lookup must satisfy the same predicate the lookup checks.
    """
    import asyncio
    import uuid as _uuid

    from majorana_api import catalog_admin as admin
    from majorana_api.catalog_authority import CatalogAuthority

    fake = CatalogAuthority(
        enabled=True,
        workspace_id=_uuid.uuid4(),
        importer_user_id=_uuid.uuid4(),
        public_reader_user_id=_uuid.uuid4(),
    )
    seen: dict[str, object] = {}

    class _Manifest:
        def identities(self):
            return ["kept"]

    class _Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

    class _Engine:
        async def dispose(self):
            return None

    async def _lookup(scope, session, *, authority):
        seen["scope"] = scope
        return {"kept": _uuid.uuid4(), "orphan": _uuid.uuid4()}

    originals = (
        admin.CatalogAuthority,
        admin.BootstrapManifestSource,
        admin.engine_from_env,
        admin.session_factory,
        admin.catalog.list_public_upstream_identities,
    )
    admin.CatalogAuthority = type("A", (), {"from_env": staticmethod(lambda: fake)})
    admin.BootstrapManifestSource = _Manifest
    admin.engine_from_env = lambda: _Engine()
    admin.session_factory = lambda engine: lambda: _Session()
    admin.catalog.list_public_upstream_identities = _lookup
    try:
        orphans, total = asyncio.run(admin._orphaned_identities(_uuid.uuid4()))
    finally:
        (
            admin.CatalogAuthority,
            admin.BootstrapManifestSource,
            admin.engine_from_env,
            admin.session_factory,
            admin.catalog.list_public_upstream_identities,
        ) = originals

    assert set(orphans) == {"orphan"}
    assert total == 2
    # The assertion that matters: the exact predicate `get_importer_workspace`
    # applies. A reviewer scope fails this, which is the bug.
    assert fake.is_importer_scope(seen["scope"]), (
        "the orphan lookup was handed a scope get_importer_workspace will reject"
    )
