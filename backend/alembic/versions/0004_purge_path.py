"""Allow a deliberate opportunity purge through the immutability triggers.

Deleting an opportunity removes its versions, documents and AI runs. The governance triggers exist to stop
records being altered, not to make an authorised deletion impossible, so they now let a DELETE through when
the caller has set the local flag `portal.purge`. Only `app.services.opportunities.delete_opportunity`
sets it, inside the transaction that also writes the audit entry.

Revision ID: 0004
Revises: 0003
"""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

PURGE_CHECK = "coalesce(current_setting('portal.purge', true), '') = 'on'"


def upgrade() -> None:
    # Audit entries outlive the records they describe: dropping this foreign key keeps the log append-only
    # (a cascade would have to UPDATE audit rows, which the append-only trigger rightly refuses).
    op.execute("ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS fk_audit_logs_opportunity_id_opportunities")
    op.execute(f"""
        CREATE OR REPLACE FUNCTION portal_freeze_ai_run() RETURNS trigger AS $$
        BEGIN
          IF TG_OP = 'DELETE' AND {PURGE_CHECK} THEN RETURN OLD; END IF;
          IF OLD.status IN ('succeeded', 'failed', 'cancelled') THEN
            RAISE EXCEPTION 'AI analysis run % is finished and immutable', OLD.id USING ERRCODE = 'insufficient_privilege';
          END IF;
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql;
    """)
    op.execute(f"""
        CREATE OR REPLACE FUNCTION portal_freeze_ai_children() RETURNS trigger AS $$
        DECLARE run_status text;
        BEGIN
          IF TG_OP = 'DELETE' AND {PURGE_CHECK} THEN RETURN OLD; END IF;
          SELECT status INTO run_status FROM ai_analysis_runs WHERE id = COALESCE(NEW.run_id, OLD.run_id);
          IF run_status IN ('succeeded', 'failed', 'cancelled') THEN
            RAISE EXCEPTION 'Results of finished AI run are immutable' USING ERRCODE = 'insufficient_privilege';
          END IF;
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql;
    """)
    op.execute(f"""
        CREATE OR REPLACE FUNCTION portal_freeze_locked_deepdive() RETURNS trigger AS $$
        BEGIN
          IF TG_OP = 'DELETE' AND {PURGE_CHECK} THEN RETURN OLD; END IF;
          IF EXISTS (SELECT 1 FROM opportunity_versions v WHERE v.id = OLD.version_id AND v.is_locked) THEN
            RAISE EXCEPTION 'DeepDive of a locked version cannot change' USING ERRCODE = 'insufficient_privilege';
          END IF;
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql;
    """)


def downgrade() -> None:
    op.execute("DELETE FROM audit_logs WHERE opportunity_id IS NOT NULL "
               "AND opportunity_id NOT IN (SELECT id FROM opportunities)")
    op.execute("ALTER TABLE audit_logs ADD CONSTRAINT fk_audit_logs_opportunity_id_opportunities "
               "FOREIGN KEY (opportunity_id) REFERENCES opportunities (id) ON DELETE SET NULL")
    op.execute("""
        CREATE OR REPLACE FUNCTION portal_freeze_ai_run() RETURNS trigger AS $$
        BEGIN
          IF OLD.status IN ('succeeded', 'failed', 'cancelled') THEN
            RAISE EXCEPTION 'AI analysis run % is finished and immutable', OLD.id USING ERRCODE = 'insufficient_privilege';
          END IF;
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION portal_freeze_ai_children() RETURNS trigger AS $$
        DECLARE run_status text;
        BEGIN
          SELECT status INTO run_status FROM ai_analysis_runs WHERE id = COALESCE(NEW.run_id, OLD.run_id);
          IF run_status IN ('succeeded', 'failed', 'cancelled') THEN
            RAISE EXCEPTION 'Results of finished AI run are immutable' USING ERRCODE = 'insufficient_privilege';
          END IF;
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION portal_freeze_locked_deepdive() RETURNS trigger AS $$
        BEGIN
          IF EXISTS (SELECT 1 FROM opportunity_versions v WHERE v.id = OLD.version_id AND v.is_locked) THEN
            RAISE EXCEPTION 'DeepDive of a locked version cannot change' USING ERRCODE = 'insufficient_privilege';
          END IF;
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql;
    """)
