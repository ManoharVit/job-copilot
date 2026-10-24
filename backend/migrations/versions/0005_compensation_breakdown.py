"""Persist explicit annual fixed and variable pay without inferring a split."""
from alembic import op
import sqlalchemy as sa

revision = "0005_compensation_breakdown"
down_revision = "0004_education_records"
branch_labels = None
depends_on = None

_FIELDS = ("current_fixed_ctc", "current_variable_ctc", "expected_fixed_ctc", "expected_variable_ctc")


def upgrade() -> None:
    # Existing totals and every other profile field remain untouched.
    for name in _FIELDS:
        op.add_column("profiles", sa.Column(name, sa.String(), nullable=False, server_default=""))


def downgrade() -> None:
    with op.batch_alter_table("profiles") as batch:
        for name in reversed(_FIELDS):
            batch.drop_column(name)
