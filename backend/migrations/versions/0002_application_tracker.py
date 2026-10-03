"""Application Tracker: users, ownership, canonical statuses, status history.

Upgrade:
  * create ``users`` and a bootstrap local user (local single-user mode);
  * add ``applications.owner_id`` (FK, NOT NULL) and ``applications.updated_at``;
  * map legacy statuses: applied->submitted, interview->interviewing,
    offer->offer, rejected->rejected; anything else (or empty) -> submitted,
    with the original value preserved in the history note;
  * enforce valid statuses with a CHECK constraint; add owner-scoped indexes;
  * create ``application_status_history`` seeded with one row per application.

Downgrade reverses the schema. Status mapping back to the legacy vocabulary is
LOSSY (draft/submitted/under_review/screening->applied,
withdrawn/archived->rejected). Restore the pre-migration backup copy for an
exact rollback.

Revision ID: 0002_application_tracker
Revises: 0001_baseline
Create Date: 2026-10-03
"""
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

revision = "0002_application_tracker"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None

LOCAL_USER_EMAIL = "local-user@localhost"
CANONICAL = (
    "draft", "submitted", "under_review", "screening", "interviewing",
    "offer", "rejected", "withdrawn", "archived",
)
STATUS_CHECK = "status IN ({})".format(", ".join(f"'{s}'" for s in CANONICAL))
LEGACY_TO_CANONICAL = {"applied": "submitted", "interview": "interviewing", "offer": "offer", "rejected": "rejected"}


def upgrade() -> None:
    bind = op.get_bind()
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    users = op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("display_name", sa.String(200), nullable=False, server_default=""),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.bulk_insert(
        users,
        [{"email": LOCAL_USER_EMAIL, "display_name": "Local user", "is_active": True, "created_at": now}],
    )
    local_user_id = bind.execute(
        sa.text("SELECT id FROM users WHERE email = :e"), {"e": LOCAL_USER_EMAIL}
    ).scalar_one()

    with op.batch_alter_table("applications") as batch:
        batch.add_column(sa.Column("owner_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("updated_at", sa.DateTime(), nullable=True))

    # Capture original statuses before mapping, for history notes.
    original = {
        row.id: row.status
        for row in bind.execute(sa.text("SELECT id, status FROM applications"))
    }

    bind.execute(
        sa.text("UPDATE applications SET owner_id = :uid, updated_at = COALESCE(applied_at, :now)"),
        {"uid": local_user_id, "now": now},
    )
    bind.execute(sa.text("UPDATE applications SET applied_at = :now WHERE applied_at IS NULL"), {"now": now})
    for legacy, canonical in LEGACY_TO_CANONICAL.items():
        bind.execute(
            sa.text("UPDATE applications SET status = :c WHERE lower(trim(status)) = :l"),
            {"c": canonical, "l": legacy},
        )
    bind.execute(
        sa.text(
            "UPDATE applications SET status = 'submitted' "
            f"WHERE status IS NULL OR status NOT IN ({', '.join(repr(s) for s in CANONICAL)})"
        )
    )

    with op.batch_alter_table("applications") as batch:
        batch.alter_column("owner_id", existing_type=sa.Integer(), nullable=False)
        batch.alter_column("status", existing_type=sa.String(), nullable=False)
        batch.create_foreign_key(
            "fk_applications_owner_id_users", "users", ["owner_id"], ["id"], ondelete="CASCADE"
        )
        batch.create_check_constraint("ck_applications_status_valid", STATUS_CHECK)
        batch.create_index("ix_applications_owner_status", ["owner_id", "status"])
        batch.create_index("ix_applications_owner_applied_at", ["owner_id", "applied_at"])

    history = op.create_table(
        "application_status_history",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("application_id", sa.Integer(), nullable=False),
        sa.Column("from_status", sa.String(32), nullable=True),
        sa.Column("to_status", sa.String(32), nullable=False),
        sa.Column("changed_at", sa.DateTime(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("source", sa.String(32), nullable=False, server_default="api"),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["application_id"], ["applications.id"],
            name="fk_status_history_application_id", ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_application_status_history_application_id", "application_status_history", ["application_id"]
    )

    rows = bind.execute(sa.text("SELECT id, status, applied_at FROM applications ORDER BY id")).all()
    seed = []
    for row in rows:
        before = original.get(row.id)
        raw = "" if before is None else str(before).strip().lower()
        note = "Imported from legacy tracker"
        if raw != row.status and LEGACY_TO_CANONICAL.get(raw) != row.status:
            note += f" (original status '{str(before or '')[:40]}' mapped to '{row.status}')"
        
        applied_at = row.applied_at
        if isinstance(applied_at, str):
            try:
                # Try to parse ISO 8601 string from SQLite
                applied_at = datetime.fromisoformat(applied_at)
            except ValueError:
                applied_at = now
        changed_at = applied_at or now

        seed.append(
            {
                "application_id": row.id,
                "from_status": None,
                "to_status": row.status,
                "changed_at": changed_at,
                "note": note,
                "source": "migration",
            }
        )
    if seed:
        op.bulk_insert(history, seed)


def downgrade() -> None:
    op.drop_index("ix_application_status_history_application_id", table_name="application_status_history")
    op.drop_table("application_status_history")

    with op.batch_alter_table("applications") as batch:
        batch.drop_index("ix_applications_owner_applied_at")
        batch.drop_index("ix_applications_owner_status")
        batch.drop_constraint("ck_applications_status_valid", type_="check")
        batch.drop_constraint("fk_applications_owner_id_users", type_="foreignkey")
        batch.alter_column("status", existing_type=sa.String(), nullable=True)
        batch.drop_column("updated_at")
        batch.drop_column("owner_id")

    bind = op.get_bind()
    bind.execute(
        sa.text(
            "UPDATE applications SET status = CASE "
            "WHEN status IN ('draft','submitted','under_review','screening') THEN 'applied' "
            "WHEN status = 'interviewing' THEN 'interview' "
            "WHEN status IN ('withdrawn','archived') THEN 'rejected' "
            "ELSE status END"
        )
    )

    op.drop_table("users")
