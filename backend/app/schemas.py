"""Request/response Pydantic models, matching the API contract in section 5 of docs/ENGINEERING.md."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, Field

from app.models import Document

SortOrder = Literal["saved_at_desc", "saved_at_asc"]

T = TypeVar("T")


class DataEnvelope(BaseModel, Generic[T]):
    """Successful responses are uniformly {"data": ...}; errors are {"error": {...}}."""

    data: T


class RegisterRequest(BaseModel):
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    created_at: datetime

    model_config = {"from_attributes": True}


class AuthPayload(BaseModel):
    token: str
    user: UserOut


class CreateDocumentRequest(BaseModel):
    url: str = Field(min_length=1, max_length=4096)


class CreateDocumentOut(BaseModel):
    id: uuid.UUID
    url: str
    title: str | None = None
    source_type: str
    parse_status: str
    created_at: datetime
    duplicate: bool = False


class DocumentSummary(BaseModel):
    id: uuid.UUID
    url: str
    title: str | None = None
    source_type: str
    site_name: str | None = None
    summary_short: str | None = None
    parse_status: str
    parse_error_code: str | None = None
    saved_at: datetime


class DocumentList(BaseModel):
    items: list[DocumentSummary]
    total: int
    page: int
    page_size: int


class DocumentDetail(DocumentSummary):
    canonical_url: str
    author: str | None = None
    published_at: datetime | None = None
    description: str | None = None
    summary_long: str | None = None
    keywords: list[str] = []
    topics: list[str] = []
    language: str | None = None
    content_markdown: str | None = None
    metadata: dict[str, Any] = {}
    parse_stage: str | None = None
    last_parsed_at: datetime | None = None


class StatusOut(BaseModel):
    document_id: uuid.UUID
    status: str
    stage: str | None = None
    progress: int | None = None
    error_code: str | None = None


class ReprocessOut(BaseModel):
    job_id: uuid.UUID
    status: str
    created: bool


class RelatedItem(BaseModel):
    document_id: uuid.UUID
    title: str | None = None
    url: str
    score: float
    relation_type: str


class RelatedOut(BaseModel):
    items: list[RelatedItem]


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=10, ge=1, le=50)


class SearchResult(BaseModel):
    document_id: uuid.UUID
    title: str | None = None
    url: str
    source_type: str
    site_name: str | None = None
    summary: str | None = None
    score: float
    match_reason: str
    matched_excerpt: str | None = None
    saved_at: datetime
    parse_status: str


class SearchOut(BaseModel):
    query: str
    results: list[SearchResult]
    total: int


def to_summary(doc: Document) -> DocumentSummary:
    return DocumentSummary(
        id=doc.id,
        url=doc.original_url,
        title=doc.title,
        source_type=doc.source_type,
        site_name=doc.site_name,
        summary_short=doc.summary_short,
        parse_status=doc.parse_status,
        parse_error_code=doc.parse_error_code,
        saved_at=doc.saved_at,
    )


def to_detail(doc: Document) -> DocumentDetail:
    return DocumentDetail(
        **to_summary(doc).model_dump(),
        canonical_url=doc.canonical_url,
        author=doc.author,
        published_at=doc.published_at,
        description=doc.description,
        summary_long=doc.summary_long,
        keywords=list(doc.keywords or []),
        topics=list(doc.topics or []),
        language=doc.language,
        content_markdown=doc.content_markdown,
        metadata=doc.metadata_json or {},
        parse_stage=doc.parse_stage,
        last_parsed_at=doc.last_parsed_at,
    )


def to_create_out(doc: Document, duplicate: bool) -> CreateDocumentOut:
    return CreateDocumentOut(
        id=doc.id,
        url=doc.original_url,
        title=doc.title,
        source_type=doc.source_type,
        parse_status=doc.parse_status,
        created_at=doc.saved_at,
        duplicate=duplicate,
    )
