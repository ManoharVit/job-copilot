"""Database schema guard.

* ``assert_schema_current(engine)`` is called at app startup and refuses to
  serve requests against a database that is not at the latest migration.
* Run as a script (``python schema_guard.py`` from ``backend/``, used by
  ``start.sh``):
    - empty database (no tables)   -> create schema with ``alembic upgrade head``
    - already at head               -> exit 0
    - existing but outdated database -> print copy-first migration steps, exit 3
  It never migrates a database that already contains data.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Literal

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import inspect
from sqlalchemy.engine import Engine

ALEMBIC_INI = Path(__file__).resolve().with_name("alembic.ini")

DatabaseState = Literal["empty", "current", "outdated"]


class SchemaNotCurrent(RuntimeError):
    pass


def alembic_config(database_url: str | None = None) -> Config:
    config = Config(str(ALEMBIC_INI))
    config.set_main_option("script_location", str(ALEMBIC_INI.parent / "migrations"))
    if database_url:
        config.set_main_option("sqlalchemy.url", database_url)
    return config


def head_revision() -> str:
    head = ScriptDirectory.from_config(alembic_config()).get_current_head()
    assert head is not None, "no migrations found"
    return head


def current_revision(engine: Engine) -> str | None:
    with engine.connect() as connection:
        return MigrationContext.configure(connection).get_current_revision()


def database_state(engine: Engine) -> DatabaseState:
    tables = set(inspect(engine).get_table_names())
    if not tables:
        return "empty"
    if current_revision(engine) == head_revision():
        return "current"
    return "outdated"


def assert_schema_current(engine: Engine) -> None:
    current, head = current_revision(engine), head_revision()
    if current != head:
        raise SchemaNotCurrent(
            f"Database schema is at revision {current!r} but the code expects {head!r}. "
            "Back up and migrate first: ./scripts/migrate_local_db.sh --confirm"
        )


def main() -> int:
    from database import DATABASE_URL, engine

    state = database_state(engine)
    if state == "current":
        return 0
    if state == "empty":
        print("Empty database detected; creating schema (alembic upgrade head)...")
        command.upgrade(alembic_config(DATABASE_URL), "head")
        return 0
    print(
        "ERROR: Your database exists but uses an older schema.\n"
        "Nothing was changed. To migrate safely (a backup copy is made first), run from the project root:\n"
        "    ./scripts/migrate_local_db.sh --confirm\n",
        file=sys.stderr,
    )
    return 3


if __name__ == "__main__":
    sys.exit(main())
