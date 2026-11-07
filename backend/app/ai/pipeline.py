"""文档处理流水线：抓取→解析→摘要关键词→切分→向量化→关联→完成。"""
from __future__ import annotations

import hashlib
import math
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.ai.chunking import chunk_text
from app.ai.embedding import (
    EmbeddingProvider,
    EmbeddingProviderError,
    get_embedding_provider,
)
from app.ai.summary import ExtractiveSummaryProvider, get_summary_provider
from app.config import Settings
from app.errors import FatalJobError, FetchError, RetryableJobError
from app.fetch import FetchResult, safe_fetch
from app.logging import get_logger
from app.models import Document, DocumentChunk, DocumentRelation
from app.parsers.base import ParseResult
from app.parsers.registry import get_parser

logger = get_logger("trovia.ai.pipeline")

# Relation thresholds (real evidence: semantic cosine / topic Jaccard / same-source constant score)
SEMANTIC_MIN_COSINE = 0.2
SAME_SOURCE_SCORE = 0.15
RELATION_MIN_SCORE = 0.1
RELATION_TOP_K = 5

# Error codes that can be retried in the fetch stage; the rest (such as FETCH_BLOCKED/CONTENT_NOT_FOUND) count as terminal
RETRYABLE_FETCH_CODES = {"FETCH_TIMEOUT", "FETCH_ERROR"}

_CJK_RE = re.compile(r"[㐀-䶿一-鿿]")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _estimate_tokens(text: str) -> int:
    """粗略 token 估算：拉丁词数 + 中文字数。"""
    words = len(re.findall(r"[A-Za-z0-9_]+", text))
    cjk = len(_CJK_RE.findall(text))
    return words + cjk


def _cosine(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    norm_l = math.sqrt(sum(a * a for a in left))
    norm_r = math.sqrt(sum(b * b for b in right))
    if norm_l == 0 or norm_r == 0:
        return 0.0
    return dot / (norm_l * norm_r)


def _mean_embedding(session: Session, document_id: uuid.UUID) -> list[float] | None:
    rows = session.execute(
        select(DocumentChunk.embedding).where(
            DocumentChunk.document_id == document_id,
            DocumentChunk.embedding.is_not(None),
        )
    ).all()
    vectors = [row[0] for row in rows if row[0]]
    if not vectors:
        return None
    dim = len(vectors[0])
    mean = [0.0] * dim
    for vector in vectors:
        for i in range(dim):
            mean[i] += float(vector[i])
    mean = [value / len(vectors) for value in mean]
    norm = math.sqrt(sum(v * v for v in mean))
    return [v / norm for v in mean] if norm > 0 else mean


def _update_relations(
    session: Session, doc: Document, source_vector: list[float] | None
) -> None:
    """同用户其他文档：语义（chunk 均值余弦）+ 主题重叠 + 同来源；每文档保留 top 5。"""
    session.execute(
        delete(DocumentRelation).where(
            DocumentRelation.source_document_id == doc.id
        )
    )
    others = session.scalars(
        select(Document).where(
            Document.user_id == doc.user_id,
            Document.id != doc.id,
        )
    ).all()

    doc_topics = set(doc.topics or [])
    rows_by_target: dict[uuid.UUID, list[tuple[str, float]]] = {}
    for other in others:
        rows: list[tuple[str, float]] = []
        if source_vector is not None:
            other_vector = _mean_embedding(session, other.id)
            if other_vector is not None:
                similarity = _cosine(source_vector, other_vector)
                if similarity >= SEMANTIC_MIN_COSINE:
                    rows.append(("semantic_similarity", max(similarity, 0.0)))
        if doc_topics and other.topics:
            intersection = doc_topics & set(other.topics)
            if intersection:
                union = doc_topics | set(other.topics)
                rows.append(("shared_topic", len(intersection) / len(union)))
        if other.source_type == doc.source_type:
            rows.append(("same_source", SAME_SOURCE_SCORE))
        if rows:
            rows_by_target[other.id] = rows

    top_targets = sorted(
        rows_by_target.items(),
        key=lambda item: (-max(score for _, score in item[1]), str(item[0])),
    )[:RELATION_TOP_K]
    for target_id, rows in top_targets:
        for relation_type, score in rows:
            if score <= RELATION_MIN_SCORE:
                continue
            session.add(
                DocumentRelation(
                    user_id=doc.user_id,
                    source_document_id=doc.id,
                    target_document_id=target_id,
                    relation_type=relation_type,
                    score=score,
                )
            )
    session.flush()


def _apply_parse_result(session: Session, doc: Document, parser_name: str, result: ParseResult) -> None:
    doc.title = result.title or doc.title
    doc.author = result.author or doc.author
    doc.published_at = result.published_at or doc.published_at
    doc.site_name = result.site_name or doc.site_name
    doc.description = result.description or doc.description
    doc.content_markdown = result.content_markdown
    doc.plain_text = result.plain_text
    doc.language = result.language or doc.language
    metadata = dict(result.metadata or {})
    metadata.setdefault("parser", parser_name)
    metadata.setdefault("images", result.images)
    metadata.setdefault("links", result.links)
    doc.metadata_json = metadata
    if result.plain_text:
        doc.content_hash = _sha256(result.plain_text)
    doc.last_parsed_at = _now()


def process_document(
    session: Session,
    document_id: uuid.UUID | str,
    job_id: uuid.UUID | str,
    settings: Settings,
    *,
    fetch_fn=None,
) -> None:
    """处理单个文档全流程；可恢复错误抛 RetryableJobError，不可恢复抛 FatalJobError。

    任何情况下不删除 documents 记录；partial 解析结果保留并止步于 partial。
    """
    fetch = fetch_fn or safe_fetch
    doc = session.get(Document, _coerce_uuid(document_id))
    if doc is None:
        return

    # ---- fetch ----
    doc.parse_status = "fetching"
    doc.parse_stage = "fetch"
    doc.parse_error_code = None
    doc.parse_error_message = None
    session.commit()

    try:
        fetched: FetchResult = fetch(
            doc.original_url,
            timeout=settings.fetch_timeout_seconds,
            max_bytes=settings.fetch_max_bytes,
            max_redirects=settings.fetch_max_redirects,
            allowed_ports=settings.allowed_ports,
        )
    except FetchError as exc:
        _raise_fetch_error(session, doc, exc)
    except RetryableJobError:
        raise
    except Exception as exc:  # an unknown exception from the fetch implementation is treated as a network error
        raise RetryableJobError(
            "FETCH_ERROR", f"抓取网页时发生错误：{exc.__class__.__name__}"
        ) from exc

    # ---- parse ----
    doc.parse_status = "parsing"
    doc.parse_stage = "parse"
    session.commit()

    parser = get_parser(doc.original_url, doc.source_type)
    try:
        result = parser.parse(fetched)
    except Exception as exc:  # defensive: the parser contract requires that it never raises
        session.rollback()
        doc.parse_status = "failed"
        doc.parse_error_code = "PARSE_ERROR"
        doc.parse_error_message = f"解析器异常：{exc.__class__.__name__}"
        session.commit()
        raise FatalJobError("PARSE_ERROR", doc.parse_error_message) from exc

    _apply_parse_result(session, doc, parser.name, result)

    if result.parse_status == "failed":
        code = result.error_code or "PARSE_ERROR"
        message = result.error_message or "内容解析失败。"
        doc.parse_status = "failed"
        doc.parse_error_code = code
        doc.parse_error_message = message
        session.commit()
        raise FatalJobError(code, message)

    if result.parse_status == "partial":
        doc.parse_status = "partial"
        doc.parse_stage = "parse"
        doc.parse_error_code = result.error_code
        doc.parse_error_message = result.error_message
        session.commit()
        return

    # ---- summary and keywords ----
    doc.parse_status = "analyzing"
    doc.parse_stage = "summarize"
    session.commit()

    text = doc.plain_text or ""
    if text.strip():
        # A summary service being unavailable must not block indexing: fall back to local extractive, so the content can still be found again.
        summary = None
        try:
            summary = get_summary_provider(settings).summarize(doc.title or "", text)
        except Exception as exc:
            logger.warning(
                "summary_provider_failed_fallback_extractive",
                extra={
                    "document_id": str(doc.id),
                    "error": exc.__class__.__name__,
                },
            )
            try:
                summary = ExtractiveSummaryProvider().summarize(doc.title or "", text)
            except Exception as fallback_exc:
                logger.warning(
                    "summary_fallback_failed",
                    extra={
                        "document_id": str(doc.id),
                        "error": fallback_exc.__class__.__name__,
                    },
                )
        if summary is not None:
            doc.summary_short = summary.summary_short
            doc.summary_long = summary.summary_long
            doc.keywords = summary.keywords or []
            doc.topics = summary.topics or []
            session.commit()

    # ---- chunking ----
    doc.parse_stage = "chunk"
    session.commit()
    chunks = chunk_text(text, settings.chunk_max_chars, settings.chunk_overlap)

    # ---- embedding and index writes ----
    doc.parse_status = "indexing"
    doc.parse_stage = "embed"
    session.commit()

    provider: EmbeddingProvider = get_embedding_provider(settings)
    try:
        vectors = provider.embed(chunks) if chunks else []
    except EmbeddingProviderError as exc:
        raise RetryableJobError(exc.code, exc.message) from exc
    except RuntimeError as exc:  # dimension mismatch: a configuration error, retrying is pointless
        raise FatalJobError("EMBEDDING_ERROR", str(exc)) from exc

    doc.parse_stage = "index"
    session.commit()

    try:
        session.execute(
            delete(DocumentChunk).where(DocumentChunk.document_id == doc.id)
        )
        for index, (content, vector) in enumerate(zip(chunks, vectors)):
            session.add(
                DocumentChunk(
                    document_id=doc.id,
                    user_id=doc.user_id,
                    chunk_index=index,
                    content=content,
                    content_hash=_sha256(content),
                    token_count=_estimate_tokens(content),
                    embedding=vector,
                    embedding_model=provider.model_name,
                    embedding_version=1,
                )
            )
        session.flush()

        source_vector = None
        if vectors:
            dim = len(vectors[0])
            mean = [0.0] * dim
            for vector in vectors:
                for i in range(dim):
                    mean[i] += float(vector[i])
            mean = [value / len(vectors) for value in mean]
            norm = math.sqrt(sum(v * v for v in mean))
            source_vector = [v / norm for v in mean] if norm > 0 else mean
        _update_relations(session, doc, source_vector)

        doc.parse_status = "completed"
        doc.parse_stage = None
        doc.parse_error_code = None
        doc.parse_error_message = None
        doc.last_parsed_at = _now()
        session.commit()
    except Exception as exc:
        session.rollback()
        raise RetryableJobError(
            "INDEX_WRITE_ERROR", f"索引写入失败：{exc.__class__.__name__}"
        ) from exc


def _raise_fetch_error(session: Session, doc: Document, exc: FetchError) -> None:
    """抓取失败：可重试的抛 RetryableJobError；终态错误同步置文档 failed。"""
    if exc.code in RETRYABLE_FETCH_CODES:
        raise RetryableJobError(exc.code, exc.message) from exc
    code = exc.code if exc.code in {
        "INVALID_URL", "FETCH_TIMEOUT", "FETCH_BLOCKED", "FETCH_ERROR",
        "CONTENT_NOT_FOUND", "UNSUPPORTED_CONTENT",
    } else "FETCH_ERROR"
    doc.parse_status = "failed"
    doc.parse_error_code = code
    doc.parse_error_message = exc.message
    session.commit()
    raise FatalJobError(code, exc.message) from exc


def _coerce_uuid(value: uuid.UUID | str) -> uuid.UUID:
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))
