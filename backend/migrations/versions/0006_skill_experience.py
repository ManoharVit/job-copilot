"""Persist explicitly confirmed years of experience per skill."""
from alembic import op
import sqlalchemy as sa

revision = "0006_skill_experience"
down_revision = "0005_compensation_breakdown"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("profiles", sa.Column("skill_experience", sa.Text(), nullable=False, server_default="{}"))


def downgrade() -> None:
    with op.batch_alter_table("profiles") as batch:
        batch.drop_column("skill_experience")
