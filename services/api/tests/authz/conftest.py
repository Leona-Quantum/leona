import asyncio

import pytest
from matrix_helpers import provision

from majorana_api.db import engine_from_env, session_factory


@pytest.fixture(scope="session")
def dataset():
    return asyncio.run(provision())


@pytest.fixture
async def db():
    engine = engine_from_env()
    async with session_factory(engine)() as session:
        yield session
        await session.rollback()  # in-scope write tests leave no residue
    await engine.dispose()
