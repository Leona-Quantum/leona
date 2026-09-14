"""Fail-closed newsroom authority, independent of tenant-selected identifiers."""

import os
import uuid
from majorana_contracts import Scope
from majorana_contracts.enums import Role


def newsroom_id() -> uuid.UUID:
    if os.getenv("LEONA_NEWS_ENABLED") != "true":
        raise ValueError("newsroom disabled")
    return uuid.UUID(os.environ["LEONA_NEWS_WORKSPACE_ID"])


def public_scope() -> Scope:
    if os.getenv("LEONA_NEWS_PUBLIC") != "true":
        raise ValueError("public news disabled")
    return Scope(user_id=uuid.UUID(int=0), workspace_id=newsroom_id(), role=Role.VIEWER)


def daily_limit() -> int:
    return min(max(int(os.getenv("LEONA_NEWS_DAILY_BATCH_LIMIT", "3")), 1), 20)
