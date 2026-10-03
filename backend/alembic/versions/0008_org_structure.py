"""The organisation as it really is: presales and sales roles, portfolio sales GM, vertical ownership.

Revision ID: 0008
Revises: 0007
"""
import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

ROLES = [(6, "cco", "CCO"), (7, "sales_gm", "Sales GM"), (8, "sales_director", "Sales Director"),
         (9, "account_manager", "Account Manager")]


def upgrade() -> None:
    op.execute("ALTER TABLE roles DROP CONSTRAINT IF EXISTS ck_roles_role_key")
    for role_id, key, name in ROLES:
        op.execute(f"""
            INSERT INTO roles (id, key, name) SELECT {role_id}, '{key}', '{name}'
            WHERE NOT EXISTS (SELECT 1 FROM roles WHERE key = '{key}')
        """)
    op.execute("UPDATE roles SET name = 'Presales Director' WHERE key = 'portfolio_director'")
    op.execute("UPDATE roles SET name = 'Presales Manager' WHERE key = 'portfolio_manager'")
    op.execute("UPDATE roles SET name = 'Presales Lead' WHERE key = 'presales_account'")
    op.execute("""
        ALTER TABLE roles ADD CONSTRAINT ck_roles_role_key CHECK (key IN
        ('admin','cco','presales_gm','portfolio_director','portfolio_manager','presales_account',
         'sales_gm','sales_director','account_manager'))
    """)
    # A portfolio has a Sales GM beside its presales line; a vertical has a Sales Director.
    op.add_column("teams", sa.Column("sales_gm_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_teams_sales_gm", "teams", "users", ["sales_gm_id"], ["id"], ondelete="SET NULL")
    op.add_column("verticals", sa.Column("sales_director_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_verticals_sales_director", "verticals", "users", ["sales_director_id"], ["id"],
                          ondelete="SET NULL")
    # Account Managers belong to a vertical.
    op.add_column("users", sa.Column("vertical_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_users_vertical", "users", "verticals", ["vertical_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint("fk_users_vertical", "users", type_="foreignkey")
    op.drop_column("users", "vertical_id")
    op.drop_constraint("fk_verticals_sales_director", "verticals", type_="foreignkey")
    op.drop_column("verticals", "sales_director_id")
    op.drop_constraint("fk_teams_sales_gm", "teams", type_="foreignkey")
    op.drop_column("teams", "sales_gm_id")
    op.execute("DELETE FROM roles WHERE key IN ('cco','sales_gm','sales_director','account_manager')")
