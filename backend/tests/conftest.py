"""Test isolation for Job Copilot.

Guarantees:
* never reads the real Gemini key (AI features are disabled for tests);
* never opens the real ``data/copilot.db`` (DATABASE_URL points at a temp dir,
  and a session-level guard fails the run if the real file's hash changes);
* every test gets a fresh SQLite file copied from a template that was built by
  running the real Alembic migrations.
"""
from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
from pathlib import Path

# --- isolation: must run before any app module is imported ------------------
os.environ["GEMINI_API_KEY"] = ""  # ai_writer uses setdefault, so .env cannot override this
_SESSION_DIR = Path(tempfile.mkdtemp(prefix="jobcopilot-tests-"))
os.environ["DATABASE_URL"] = f"sqlite:///{_SESSION_DIR / 'import-time.db'}"

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import settings  # noqa: E402

settings.get_settings.cache_clear()

from database import enable_sqlite_foreign_keys, get_db  # noqa: E402
from identity import LOCAL_USER_EMAIL, CurrentUser, get_current_user  # noqa: E402
from models import User  # noqa: E402
from schema_guard import alembic_config  # noqa: E402

REAL_DB = settings.DEFAULT_SQLITE_PATH


def _sha256(path: Path) -> str | None:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


@pytest.fixture(scope="session", autouse=True)
def real_database_untouched():
    before = _sha256(REAL_DB)
    yield
    assert _sha256(REAL_DB) == before, "tests modified the real data/copilot.db"
    shutil.rmtree(_SESSION_DIR, ignore_errors=True)


def migrate(url: str, revision: str = "head") -> None:
    config = alembic_config(url)
    config.attributes["configure_logging"] = False
    command.upgrade(config, revision)


def downgrade(url: str, revision: str) -> None:
    config = alembic_config(url)
    config.attributes["configure_logging"] = False
    command.downgrade(config, revision)


@pytest.fixture(scope="session")
def template_db() -> Path:
    path = _SESSION_DIR / "template.db"
    migrate(f"sqlite:///{path}")
    return path


def make_engine(path: Path):
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    enable_sqlite_foreign_keys(engine)
    return engine


@pytest.fixture()
def engine(template_db: Path, tmp_path: Path):
    path = tmp_path / "test.db"
    shutil.copy(template_db, path)
    eng = make_engine(path)
    yield eng
    eng.dispose()


@pytest.fixture()
def session_factory(engine):
    return sessionmaker(bind=engine, autocommit=False, autoflush=False)


@pytest.fixture()
def db(session_factory):
    session = session_factory()
    yield session
    session.close()


@pytest.fixture()
def users(db) -> dict[str, CurrentUser]:
    local = db.scalar(select(User).where(User.email == LOCAL_USER_EMAIL))
    other = User(email="other-user@example.test", display_name="Other")
    db.add(other)
    db.commit()
    return {"alice": CurrentUser(local.id, local.email), "bob": CurrentUser(other.id, other.email)}


class ActingAs:
    """Mutable holder so a test can switch the current user mid-test."""

    def __init__(self, user: CurrentUser) -> None:
        self.user = user


@pytest.fixture()
def acting_as(users) -> ActingAs:
    return ActingAs(users["alice"])


@pytest.fixture()
def client(session_factory, acting_as):
    from fastapi.testclient import TestClient

    import server

    def _get_db():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    server.app.dependency_overrides[get_db] = _get_db
    server.app.dependency_overrides[get_current_user] = lambda: acting_as.user
    # Not used as a context manager: the startup schema guard targets the
    # import-time engine and is tested separately in test_migrations.py.
    test_client = TestClient(server.app, raise_server_exceptions=False)
    yield test_client
    server.app.dependency_overrides.clear()
