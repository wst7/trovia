"""Saved-document API: create, list, detail, delete, re-parse, status, related documents."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.models import User
from app.schemas import (
    CreateDocumentOut,
    CreateDocumentRequest,
    DataEnvelope,
    DocumentDetail,
    DocumentList,
    DocumentSummary,
    RelatedOut,
    ReprocessOut,
    StatusOut,
    to_create_out,
    to_detail,
    to_summary,
)
from app.services import document_service

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("", response_model=DataEnvelope[CreateDocumentOut])
def create_document(
    payload: CreateDocumentRequest,
    response: Response,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DataEnvelope[CreateDocumentOut]:
    doc, duplicate = document_service.create_document(session, user.id, payload.url)
    response.status_code = status.HTTP_200_OK if duplicate else status.HTTP_201_CREATED
    return DataEnvelope(data=to_create_out(doc, duplicate))


@router.get("", response_model=DataEnvelope[DocumentList])
def list_documents(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    source_type: str | None = Query(default=None),
    parse_status: str | None = Query(default=None),
    keyword: str | None = Query(default=None, max_length=200),
    sort: str = Query(default="saved_at_desc"),
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DataEnvelope[DocumentList]:
    items, total = document_service.list_documents(
        session,
        user.id,
        page=page,
        page_size=page_size,
        source_type=source_type,
        parse_status=parse_status,
        keyword=keyword,
        sort=sort,
    )
    return DataEnvelope(
        data=DocumentList(
            items=[to_summary(doc) for doc in items],
            total=total,
            page=page,
            page_size=page_size,
        )
    )


@router.get("/{document_id}", response_model=DataEnvelope[DocumentDetail])
def get_document(
    document_id: uuid.UUID,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DataEnvelope[DocumentDetail]:
    doc = document_service.require_document(session, user.id, document_id)
    return DataEnvelope(data=to_detail(doc))


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    document_id: uuid.UUID,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    document_service.delete_document(session, user.id, document_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{document_id}/reprocess", response_model=DataEnvelope[ReprocessOut])
def reprocess_document(
    document_id: uuid.UUID,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DataEnvelope[ReprocessOut]:
    job, created = document_service.reprocess_document(session, user.id, document_id)
    return DataEnvelope(data=ReprocessOut(job_id=job.id, status=job.status, created=created))


@router.get("/{document_id}/status", response_model=DataEnvelope[StatusOut])
def document_status(
    document_id: uuid.UUID,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DataEnvelope[StatusOut]:
    return DataEnvelope(
        data=StatusOut(**document_service.document_status(session, user.id, document_id))
    )


@router.get("/{document_id}/related", response_model=DataEnvelope[RelatedOut])
def related_documents(
    document_id: uuid.UUID,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DataEnvelope[RelatedOut]:
    return DataEnvelope(
        data=RelatedOut(items=document_service.related_documents(session, user.id, document_id))
    )
