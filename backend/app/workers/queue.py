"""PostgreSQL-backed persistent job queue: leases, retries, deduplication, crash recovery."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.logging import get_logger
from app.models import Document, ProcessingJob

logger = get_logger("trovia.queue")

ACTIVE_STATUSES = ("queued", "running", "retrying")
TERMINAL_STATUSES = ("completed", "failed", "cancelled")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def active_job(session: Session, document_id: uuid.UUID, job_type: str = "process_document"):
    return session.scalar(
        select(ProcessingJob).where(
            ProcessingJob.document_id == document_id,
            ProcessingJob.job_type == job_type,
            ProcessingJob.status.in_(ACTIVE_STATUSES),
        )
    )


def enqueue(
    session: Session,
    document: Document,
    job_type: str = "process_document",
    *,
    max_attempts: int | None = None,
) -> tuple[ProcessingJob, bool]:
    """Enqueue; reuse an active job for the same document (idempotent), returning (job, created)."""
    settings = get_settings()
    existing = active_job(session, document.id, job_type)
    if existing is not None:
        return existing, False
    job = ProcessingJob(
        document_id=document.id,
        user_id=document.user_id,
        job_type=job_type,
        status="queued",
        max_attempts=max_attempts or settings.job_max_attempts,
        available_at=_now(),
    )
    session.add(job)
    try:
        session.flush()
    except IntegrityError:
        # Another transaction already enqueued it concurrently: roll back and reuse that job
        session.rollback()
        existing = active_job(session, document.id, job_type)
        if existing is not None:
            return existing, False
        raise
    return job, True


def claim_job(session: Session, worker_id: str, *, lease_seconds: int | None = None) -> ProcessingJob | None:
    """Take one runnable job (FOR UPDATE SKIP LOCKED) and give it a lease."""
    now = _now()
    candidate = (
        select(ProcessingJob)
        .where(
            ProcessingJob.status.in_(("queued", "retrying")),
            ProcessingJob.available_at <= now,
        )
        .order_by(ProcessingJob.created_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    job = session.scalar(candidate)
    if job is None:
        return None
    job.status = "running"
    job.locked_at = now
    job.locked_by = worker_id
    job.attempt_count += 1
    job.updated_at = now
    session.flush()
    return job


def complete_job(session: Session, job: ProcessingJob) -> None:
    now = _now()
    job.status = "completed"
    job.completed_at = now
    job.locked_at = None
    job.locked_by = None
    job.last_error_code = None
    job.last_error_message = None
    job.updated_at = now
    session.flush()


def fail_job(
    session: Session,
    job: ProcessingJob,
    *,
    error_code: str,
    message: str,
    retryable: bool = True,
) -> str:
    """Failed job: if retryable, back off and re-enter the queue; otherwise it ends failed. Returns the final state."""
    now = _now()
    job.last_error_code = error_code
    job.last_error_message = (message or "")[:2000]
    job.locked_at = None
    job.locked_by = None
    job.updated_at = now
    if retryable and job.attempt_count < job.max_attempts:
        backoff = min(2**job.attempt_count, 300)
        job.status = "retrying"
        job.available_at = now + timedelta(seconds=backoff)
    else:
        job.status = "failed"
        job.completed_at = now
    session.flush()
    return job.status


def reclaim_stale(session: Session, *, lease_seconds: int | None = None) -> int:
    """Worker crash recovery: running jobs whose lease timed out are re-queued."""
    settings = get_settings()
    lease = lease_seconds if lease_seconds is not None else settings.worker_lease_seconds
    cutoff = _now() - timedelta(seconds=lease)
    result = session.execute(
        update(ProcessingJob)
        .where(ProcessingJob.status == "running", ProcessingJob.locked_at < cutoff)
        .values(status="queued", locked_at=None, locked_by=None, available_at=_now(), updated_at=_now())
    )
    return result.rowcount or 0


def cancel_active_jobs(session: Session, document_id: uuid.UUID) -> int:
    result = session.execute(
        update(ProcessingJob)
        .where(ProcessingJob.document_id == document_id, ProcessingJob.status.in_(ACTIVE_STATUSES))
        .values(status="cancelled", completed_at=_now(), updated_at=_now())
    )
    return result.rowcount or 0
