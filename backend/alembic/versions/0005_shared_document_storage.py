"""Let two opportunity versions reference the same stored file.

A new version starts with the documents of the one it was copied from. Those rows are copies that point
at the same bytes, so the storage key can no longer be unique across rows.

Revision ID: 0005
Revises: 0004
"""
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("uq_opportunity_documents_storage_key", "opportunity_documents", type_="unique")
    op.create_index("ix_opportunity_documents_storage_key", "opportunity_documents", ["storage_key"])


def downgrade() -> None:
    op.execute("""
        DELETE FROM opportunity_documents a USING opportunity_documents b
        WHERE a.storage_key = b.storage_key AND a.ctid > b.ctid
    """)
    op.drop_index("ix_opportunity_documents_storage_key", table_name="opportunity_documents")
    op.create_unique_constraint("uq_opportunity_documents_storage_key", "opportunity_documents", ["storage_key"])
