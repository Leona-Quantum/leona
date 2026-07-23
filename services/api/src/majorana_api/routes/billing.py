"""Billing transparency surface — deliberately payment-free.

The owner's direction (2026-07-23): users can see exactly how billing will
work, but no card, checkout, or payment option is exposed. `payments_enabled`
is therefore hard False in this slice — it is not an env flag, because no
deployment should be able to switch user-facing payments on before the credit
ledger, price table, and refund policy exist (OWNER_TODO §1).

`stripe_configured` reports only whether a backend secret is present, so the
demo can honestly show the state of the billing backend without touching it.
"""

import os

from fastapi import APIRouter
from pydantic import BaseModel

from ..auth.deps import CurrentScope

router = APIRouter()

STRIPE_SECRET_ENV = "STRIPE_SECRET_KEY"


class BillingStatusResponse(BaseModel):
    payments_enabled: bool
    stripe_configured: bool
    currency: str


@router.get("/billing/status", response_model=BillingStatusResponse)
async def billing_status(scope: CurrentScope) -> BillingStatusResponse:
    return BillingStatusResponse(
        payments_enabled=False,
        stripe_configured=bool(os.environ.get(STRIPE_SECRET_ENV, "").strip()),
        currency="USD",
    )
