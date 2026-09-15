import pytest
from repo_test_helpers import RecordingSession, make_scope

from majorana_api.routes import catalog as catalog_routes


@pytest.fixture(autouse=True)
def _catalog_list_page_cache_off(monkeypatch):
    """Serve `GET /catalog/entries` straight from the repository in tests.

    The production route holds pages in process memory for
    `CATALOG_LIST_PAGE_CACHE_TTL_SECONDS` (routes/catalog.py). Tests such as
    test_catalog_public_read_live.py write catalog rows and read the listing back
    inside one process and one test, so a shared cache would hand them the page
    from before the write. A zero-ttl cache stores nothing that is ever fresh.
    test_catalog_list_page_cache.py installs the real one for itself.
    """
    monkeypatch.setattr(
        catalog_routes,
        "_LIST_PAGE_CACHE",
        catalog_routes._PageCache(0.0, catalog_routes.CATALOG_LIST_PAGE_CACHE_MAX_ENTRIES),
    )


@pytest.fixture
def session():
    return RecordingSession()


@pytest.fixture
def scope():
    return make_scope()
