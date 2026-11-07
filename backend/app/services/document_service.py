"""收藏的创建、查询、删除、重解析与状态读取。"""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import ApiError
from app.models import Document, DocumentRelation, ProcessingJob
from app.services.url_utils import dedupe, normalize_url
from app.workers import queue

SORT_COLUMNS = {
    "saved_at_desc": (Document.saved_at, "desc"),
    "saved_at_asc": (Document.saved_at, "asc"),
}


def create_document(session: Session, user_id: uuid.UUID, raw_url: str) -> tuple[Document, bool]:
    """保存链接：立即落库并入队；重复 URL 返回已有记录（duplicate=True）。"""
    norm = normalize_url(raw_url)
    existing = dedupe(session, user_id, norm.url_hash)
    if existing is not None:
        return existing, True

    doc = Document(
        user_id=user_id,
        original_url=norm.original,
        canonical_url=norm.canonical,
        normalized_url_hash=norm.url_hash,
        source_type=norm.source_type,
        site_name=norm.host,
        parse_status="pending",
    )
    session.add(doc)
    try:
        session.flush()
    except IntegrityError:
        # Concurrent submit of the same URL: roll back and take the existing record
        session.rollback()
        existing = dedupe(session, user_id, norm.url_hash)
        if existing is None:
            raise
        return existing, True

    queue.enqueue(session, doc, max_attempts=get_settings().job_max_attempts)
    session.commit()
    session.refresh(doc)
    return doc, False


def list_documents(
    session: Session,
    user_id: uuid.UUID,
    *,
    page: int = 1,
    page_size: int = 20,
    source_type: str | None = None,
    parse_status: str | None = None,
    keyword: str | None = None,
    sort: str = "saved_at_desc",
) -> tuple[list[Document], int]:
    conditions = [Document.user_id == user_id]
    if source_type:
        conditions.append(Document.source_type == source_type)
    if parse_status:
        conditions.append(Document.parse_status == parse_status)
    if keyword:
        pattern = f"%{keyword.strip()}%"
        conditions.append(
            or_(
                Document.title.ilike(pattern),
                Document.plain_text.ilike(pattern),
                Document.site_name.ilike(pattern),
            )
        )

    total = session.scalar(
        select(func.count()).select_from(Document).where(*conditions)
    ) or 0
    column, direction = SORT_COLUMNS.get(sort, SORT_COLUMNS["saved_at_desc"])
    order = column.desc() if direction == "desc" else column.asc()
    items = list(
        session.scalars(
            select(Document)
            .where(*conditions)
            .order_by(order)
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    return items, int(total)


def get_document(session: Session, user_id: uuid.UUID, document_id: str | uuid.UUID) -> Document | None:
    """越权访问一律返回 None（对外表现为 404）。"""
    try:
        parsed_id = uuid.UUID(str(document_id))
    except ValueError:
        return None
    return session.scalar(
        select(Document).where(Document.id == parsed_id, Document.user_id == user_id)
    )


def require_document(session: Session, user_id: uuid.UUID, document_id: str | uuid.UUID) -> Document:
    doc = get_document(session, user_id, document_id)
    if doc is None:
        raise ApiError("NOT_FOUND", "收藏不存在或已被删除。", 404)
    return doc


def delete_document(session: Session, user_id: uuid.UUID, document_id: str | uuid.UUID) -> None:
    doc = require_document(session, user_id, document_id)
    queue.cancel_active_jobs(session, doc.id)
    session.delete(doc)
    session.commit()


def reprocess_document(
    session: Session, user_id: uuid.UUID, document_id: str | uuid.UUID
) -> tuple[ProcessingJob, bool]:
    doc = require_document(session, user_id, document_id)
    doc.parse_status = "pending"
    doc.parse_stage = None
    doc.parse_error_code = None
    doc.parse_error_message = None
    job, created = queue.enqueue(session, doc, max_attempts=get_settings().job_max_attempts)
    session.commit()
    return job, created


def document_status(
    session: Session, user_id: uuid.UUID, document_id: str | uuid.UUID
) -> dict[str, Any]:
    doc = require_document(session, user_id, document_id)
    return {
        "document_id": doc.id,
        "status": doc.parse_status,
        "stage": doc.parse_stage,
        "progress": None,
        "error_code": doc.parse_error_code,
    }


def related_documents(
    session: Session, user_id: uuid.UUID, document_id: str | uuid.UUID, limit: int = 10
) -> list[dict[str, Any]]:
    doc = require_document(session, user_id, document_id)
    rows = session.execute(
        select(DocumentRelation, Document)
        .join(Document, Document.id == DocumentRelation.target_document_id)
        .where(
            DocumentRelation.user_id == user_id,
            DocumentRelation.source_document_id == doc.id,
        )
        .order_by(DocumentRelation.score.desc())
        .limit(limit)
    ).all()
    return [
        {
            "document_id": target.id,
            "title": target.title,
            "url": target.original_url,
            "score": float(relation.score),
            "relation_type": relation.relation_type,
        }
        for relation, target in rows
    ]
