"""Baseline: schema as created by the original create_all() call.

Idempotent: on an existing pre-Alembic database the tables already exist and
are left untouched; on a fresh database they are created. Downgrade is a
deliberate no-op so that downgrading to "base" can never drop user data.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-10-03
"""
from alembic import op
import sqlalchemy as sa

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = set(inspector.get_table_names())

    if "profiles" not in existing:
        op.create_table(
            "profiles",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String()),
            sa.Column("email", sa.String()),
            sa.Column("phone", sa.String()),
            sa.Column("location", sa.String()),
            sa.Column("linkedin_url", sa.String()),
            sa.Column("github_url", sa.String()),
            sa.Column("portfolio_url", sa.String()),
            sa.Column("current_title", sa.String()),
            sa.Column("years_experience", sa.Integer()),
            sa.Column("education_level", sa.String()),
            sa.Column("graduation_year", sa.Integer()),
            sa.Column("gpa", sa.String()),
            sa.Column("skills", sa.Text()),
            sa.Column("expected_ctc", sa.String()),
            sa.Column("current_ctc", sa.String()),
            sa.Column("notice_period", sa.String()),
            sa.Column("willing_to_relocate", sa.Boolean()),
            sa.Column("work_authorized", sa.Boolean()),
            sa.Column("gender", sa.String()),
            sa.Column("date_of_birth", sa.String()),
            sa.Column("cover_letter_template", sa.Text()),
            sa.Column("created_at", sa.DateTime()),
            sa.Column("updated_at", sa.DateTime()),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_profiles_id", "profiles", ["id"])

    if "applications" not in existing:
        op.create_table(
            "applications",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("url", sa.String()),
            sa.Column("title", sa.String()),
            sa.Column("company", sa.String()),
            sa.Column("platform", sa.String()),
            sa.Column("status", sa.String()),
            sa.Column("applied_at", sa.DateTime()),
            sa.Column("notes", sa.Text()),
            sa.Column("job_description", sa.Text()),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_applications_id", "applications", ["id"])


def downgrade() -> None:
    # Intentionally a no-op: never drop user tables on downgrade.
    pass
