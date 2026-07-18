import pytest

from majorana_api.db import _validate_application_url


def test_production_neon_application_url_must_be_pooled(monkeypatch):
    monkeypatch.setenv("MAJORANA_ENV", "production")
    monkeypatch.delenv("CI", raising=False)
    with pytest.raises(RuntimeError, match="pooled endpoint"):
        _validate_application_url(
            "postgresql://app:secret@ep-example.us-east-2.aws.neon.tech/neondb"
        )


def test_production_neon_pooler_is_accepted(monkeypatch):
    monkeypatch.setenv("MAJORANA_ENV", "production")
    monkeypatch.delenv("CI", raising=False)
    _validate_application_url(
        "postgresql://app:secret@ep-example-pooler.us-east-2.aws.neon.tech/neondb"
    )


def test_ci_neon_application_url_must_still_be_pooled(monkeypatch):
    """CI is production-like application traffic, not a pooling bypass."""
    monkeypatch.setenv("MAJORANA_ENV", "production")
    monkeypatch.setenv("CI", "true")
    with pytest.raises(RuntimeError, match="pooled endpoint"):
        _validate_application_url(
            "postgresql://app:secret@ep-example.us-east-2.aws.neon.tech/neondb"
        )
