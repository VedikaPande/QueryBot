"""Shared pytest fixtures."""
import pytest

from app import create_app
from app.extensions import db as _db, hash_password
from app.models.dataset_model import Dataset
from app.models.user_model import User


@pytest.fixture()
def app():
    """A Flask app backed by an in-memory database."""
    application = create_app('testing')

    with application.app_context():
        _db.create_all()
        yield application
        _db.session.remove()
        _db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def db(app):
    return _db


def _create_user(email: str) -> User:
    user = User(
        fullname='Test User',
        email=email,
        password_hash=hash_password('CorrectHorse1!'),
    )
    user.save()
    return user


@pytest.fixture()
def user(app):
    return _create_user('owner@example.com')


@pytest.fixture()
def other_user(app):
    return _create_user('stranger@example.com')


@pytest.fixture()
def dataset(app, user):
    """A dataset owned by `user`."""
    import uuid as uuid_module

    record = Dataset(
        external_uuid=uuid_module.uuid4(),
        user_id=user.id,
        file_name='sales.csv',
        size_bytes=1024,
        table_count=1,
        row_count=100,
    )
    record.save()
    return record


@pytest.fixture()
def stub_agent(monkeypatch):
    """
    Replace the agent stream with a canned response.

    Without this the tests dial a LangGraph server that is not running, and each
    call blocks until the connection times out.
    """
    from app.services import langgraph_service

    calls: list[dict] = []

    def _fake_stream(question, dataset_uuid, history=None, previous=None):
        # Recorded so tests can assert what context the route handed the agent.
        calls.append(
            {
                'question': question,
                'dataset_uuid': dataset_uuid,
                'history': history,
                'previous': previous,
            }
        )
        result = {'answer': f'Stubbed answer for: {question}'}
        yield 'data: {"format_results": {"answer": "Stubbed answer"}}\n\n', result

    _fake_stream.calls = calls  # type: ignore[attr-defined]
    monkeypatch.setattr(langgraph_service, 'stream_run', _fake_stream)
    return _fake_stream


@pytest.fixture()
def sign_in(client):
    """Log a user in, leaving the JWT cookies on the test client."""

    def _sign_in(email: str) -> None:
        response = client.post(
            '/api/auth/login',
            json={'email': email, 'password': 'CorrectHorse1!'},
        )
        assert response.status_code == 200, response.get_json()

    return _sign_in
