"""Add education_records column to profiles.

Revision ID: 0004_education_records
Revises: 0003_certifications
Create Date: 2026-10-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_education_records"
down_revision = "0003_certifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("profiles") as batch_op:
        batch_op.add_column(
            sa.Column("education_records", sa.Text(), nullable=True, server_default="[]")
        )


def downgrade() -> None:
    with op.batch_alter_table("profiles") as batch_op:
        batch_op.drop_column("education_records")
