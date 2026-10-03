"""AI worker: claims jobs from PostgreSQL and runs them. Deployed as its own pod so a long analysis
never blocks the API.

    python -m app.worker            # run until stopped
    python -m app.worker --once     # drain the queue and exit (used by tests)
"""
from __future__ import annotations

import logging
import signal
import sys
import time

from app.ai import analysis, queue
from app.ai.providers import build_providers
from app.db import SessionLocal

log = logging.getLogger("portal.worker")
_running = True


def _stop(*_args) -> None:
    global _running
    _running = False
    log.info("shutting down after the current job")


def process(job, embeddings, llm) -> None:
    with SessionLocal() as db:
        if job.kind == "analyze":
            analysis.run_analysis(db, job.run_id, embeddings, llm)
        elif job.kind == "ingest":
            from app.ai import ingest
            from app.models import OpportunityVersion

            version = db.get(OpportunityVersion, job.version_id)
            ingest.ingest_version(db, version, embeddings)
            db.commit()
        else:
            raise ValueError(f"Unknown job kind '{job.kind}'.")


def main(once: bool = False, idle_seconds: float = 2.0) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    embeddings, llm = build_providers()
    if llm is None:
        log.warning("PORTAL_LLM_BASE_URL is not set: analysis jobs will fail until the model endpoint is configured")
    log.info("worker %s started (embeddings=%s, llm=%s)", queue.WORKER_ID, embeddings.name, getattr(llm, "name", None))
    while _running:
        with SessionLocal() as db:
            job = queue.claim(db)
        if job is None:
            if once:
                return 0
            time.sleep(idle_seconds)
            continue
        log.info("job %s (%s) started", job.id, job.kind)
        error = None
        try:
            process(job, embeddings, llm)
        except Exception as exc:                      # the run itself records its own failure detail
            error = f"{exc.__class__.__name__}: {exc}"
            log.exception("job %s failed", job.id)
        with SessionLocal() as db:
            finished = db.get(type(job), job.id)
            queue.finish(db, finished, error)
        log.info("job %s %s", job.id, "failed" if error else "done")
    return 0


if __name__ == "__main__":
    sys.exit(main(once="--once" in sys.argv))
