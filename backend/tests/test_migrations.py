"""Migrations run against synthetic legacy databases (never the real one)."""
import sqlite3

import pytest

from schema_guard import SchemaNotCurrent, assert_schema_current, database_state

from .conftest import downgrade, make_engine, migrate

LEGACY_DDL = """
CREATE TABLE applications (
    id INTEGER NOT NULL, url VARCHAR, title VARCHAR, company VARCHAR, platform VARCHAR,
    status VARCHAR, applied_at DATETIME, notes TEXT, job_description TEXT, PRIMARY KEY (id));
CREATE TABLE profiles (
    id INTEGER NOT NULL, name VARCHAR, email VARCHAR, phone VARCHAR, location VARCHAR,
    linkedin_url VARCHAR, github_url VARCHAR, portfolio_url VARCHAR, current_title VARCHAR,
    years_experience INTEGER, education_level VARCHAR, graduation_year INTEGER, gpa VARCHAR,
    skills TEXT, expected_ctc VARCHAR, current_ctc VARCHAR, notice_period VARCHAR,
    willing_to_relocate BOOLEAN, work_authorized BOOLEAN, gender VARCHAR, date_of_birth VARCHAR,
    cover_letter_template TEXT, created_at DATETIME, updated_at DATETIME, PRIMARY KEY (id));
CREATE INDEX ix_applications_id ON applications (id);
CREATE INDEX ix_profiles_id ON profiles (id);
"""

SYNTHETIC_ROWS = [
    (1, "applied"), (2, "interview"), (3, "offer"), (4, "rejected"), (5, "ghosted"), (6, None), (7, "Applied"),
]


@pytest.fixture()
def legacy_db(tmp_path):
    path = tmp_path / "legacy.db"
    con = sqlite3.connect(path)
    con.executescript(LEGACY_DDL)
    con.executemany(
        "INSERT INTO applications (id, url, title, company, platform, status, applied_at, notes, job_description) "
        "VALUES (?, 'https://jobs.example.test/' || ?, 'Synthetic role', 'Synthetic Co', 'other', ?, "
        "'2026-09-01 10:00:00', '', '')",
        [(i, i, s) for i, s in SYNTHETIC_ROWS],
    )
    con.execute("INSERT INTO profiles (id, name) VALUES (1, 'Synthetic Person')")
    con.commit()
    con.close()
    return path


def q(path, sql):
    con = sqlite3.connect(path)
    try:
        return con.execute(sql).fetchall()
    finally:
        con.close()


def test_upgrade_maps_statuses_assigns_owner_and_seeds_history(legacy_db):
    migrate(f"sqlite:///{legacy_db}")
    statuses = dict(q(legacy_db, "SELECT id, status FROM applications"))
    assert statuses == {1: "submitted", 2: "interviewing", 3: "offer", 4: "rejected",
                        5: "submitted", 6: "submitted", 7: "submitted"}
    [(user_id, email)] = q(legacy_db, "SELECT id, email FROM users")
    assert email == "local-user@localhost"
    assert q(legacy_db, "SELECT DISTINCT owner_id FROM applications") == [(user_id,)]
    history = {row[0]: row[1:] for row in q(legacy_db,
               "SELECT application_id, from_status, to_status, source, note FROM application_status_history")}
    assert len(history) == 7 and all(h[2] == "migration" and h[0] is None for h in history.values())
    assert "original status 'ghosted'" in history[5][3]
    assert "original status ''" in history[6][3]
    assert "original status" not in history[1][3]
    assert q(legacy_db, "SELECT name FROM profiles") == [("Synthetic Person",)]


def test_check_constraint_rejects_invalid_status_after_upgrade(legacy_db):
    migrate(f"sqlite:///{legacy_db}")
    con = sqlite3.connect(legacy_db)
    with pytest.raises(sqlite3.IntegrityError):
        con.execute("UPDATE applications SET status = 'ghosted' WHERE id = 1")
    con.close()


def test_downgrade_restores_legacy_schema_and_vocabulary(legacy_db):
    url = f"sqlite:///{legacy_db}"
    migrate(url)
    con = sqlite3.connect(legacy_db)
    con.execute("UPDATE applications SET status = 'withdrawn' WHERE id = 3")
    con.commit()
    con.close()
    downgrade(url, "0001_baseline")
    columns = {row[1] for row in q(legacy_db, "PRAGMA table_info(applications)")}
    assert "owner_id" not in columns and "updated_at" not in columns
    tables = {row[0] for row in q(legacy_db, "SELECT name FROM sqlite_master WHERE type='table'")}
    assert "users" not in tables and "application_status_history" not in tables
    assert dict(q(legacy_db, "SELECT id, status FROM applications"))[3] == "rejected"
    assert q(legacy_db, "SELECT count(*) FROM applications") == [(7,)]


def test_fresh_database_upgrade_creates_all_tables(tmp_path):
    path = tmp_path / "fresh.db"
    migrate(f"sqlite:///{path}")
    tables = {row[0] for row in q(path, "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"profiles", "applications", "users", "application_status_history", "alembic_version"} <= tables


def test_schema_guard_states(tmp_path, legacy_db):
    empty = make_engine(tmp_path / "empty.db")
    assert database_state(empty) == "empty"

    outdated = make_engine(legacy_db)
    assert database_state(outdated) == "outdated"
    with pytest.raises(SchemaNotCurrent):
        assert_schema_current(outdated)

    migrate(f"sqlite:///{legacy_db}")
    assert database_state(outdated) == "current"
    assert_schema_current(outdated)
    empty.dispose()
    outdated.dispose()
