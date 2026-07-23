"""Payments stay off no matter what the environment says."""

from majorana_api.routes import billing as billing_routes


def _routes() -> set[tuple[str, str]]:
    return {
        (route.path, method)
        for route in billing_routes.router.routes
        for method in getattr(route, "methods", set())
    }


def test_billing_status_is_reachable_and_read_only():
    assert _routes() == {("/billing/status", "GET")}


# Deliberately does not look like a real Stripe key: the route only checks
# presence, and a realistic-looking literal would trip the gitleaks gate.
FAKE_SECRET = "not-a-real-secret-just-present"


async def test_payments_are_disabled_even_when_stripe_is_configured(monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", FAKE_SECRET)
    response = await billing_routes.billing_status(scope=object())
    assert response.payments_enabled is False
    assert response.stripe_configured is True


async def test_blank_stripe_key_reads_as_unconfigured(monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "   ")
    response = await billing_routes.billing_status(scope=object())
    assert response.stripe_configured is False


async def test_status_never_echoes_the_secret(monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", FAKE_SECRET)
    response = await billing_routes.billing_status(scope=object())
    assert FAKE_SECRET not in response.model_dump_json()
