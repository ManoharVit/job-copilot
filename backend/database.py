from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker, declarative_base

from settings import DEFAULT_SQLITE_PATH, get_settings

DATABASE_URL = get_settings().database_url
_IS_SQLITE = DATABASE_URL.startswith("sqlite")

if _IS_SQLITE and DATABASE_URL == f"sqlite:///{DEFAULT_SQLITE_PATH}":
    # Preserve previous behaviour: make sure the default data directory exists.
    DEFAULT_SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)


def enable_sqlite_foreign_keys(target_engine: Engine) -> None:
    """SQLite ignores FOREIGN KEY / ON DELETE CASCADE unless enabled per connection."""

    @event.listens_for(target_engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, _connection_record):  # pragma: no cover - trivial
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


engine = create_engine(
    DATABASE_URL, connect_args={"check_same_thread": False} if _IS_SQLITE else {}
)
if _IS_SQLITE:
    enable_sqlite_foreign_keys(engine)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
