"""Search endpoint contract: auth, parameter validation, empty results."""
from __future__ import annotations


def test_search_requires_auth(client):
    resp = client.post("/api/v1/search", json={"query": "随便找点什么"})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "UNAUTHORIZED"


def test_empty_query_rejected(client, auth_headers):
    blank = client.post("/api/v1/search", json={"query": ""}, headers=auth_headers)
    assert blank.status_code == 400
    assert blank.json()["error"]["code"] == "VALIDATION_ERROR"

    spaces = client.post("/api/v1/search", json={"query": "   "}, headers=auth_headers)
    assert spaces.status_code == 400
    assert spaces.json()["error"]["code"] == "INVALID_QUERY"


def test_limit_bounds_enforced(client, auth_headers):
    low = client.post("/api/v1/search", json={"query": "abc", "limit": 0}, headers=auth_headers)
    assert low.status_code == 400
    high = client.post("/api/v1/search", json={"query": "abc", "limit": 51}, headers=auth_headers)
    assert high.status_code == 400


def test_no_results_returns_empty_array(client, auth_headers):
    resp = client.post("/api/v1/search", json={"query": "完全没有任何收藏"}, headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()["data"]
    assert body["results"] == []
    assert body["total"] == 0
    assert body["query"] == "完全没有任何收藏"


def test_search_only_returns_own_documents(client, auth_headers, second_auth_headers, db_session):
    import uuid

    from sqlalchemy import select

    from app.models import Document

    created = client.post(
        "/api/v1/documents",
        json={"url": "https://example.com/private-note"},
        headers=auth_headers,
    ).json()["data"]
    doc = db_session.scalar(select(Document).where(Document.id == uuid.UUID(created["id"])))
    doc.title = "pgvector 混合检索实践"
    doc.plain_text = "本文介绍如何用 PostgreSQL pgvector 做向量检索与全文检索的融合排序。"
    doc.summary_short = "pgvector 混合检索实践总结"
    doc.parse_status = "completed"
    db_session.commit()

    mine = client.post(
        "/api/v1/search", json={"query": "pgvector 混合检索"}, headers=auth_headers
    ).json()["data"]
    assert mine["total"] >= 1
    assert mine["results"][0]["title"] == "pgvector 混合检索实践"
    assert 0.0 <= mine["results"][0]["score"] <= 1.0
    assert mine["results"][0]["match_reason"]

    theirs = client.post(
        "/api/v1/search", json={"query": "pgvector 混合检索"}, headers=second_auth_headers
    ).json()["data"]
    assert theirs["total"] == 0
