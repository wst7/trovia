"""任务队列：幂等入队、租约、退避重试、崩溃回收。"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.models import Document, User
from app.services.url_utils import normalize_url
from app.workers import queue


def make_user(session) -> User:
    user = User(email=f"queue-{uuid.uuid4().hex[:6]}@trovia.test", password_hash="x")
    session.add(user)
    session.commit()
    return user


def make_doc(session, user: User, slug: str = "a") -> Document:
    norm = normalize_url(f"https://example.com/{slug}")
    doc = Document(
        user_id=user.id,
        original_url=norm.original,
        canonical_url=norm.canonical,
        normalized_url_hash=norm.url_hash,
        source_type=norm.source_type,
        site_name=norm.host,
        parse_status="pending",
    )
    session.add(doc)
    session.commit()
    return doc


def test_enqueue_is_idempotent(db_session):
    user = make_user(db_session)
    doc = make_doc(db_session, user)
    job1, created1 = queue.enqueue(db_session, doc)
    db_session.commit()
    job2, created2 = queue.enqueue(db_session, doc)
    assert created1 is True
    assert created2 is False
    assert job1.id == job2.id
    assert job1.status == "queued"
    assert job1.max_attempts == 3


def test_claim_adds_lease_and_increments_attempt(db_session):
    user = make_user(db_session)
    doc = make_doc(db_session, user)
    job, _ = queue.enqueue(db_session, doc)
    db_session.commit()

    claimed = queue.claim_job(db_session, "worker-1", lease_seconds=300)
    db_session.commit()
    assert claimed is not None
    assert claimed.id == job.id
    assert claimed.status == "running"
    assert claimed.locked_by == "worker-1"
    assert claimed.locked_at is not None
    assert claimed.attempt_count == 1
    # A second worker cannot claim it within the lease
    assert queue.claim_job(db_session, "worker-2", lease_seconds=300) is None


def test_fail_job_backoff_then_terminal_failed(db_session):
    user = make_user(db_session)
    doc = make_doc(db_session, user)
    job, _ = queue.enqueue(db_session, doc)
    db_session.commit()

    claimed = queue.claim_job(db_session, "w", lease_seconds=300)
    status = queue.fail_job(db_session, claimed, error_code="FETCH_TIMEOUT", message="超时", retryable=True)
    db_session.commit()
    assert status == "retrying"
    assert job.last_error_code == "FETCH_TIMEOUT"
    assert job.available_at > datetime.now(timezone.utc)
    assert job.completed_at is None
    # A second worker cannot claim it within the backoff window
    assert queue.claim_job(db_session, "w2", lease_seconds=300) is None

    # Walk the backoff through to exhausting the retry count: attempt 2 → retrying, attempt 3 → terminal failed
    for expected_attempt in (2, 3):
        job.available_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db_session.commit()
        claimed = queue.claim_job(db_session, "w", lease_seconds=300)
        assert claimed is not None and claimed.attempt_count == expected_attempt
        status = queue.fail_job(
            db_session, claimed, error_code="AI_PROVIDER_ERROR", message="AI 挂了", retryable=True
        )
        db_session.commit()
        assert status == ("failed" if expected_attempt == 3 else "retrying")
    assert job.completed_at is not None


def test_fail_job_non_retryable_is_terminal_immediately(db_session):
    user = make_user(db_session)
    doc = make_doc(db_session, user)
    job, _ = queue.enqueue(db_session, doc)
    db_session.commit()
    claimed = queue.claim_job(db_session, "w", lease_seconds=300)
    status = queue.fail_job(db_session, claimed, error_code="CONTENT_NOT_FOUND", message="404", retryable=False)
    db_session.commit()
    assert status == "failed"
    assert job.last_error_code == "CONTENT_NOT_FOUND"


def test_reclaim_stale_returns_job_to_queue(db_session):
    user = make_user(db_session)
    doc = make_doc(db_session, user)
    job, _ = queue.enqueue(db_session, doc)
    db_session.commit()
    claimed = queue.claim_job(db_session, "crashed-worker", lease_seconds=300)
    assert claimed.status == "running"
    # Simulate a worker crash: the lease expires
    job.locked_at = datetime.now(timezone.utc) - timedelta(seconds=600)
    db_session.commit()

    reclaimed = queue.reclaim_stale(db_session, lease_seconds=300)
    db_session.commit()
    assert reclaimed == 1
    assert job.status == "queued"
    assert job.locked_by is None
    # Another worker can claim it normally
    assert queue.claim_job(db_session, "worker-2", lease_seconds=300).id == job.id


def test_complete_job_marks_completed(db_session):
    user = make_user(db_session)
    doc = make_doc(db_session, user)
    job, _ = queue.enqueue(db_session, doc)
    db_session.commit()
    claimed = queue.claim_job(db_session, "w", lease_seconds=300)
    queue.complete_job(db_session, claimed)
    db_session.commit()
    assert job.status == "completed"
    assert job.completed_at is not None
    assert job.locked_by is None
    # After a terminal state the same document can be enqueued again (reparse)
    job2, created = queue.enqueue(db_session, doc)
    assert created is True
    assert job2.id != job.id


def test_cancel_active_jobs(db_session):
    user = make_user(db_session)
    doc = make_doc(db_session, user)
    queue.enqueue(db_session, doc)
    db_session.commit()
    assert queue.cancel_active_jobs(db_session, doc.id) == 1
    db_session.commit()
