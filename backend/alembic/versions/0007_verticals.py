"""Verticals, managed on the Portfolios / Verticals page.

Revision ID: 0007
Revises: 0006
"""
import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "verticals",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False, unique=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    # The verticals in use today; more are added in Administration.
    op.execute("""
        INSERT INTO verticals (id, name, is_active)
        SELECT gen_random_uuid(), v, true
        FROM (VALUES ('Housing & Construction Services'), ('Mega Accounts'), ('Education')) AS t(v)
    """)


def downgrade() -> None:
    op.drop_table("verticals")
