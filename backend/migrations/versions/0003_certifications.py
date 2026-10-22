"""Add certifications column to profiles.

Revision ID: 0003_certifications
Revises: 0002_application_tracker
Create Date: 2026-10-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_certifications"
down_revision = "0002_application_tracker"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("profiles") as batch_op:
        batch_op.add_column(
            sa.Column("certifications", sa.Text(), nullable=True, server_default="[]")
        )


def downgrade() -> None:
    with op.batch_alter_table("profiles") as batch_op:
        batch_op.drop_column("certifications")
