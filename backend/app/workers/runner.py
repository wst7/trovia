"""Worker 主循环：python -m app.workers.runner [--once]。

每轮：reclaim_stale → claim → process_document → complete/fail；
SIGTERM/SIGINT 优雅退出；任务失败时同步把 document 置为 failed（保留已抓到的内容）。
"""
from __future__ import annotations

import argparse
import os
import signal
import socket
import time
import uuid

from app.ai.pipeline import process_document
from app.config import Settings, get_settings
from app.db import run_migrations, session_scope
from app.errors import FatalJobError, RetryableJobError
from app.logging import get_logger, setup_logging
from app.models import Document, ProcessingJob
from app.workers import queue

logger = get_logger("trovia.worker")

# Fallback error code for unknown exceptions (inside the contract's error code table)
UNEXPECTED_ERROR_CODE = "PARSE_ERROR"

_stop = False


def _handle_signal(signum, _frame) -> None:
    global _stop
    _stop = True
    logger.info("worker_signal", extra={"signal": signum})


def _mark_document_failed(
    document_id: uuid.UUID, *, error_code: str, error_message: str
) -> str | None:
    """任务终态 failed：文档置 failed 并写错误码，保留已抓内容；返回当时的 stage。"""
    with session_scope() as session:
        job_doc = session.get(Document, document_id)
        if job_doc is None:
            return None
        stage = job_doc.parse_stage
        job_doc.parse_status = "failed"
        job_doc.parse_error_code = error_code
        job_doc.parse_error_message = (error_message or "")[:2000]
        return stage


def run_once(
    settings: Settings, worker_id: str, *, fetch_fn=None
) -> str | None:
    """领取并处理最多一个任务；返回终态（completed/failed/retrying）或 None（无任务）。"""
    with session_scope() as session:
        reclaimed = queue.reclaim_stale(session, lease_seconds=settings.worker_lease_seconds)
        if reclaimed:
            logger.warning("jobs_reclaimed", extra={"count": reclaimed})
        job = queue.claim_job(session, worker_id, lease_seconds=settings.worker_lease_seconds)
        if job is None:
            return None
        job_id = job.id
        document_id = job.document_id

    started = time.monotonic()
    logger.info(
        "job_started",
        extra={"job_id": str(job_id), "document_id": str(document_id), "status": "running"},
    )

    try:
        with session_scope() as session:
            process_document(session, document_id, job_id, settings, fetch_fn=fetch_fn)
        with session_scope() as session:
            job = session.get(ProcessingJob, job_id)
            if job is not None:
                queue.complete_job(session, job)
        status, error_code, error_message = "completed", None, None
    except RetryableJobError as exc:
        status, error_code, error_message = "retrying", exc.code, exc.message
    except FatalJobError as exc:
        status, error_code, error_message = "failed", exc.code, exc.message
    except Exception as exc:  # unknown exception: treat it as retryable so the job does not get stuck in running
        logger.exception("job_unexpected_error", extra={"job_id": str(job_id)})
        status = "retrying"
        error_code = UNEXPECTED_ERROR_CODE
        error_message = f"{exc.__class__.__name__}: {exc}"

    stage = None
    if error_code is not None:
        with session_scope() as session:
            job = session.get(ProcessingJob, job_id)
            if job is not None:
                final_status = queue.fail_job(
                    session,
                    job,
                    error_code=error_code,
                    message=error_message or "",
                    retryable=status != "failed",
                )
                status = final_status
        if status == "failed":
            stage = _mark_document_failed(
                document_id, error_code=error_code, error_message=error_message or ""
            )

    logger.info(
        "job_finished",
        extra={
            "job_id": str(job_id),
            "document_id": str(document_id),
            "stage": stage,
            "duration_ms": int((time.monotonic() - started) * 1000),
            "status": status,
            "error_code": error_code,
        },
    )
    return status


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Xunji 文档处理 Worker")
    parser.add_argument("--once", action="store_true", help="只处理一个任务（无任务则直接退出）")
    args = parser.parse_args(argv)

    settings = get_settings()
    setup_logging(settings.log_level)
    worker_id = f"{socket.gethostname()}:{os.getpid()}"

    # On hosting platforms the worker and the API start independently, and the worker may become ready first.
    # run_once does reclaim_stale as its first step, and a missing table would crash the loop outright,
    # so run the migrations here first (idempotent; the advisory lock keeps concurrent runs with the API from creating tables twice).
    applied = run_migrations()
    if applied:
        logger.info("worker_migrations_applied", extra={"migrations": applied})

    global _stop
    _stop = False
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    logger.info(
        "worker_started",
        extra={"worker_id": worker_id, "once": args.once,
               "poll_seconds": settings.worker_poll_seconds},
    )
    try:
        while not _stop:
            status = run_once(settings, worker_id)
            if args.once:
                logger.info("worker_once_done", extra={"result": status or "idle"})
                return 0
            if status is None:
                time.sleep(settings.worker_poll_seconds)
    except KeyboardInterrupt:  # pragma: no cover - interactive interrupt
        pass
    logger.info("worker_stopped", extra={"worker_id": worker_id})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
