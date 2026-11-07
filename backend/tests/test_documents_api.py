"""Saved-document API: save, dedupe, list filtering, detail, delete, re-parse, status, isolation."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select

from app.models import Document, DocumentRelation, ProcessingJob


def _create(client, headers, url):
    return client.post("/api/v1/documents", json={"url": url}, headers=headers)


def test_create_returns_immediately_and_enqueues(client, auth_headers, db_session):
    resp = _create(client, auth_headers, "https://example.com/article?utm_source=x")
    assert resp.status_code == 201
    body = resp.json()["data"]
    assert body["parse_status"] == "pending"
    assert body["duplicate"] is False
    assert body["source_type"] == "web"
    doc_id = body["id"]

    jobs = db_session.scalars(
        select(ProcessingJob).where(ProcessingJob.document_id == uuid.UUID(doc_id))
    ).all()
    assert len(jobs) == 1
    assert jobs[0].status == "queued"

    status = client.get(f"/api/v1/documents/{doc_id}/status", headers=auth_headers)
    assert status.status_code == 200
    assert status.json()["data"] == {
        "document_id": doc_id,
        "status": "pending",
        "stage": None,
        "progress": None,
        "error_code": None,
    }


def test_duplicate_url_returns_existing_record(client, auth_headers, db_session):
    first = _create(client, auth_headers, "https://example.com/post?b=2&a=1#top")
    assert first.status_code == 201
    second = _create(client, auth_headers, "https://example.com/post?a=1&b=2")
    assert second.status_code == 200
    assert second.json()["data"]["duplicate"] is True
    assert second.json()["data"]["id"] == first.json()["data"]["id"]

    count = db_session.scalar(select(func.count()).select_from(Document))
    assert count == 1
    jobs = db_session.scalars(select(ProcessingJob)).all()
    assert len(jobs) == 1


def test_invalid_url_rejected(client, auth_headers):
    resp = _create(client, auth_headers, "definitely not a url")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "INVALID_URL"

    empty = client.post("/api/v1/documents", json={"url": ""}, headers=auth_headers)
    assert empty.status_code == 400


def test_create_accepts_share_text_and_saves_extracted_url(client, auth_headers, db_session):
    resp = _create(
        client,
        auth_headers,
        "这篇讲 pgvector 的文章不错 https://example.com/post/1?utm_source=share 推荐看看",
    )
    assert resp.status_code == 201
    body = resp.json()["data"]
    assert body["url"] == "https://example.com/post/1?utm_source=share"

    doc = db_session.scalar(select(Document).where(Document.id == uuid.UUID(body["id"])))
    assert doc is not None
    assert doc.original_url == "https://example.com/post/1?utm_source=share"
    assert doc.canonical_url == "https://example.com/post/1"


def test_requires_auth(client):
    resp = client.post("/api/v1/documents", json={"url": "https://example.com"})
    assert resp.status_code == 401


def test_list_filters_sort_and_pagination(client, auth_headers, db_session):
    for i, (host, source) in enumerate(
        [("https://a.example.com/1", "web"), ("https://github.com/x/y", "github"),
         ("https://mp.weixin.qq.com/s/abc", "wechat")]
    ):
        assert _create(client, auth_headers, host).status_code == 201

    docs = db_session.scalars(select(Document)).all()
    assert len(docs) == 3
    for doc in docs:
        doc.title = f"标题 {doc.normalized_url_hash[:4]}"
    docs[0].parse_status = "failed"
    db_session.commit()

    all_items = client.get("/api/v1/documents?page=1&page_size=2", headers=auth_headers).json()["data"]
    assert all_items["total"] == 3
    assert len(all_items["items"]) == 2

    by_source = client.get("/api/v1/documents?source_type=github", headers=auth_headers).json()["data"]
    assert by_source["total"] == 1
    assert by_source["items"][0]["source_type"] == "github"

    by_status = client.get("/api/v1/documents?parse_status=failed", headers=auth_headers).json()["data"]
    assert by_status["total"] == 1

    keyword = client.get("/api/v1/documents?keyword=标题", headers=auth_headers).json()["data"]
    assert keyword["total"] == 3

    nothing = client.get("/api/v1/documents?keyword=zzz-not-here", headers=auth_headers).json()["data"]
    assert nothing["total"] == 0

    asc = client.get("/api/v1/documents?sort=saved_at_asc", headers=auth_headers).json()["data"]
    desc = client.get("/api/v1/documents?sort=saved_at_desc", headers=auth_headers).json()["data"]
    assert [i["id"] for i in asc["items"]] == [i["id"] for i in reversed(desc["items"])]


def test_detail_includes_parsed_fields_and_hides_from_other_users(
    client, auth_headers, second_auth_headers, db_session
):
    created = _create(client, auth_headers, "https://example.com/detail")
    doc_id = created.json()["data"]["id"]
    doc = db_session.scalar(select(Document).where(Document.id == uuid.UUID(doc_id)))
    doc.title = "深度好文"
    doc.summary_short = "一句话摘要"
    doc.summary_long = "详细摘要正文"
    doc.keywords = ["检索", "召回"]
    doc.topics = ["AI"]
    doc.content_markdown = "# 正文\n\n段落内容"
    doc.parse_status = "completed"
    doc.metadata_json = {"parser": "generic"}
    db_session.commit()

    detail = client.get(f"/api/v1/documents/{doc_id}", headers=auth_headers)
    assert detail.status_code == 200
    body = detail.json()["data"]
    assert body["title"] == "深度好文"
    assert body["keywords"] == ["检索", "召回"]
    assert body["summary_long"] == "详细摘要正文"
    assert body["content_markdown"].startswith("# 正文")
    assert body["metadata"]["parser"] == "generic"
    assert body["parse_status"] == "completed"

    foreign = client.get(f"/api/v1/documents/{doc_id}", headers=second_auth_headers)
    assert foreign.status_code == 404
    assert foreign.json()["error"]["code"] == "NOT_FOUND"


def test_delete_removes_document_and_jobs(client, auth_headers, db_session):
    doc_id = _create(client, auth_headers, "https://example.com/todelete").json()["data"]["id"]

    assert client.delete(f"/api/v1/documents/{doc_id}", headers=auth_headers).status_code == 204
    assert client.get(f"/api/v1/documents/{doc_id}", headers=auth_headers).status_code == 404
    assert client.get("/api/v1/documents", headers=auth_headers).json()["data"]["total"] == 0
    assert db_session.scalars(select(ProcessingJob)).all() == []
    assert db_session.scalar(select(Document).where(Document.id == uuid.UUID(doc_id))) is None

    # Re-saving the same URL after deletion should be a brand-new record
    again = _create(client, auth_headers, "https://example.com/todelete")
    assert again.status_code == 201
    assert again.json()["data"]["duplicate"] is False

    assert (
        client.delete(f"/api/v1/documents/{doc_id}", headers=auth_headers).status_code == 404
    )


def test_reprocess_creates_new_job_after_completion(client, auth_headers, db_session):
    doc_id = _create(client, auth_headers, "https://example.com/reparse").json()["data"]["id"]

    first = client.post(f"/api/v1/documents/{doc_id}/reprocess", headers=auth_headers).json()["data"]
    assert first["created"] is False  # a job is already queued; reuse it instead of creating another

    job = db_session.scalar(select(ProcessingJob).limit(1))
    job.status = "completed"
    job.completed_at = datetime.now(timezone.utc)
    db_session.commit()

    second = client.post(f"/api/v1/documents/{doc_id}/reprocess", headers=auth_headers).json()["data"]
    assert second["created"] is True
    assert second["job_id"] != first["job_id"]
    assert second["status"] == "queued"

    doc = db_session.scalar(select(Document).where(Document.id == uuid.UUID(doc_id)))
    assert doc.parse_status == "pending"
    assert doc.parse_error_code is None


def test_related_returns_empty_then_items(client, auth_headers, db_session):
    doc_id = _create(client, auth_headers, "https://example.com/src").json()["data"]["id"]
    other_id = _create(client, auth_headers, "https://example.com/dst").json()["data"]["id"]
    user_id = db_session.scalar(select(Document).where(Document.id == uuid.UUID(doc_id))).user_id

    empty = client.get(f"/api/v1/documents/{doc_id}/related", headers=auth_headers).json()["data"]
    assert empty == {"items": []}

    db_session.add(
        DocumentRelation(
            user_id=user_id,
            source_document_id=uuid.UUID(doc_id),
            target_document_id=uuid.UUID(other_id),
            relation_type="shared_topic",
            score=0.72,
        )
    )
    db_session.commit()

    items = client.get(f"/api/v1/documents/{doc_id}/related", headers=auth_headers).json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["document_id"] == other_id
    assert items[0]["relation_type"] == "shared_topic"
    assert items[0]["score"] == 0.72


def test_unknown_document_id_is_404(client, auth_headers):
    missing = str(uuid.uuid4())
    assert client.get(f"/api/v1/documents/{missing}", headers=auth_headers).status_code == 404
