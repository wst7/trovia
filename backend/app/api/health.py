"""Health check."""
from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from app.db import get_engine

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    status = "ok"
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        status = "degraded"
    return {"status": status}
