"""流水线端到端：注入假抓取，不联网。"""
from __future__ import annotations

import hashlib
import uuid
from pathlib import Path

import pytest
from sqlalchemy import select

from app.ai import pipeline
from app.ai.summary import SummaryProviderError
from app.config import get_settings
from app.errors import FetchError, FatalJobError, RetryableJobError
from app.fetch import FetchResult
from app.models import Document, DocumentChunk, DocumentRelation, ProcessingJob, User
from app.services.url_utils import normalize_url
from app.workers import queue
from app.workers import runner

FIXTURES = Path(__file__).parent / "fixtures"


def make_fetch(name: str, final_url: str):
    html = (FIXTURES / name).read_text(encoding="utf-8")

    def _fetch(url: str, **kwargs) -> FetchResult:
        return FetchResult(
            url=url,
            final_url=final_url,
            status_code=200,
            headers={"content-type": "text/html; charset=utf-8"},
            text=html,
            raw=html.encode("utf-8"),
            truncated=False,
        )

    return _fetch


def make_user(session) -> User:
    user = User(email=f"pipe-{uuid.uuid4().hex[:6]}@trovia.test", password_hash="x")
    session.add(user)
    session.commit()
    return user


def make_doc(session, user: User, url: str) -> tuple[Document, ProcessingJob]:
    norm = normalize_url(url)
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
    job, _ = queue.enqueue(session, doc)
    session.commit()
    return doc, job


def test_pipeline_end_to_end_completed_with_chunks_and_relations(db_session):
    settings = get_settings()
    user = make_user(db_session)
    doc1, job1 = make_doc(db_session, user, "https://blog.example.com/post/1")
    doc2, job2 = make_doc(db_session, user, "https://blog.example.com/post/2")

    url1 = "https://blog.example.com/post/1"
    pipeline.process_document(
        db_session, doc1.id, job1.id, settings, fetch_fn=make_fetch("generic_article.html", url1)
    )
    db_session.refresh(doc1)

    # 状态与内容
    assert doc1.parse_status == "completed"
    assert doc1.parse_stage is None
    assert doc1.parse_error_code is None
    assert doc1.title == "使用 pgvector 构建语义搜索"
    assert doc1.author == "张三"
    assert doc1.published_at is not None
    assert doc1.language == "zh-CN"
    assert "pgvector" in doc1.plain_text
    assert doc1.content_markdown.startswith("#")
    assert doc1.content_hash == hashlib.sha256(doc1.plain_text.encode("utf-8")).hexdigest()
    assert doc1.last_parsed_at is not None
    assert doc1.metadata_json["parser"] == "generic"
    assert doc1.metadata_json["images"]

    # 摘要与关键词
    assert doc1.summary_short
    assert doc1.summary_long
    assert doc1.keywords and doc1.topics

    # chunks 落库且带向量
    chunks = db_session.scalars(
        select(DocumentChunk).where(DocumentChunk.document_id == doc1.id).order_by(DocumentChunk.chunk_index)
    ).all()
    assert chunks
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))
    for chunk in chunks:
        assert chunk.embedding is not None
        assert len(chunk.embedding) == settings.embedding_dim
        assert chunk.embedding_model.startswith("local-hash")
        assert chunk.content_hash == hashlib.sha256(chunk.content.encode("utf-8")).hexdigest()
        assert chunk.token_count > 0

    # 第二篇（同来源、同内容主题）→ 关联落库
    url2 = "https://blog.example.com/post/2"
    pipeline.process_document(
        db_session, doc2.id, job2.id, settings, fetch_fn=make_fetch("generic_article.html", url2)
    )
    relations = db_session.scalars(
        select(DocumentRelation).where(DocumentRelation.source_document_id == doc2.id)
    ).all()
    assert relations
    assert any(r.target_document_id == doc1.id for r in relations)
    types = {r.relation_type for r in relations}
    assert "same_source" in types
    assert "shared_topic" in types or "semantic_similarity" in types
    assert all(r.score > 0 for r in relations)


def test_pipeline_summary_failure_falls_back_and_indexes(db_session, monkeypatch):
    """远程摘要失败时回退本地抽取式，正文仍完成切分/向量化/索引。"""
    settings = get_settings()
    user = make_user(db_session)
    doc, job = make_doc(db_session, user, "https://blog.example.com/post/1")

    class BrokenSummaryProvider:
        def summarize(self, title: str, text: str):
            raise SummaryProviderError("AI_PROVIDER_ERROR", "摘要服务暂时不可用。")

    monkeypatch.setattr(pipeline, "get_summary_provider", lambda _settings: BrokenSummaryProvider())
    pipeline.process_document(
        db_session,
        doc.id,
        job.id,
        settings,
        fetch_fn=make_fetch("generic_article.html", doc.original_url),
    )
    db_session.refresh(doc)

    assert doc.parse_status == "completed"
    assert doc.parse_error_code is None
    assert doc.summary_short, "本地抽取式摘要应保底生成"
    assert doc.keywords
    chunks = db_session.scalars(
        select(DocumentChunk).where(DocumentChunk.document_id == doc.id)
    ).all()
    assert chunks, "摘要失败不应阻止内容进入索引"


def test_pipeline_video_partial_stops_without_chunks(db_session):
    settings = get_settings()
    user = make_user(db_session)
    doc, job = make_doc(db_session, user, "https://www.youtube.com/watch?v=abc123")
    url = "https://www.youtube.com/watch?v=abc123"
    pipeline.process_document(
        db_session, doc.id, job.id, settings, fetch_fn=make_fetch("youtube_og.html", url)
    )
    db_session.refresh(doc)
    assert doc.parse_status == "partial"
    assert doc.title == "向量数据库入门完整教程"
    assert doc.plain_text is None
    assert doc.summary_short is None
    assert doc.metadata_json["duration_seconds"] == 754
    assert db_session.scalars(
        select(DocumentChunk.id).where(DocumentChunk.document_id == doc.id)
    ).first() is None


def test_pipeline_fetch_404_keeps_document_failed(db_session):
    settings = get_settings()
    user = make_user(db_session)
    doc, job = make_doc(db_session, user, "https://gone.example.com/404")

    def fetch_404(url: str, **kwargs):
        raise FetchError("CONTENT_NOT_FOUND", "页面不存在或已被删除。")

    with pytest.raises(FatalJobError) as exc:
        pipeline.process_document(db_session, doc.id, job.id, settings, fetch_fn=fetch_404)
    assert exc.value.code == "CONTENT_NOT_FOUND"

    db_session.expire_all()
    kept = db_session.get(Document, doc.id)
    assert kept is not None  # 任何情况下不得删除 documents 记录
    assert kept.parse_status == "failed"
    assert kept.parse_error_code == "CONTENT_NOT_FOUND"


def test_pipeline_fetch_timeout_is_retryable(db_session):
    settings = get_settings()
    user = make_user(db_session)
    doc, job = make_doc(db_session, user, "https://slow.example.com/a")

    def fetch_timeout(url: str, **kwargs):
        raise FetchError("FETCH_TIMEOUT", "读取网页超时，请稍后重试。")

    with pytest.raises(RetryableJobError) as exc:
        pipeline.process_document(db_session, doc.id, job.id, settings, fetch_fn=fetch_timeout)
    assert exc.value.code == "FETCH_TIMEOUT"
    db_session.expire_all()
    kept = db_session.get(Document, doc.id)
    assert kept is not None
    assert kept.parse_status == "fetching"  # 交给下一次重试继续


def test_runner_run_once_completes_job(db_session):
    settings = get_settings()
    user = make_user(db_session)
    doc, job = make_doc(db_session, user, "https://blog.example.com/post/1")
    url = "https://blog.example.com/post/1"
    status = runner.run_once(settings, "test-worker", fetch_fn=make_fetch("generic_article.html", url))
    assert status == "completed"
    db_session.expire_all()
    assert db_session.get(Document, doc.id).parse_status == "completed"
    assert db_session.get(ProcessingJob, job.id).status == "completed"


def test_runner_run_once_no_job_returns_none(db_session):
    assert runner.run_once(get_settings(), "test-worker") is None


def test_runner_run_once_failure_marks_document_failed(db_session):
    settings = get_settings()
    user = make_user(db_session)
    doc, job = make_doc(db_session, user, "https://gone.example.com/404")
    job.max_attempts = 1  # 单次尝试即终态
    db_session.commit()

    def fetch_404(url: str, **kwargs):
        raise FetchError("CONTENT_NOT_FOUND", "页面不存在或已被删除。")

    status = runner.run_once(settings, "test-worker", fetch_fn=fetch_404)
    assert status == "failed"
    db_session.expire_all()
    final_doc = db_session.get(Document, doc.id)
    assert final_doc is not None
    assert final_doc.parse_status == "failed"
    assert final_doc.parse_error_code == "CONTENT_NOT_FOUND"
    final_job = db_session.get(ProcessingJob, job.id)
    assert final_job.status == "failed"
    assert final_job.last_error_code == "CONTENT_NOT_FOUND"


def test_runner_retryable_failure_retries_then_document_failed(db_session):
    settings = get_settings()
    user = make_user(db_session)
    doc, job = make_doc(db_session, user, "https://slow.example.com/a")
    job.max_attempts = 1
    db_session.commit()

    def fetch_timeout(url: str, **kwargs):
        raise FetchError("FETCH_TIMEOUT", "读取网页超时。")

    status = runner.run_once(settings, "test-worker", fetch_fn=fetch_timeout)
    assert status == "failed"  # 可重试错误，但尝试次数已用尽 → 终态
    db_session.expire_all()
    final_doc = db_session.get(Document, doc.id)
    assert final_doc.parse_status == "failed"
    assert final_doc.parse_error_code == "FETCH_TIMEOUT"
    # 原始链接保留
    assert final_doc.original_url == "https://slow.example.com/a"
