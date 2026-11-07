"""Search API."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import get_settings
from app.db import get_db
from app.errors import ApiError
from app.models import User
from app.schemas import DataEnvelope, SearchOut, SearchRequest, SearchResult
from app.services import search_service

router = APIRouter(prefix="/search", tags=["search"])


@router.post("", response_model=DataEnvelope[SearchOut])
def search(
    payload: SearchRequest,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DataEnvelope[SearchOut]:
    query = payload.query.strip()
    if not query:
        raise ApiError("INVALID_QUERY", "请输入你想找回的内容描述。")
    hits = search_service.search(
        session, user.id, query, limit=payload.limit, settings=get_settings()
    )
    return DataEnvelope(data=SearchOut(
        query=query,
        results=[
            SearchResult(
                document_id=hit.document_id,
                title=hit.title,
                url=hit.url,
                source_type=hit.source_type,
                site_name=hit.site_name,
                summary=hit.summary,
                score=round(hit.score, 4),
                match_reason=hit.match_reason,
                matched_excerpt=hit.matched_excerpt,
                saved_at=hit.saved_at,
                parse_status=hit.parse_status,
            )
            for hit in hits
        ],
        total=len(hits),
    ))
