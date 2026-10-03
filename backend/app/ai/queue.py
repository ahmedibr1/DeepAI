"""PostgreSQL job queue. Enqueue happens in the same transaction as the status change, so a queued
analysis and a visible "AI Analysis" status can never disagree. Claiming uses SKIP LOCKED, so several
workers can run without a broker."""
from __future__ import annotations

import socket
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import AiJob

WORKER_ID = f"{socket.gethostname()}:{uuid.uuid4().hex[:8]}"

CLAIM_SQL = text("""
    UPDATE ai_jobs SET status = 'running', attempts = attempts + 1, started_at = now(), worker_id = :worker
    WHERE id = (
        SELECT id FROM ai_jobs
        WHERE status = 'queued' AND run_after <= now()
        ORDER BY run_after
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    )
    RETURNING id
""")


def enqueue(db: Session, kind: str, *, run_id=None, opportunity_id=None, version_id=None, payload=None) -> AiJob:
    job = AiJob(kind=kind, run_id=run_id, opportunity_id=opportunity_id, version_id=version_id, payload=payload)
    db.add(job)
    db.flush()
    return job


def claim(db: Session) -> AiJob | None:
    row = db.execute(CLAIM_SQL, {"worker": WORKER_ID}).first()
    db.commit()
    return db.get(AiJob, row[0]) if row else None


def finish(db: Session, job: AiJob, error: str | None = None) -> None:
    job.finished_at = datetime.now(UTC)
    if error is None:
        job.status = "succeeded"
    elif job.attempts >= job.max_attempts:
        job.status, job.last_error = "failed", error[:2000]
    else:
        job.status, job.last_error = "queued", error[:2000]
        job.run_after = datetime.now(UTC) + timedelta(seconds=30 * job.attempts)
    db.commit()
