import pytest
from repo_test_helpers import RecordingSession, make_scope


@pytest.fixture
def session():
    return RecordingSession()


@pytest.fixture
def scope():
    return make_scope()
