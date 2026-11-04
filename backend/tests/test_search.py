"""混合检索测试：四路召回、0-1 融合分、真实证据解释与跨用户隔离。

覆盖（对应契约 6.6）：
(a) 关键词查询命中正确文档，match_reason 含真实命中词；
(b) 措辞完全不同的语义查询靠注入向量召回（断言写明向量依据）；
(c) 中文整句（无空格标点）查询命中；
(d) 无关查询返回空列表且不报错（四路均无真实证据）；
(e) 跨用户隔离：second_auth_headers 用户搜不到别人的文档；
(f) 分数在 0-1 且按降序；
(g) 摘要/正文为空的 failed 文档按标题仍可被搜到。
"""
from __future__ import annotations

import uuid

from app.ai.embedding import get_embedding_provider
from app.config import get_settings
from app.models import Document, DocumentChunk, User
from app.services import search_service


def _user(session) -> uuid.UUID:
    user = User(email=f"search-{uuid.uuid4().hex[:8]}@trovia.test", password_hash="x")
    session.add(user)
    session.commit()
    return user.id


def _doc(
    session,
    user_id: uuid.UUID,
    *,
    title: str,
    body: str | None = None,
    summary: str | None = None,
    url: str | None = None,
    parse_status: str = "completed",
    keywords: list[str] | None = None,
) -> Document:
    url = url or f"https://example.com/{uuid.uuid4().hex[:12]}"
    doc = Document(
        user_id=user_id,
        original_url=url,
        canonical_url=url,
        normalized_url_hash=uuid.uuid4().hex,
        source_type="web",
        site_name=url.split("/")[2],
        title=title,
        plain_text=body,
        summary_short=summary,
        keywords=keywords or [],
        topics=[],
        parse_status=parse_status,
    )
    session.add(doc)
    session.commit()
    return doc


def _chunk(session, doc: Document, content: str, vec: list[float]) -> DocumentChunk:
    chunk = DocumentChunk(
        document_id=doc.id,
        user_id=doc.user_id,
        chunk_index=0,
        content=content,
        content_hash=uuid.uuid4().hex,
        token_count=len(content),
        embedding=vec,
        embedding_model="test",
        embedding_version=1,
    )
    session.add(chunk)
    session.commit()
    return chunk


def test_keyword_query_hits_correct_document_with_real_reason(db_session):
    """(a) 关键词查询只命中正确文档，解释里列出真实命中的词。"""
    uid = _user(db_session)
    sched = _doc(
        db_session,
        uid,
        title="Kubernetes任务调度实战",
        body="本文介绍如何在 Kubernetes 中配置 CronJob 与调度策略，重点讲解任务调度器的原理。",
        summary="Kubernetes 任务调度配置指南",
    )
    cook = _doc(
        db_session,
        uid,
        title="红烧肉家常做法",
        body="五花肉焯水后炒糖色，加料酒与老抽小火慢炖四十分钟。",
        summary="家常红烧肉做法",
    )
    settings = get_settings()
    hits = search_service.search(db_session, uid, "任务调度", limit=10, settings=settings)

    assert [h.document_id for h in hits] == [str(sched.id)]
    reason = hits[0].match_reason
    assert "任务调度" in reason, f"match_reason 必须列出真实命中词：{reason}"
    assert "红烧肉" not in reason, "解释不得包含未命中的内容"
    # 命中词确实存在于正文，片段取自真实正文
    assert "任务调度" in sched.plain_text
    assert hits[0].matched_excerpt and "任务调度" in hits[0].matched_excerpt
    assert cook.id not in [uuid.UUID(h.document_id) for h in hits]


def test_semantic_recall_via_injected_vectors(db_session, monkeypatch):
    """(b) 措辞完全不同的查询靠语义通道召回，词面/三元组/全文四路均无交集。

    依据：注入的查询向量与 doc_cat 的 chunk 向量完全相同（余弦=1，远高于
    _SEMANTIC_MIN_COS），与 doc_pg 的 chunk 向量正交（余弦=0，低于门槛被剔除）；
    查询串在 title/body/keywords/URL 中均无字面出现，三元组无 3 字公共子串。
    """
    uid = _user(db_session)
    doc_cat = _doc(
        db_session,
        uid,
        title="猫咪沟通行为研究",
        body="How cats communicate with their humans through sounds and gestures.",
    )
    doc_pg = _doc(
        db_session,
        uid,
        title="Postgres索引实践",
        body="B-tree与HNSW索引的取舍实践。",
    )
    dim = get_settings().embedding_dim
    vec_cat = [0.0] * dim
    vec_cat[0] = 1.0
    vec_pg = [0.0] * dim
    vec_pg[1] = 1.0
    _chunk(db_session, doc_cat, "Cats meow and use body language to talk to people.", vec_cat)
    _chunk(db_session, doc_pg, "数据库索引选型指南。", vec_pg)
    monkeypatch.setattr(search_service, "_embed_query", lambda q, s: list(vec_cat))

    query = "那个讲宠物沟通方式的视频"
    hits = search_service.search(db_session, uid, query, limit=10, settings=get_settings())

    assert [h.document_id for h in hits] == [str(doc_cat.id)], (
        "查询向量=doc_cat chunk 向量（余弦1.0），doc_pg 正交（余弦0，低于语义门槛0.1）；"
        "该查询与两篇文档词面无交集，只有语义通道能召回 doc_cat"
    )
    hit = hits[0]
    assert "语义" in hit.match_reason, hit.match_reason
    assert "来源" in hit.match_reason, hit.match_reason
    assert "猫咪" not in hit.match_reason  # 不编造文档里不存在的中文命中词
    # 片段来自语义命中的 chunk 本身（真实证据）
    assert hit.matched_excerpt and "Cats meow" in hit.matched_excerpt


def test_chinese_full_sentence_query(db_session):
    """(c) 中文整句（无空格无标点）作为整串 ILIKE 模式命中正文。"""
    uid = _user(db_session)
    doc = _doc(
        db_session,
        uid,
        title="脏数据清洗实践",
        body="我们写了一个用于处理脏数据的清洗脚本，能够在导入前自动去重与格式统一。",
        summary="脏数据清洗脚本实践",
    )
    other = _doc(db_session, uid, title="旅行随笔", body="海边的黄昏很安静。")

    query = "用于处理脏数据的清洗脚本"
    hits = search_service.search(db_session, uid, query, limit=10, settings=get_settings())

    assert [h.document_id for h in hits] == [str(doc.id)]
    assert query in hits[0].match_reason, hits[0].match_reason
    assert hits[0].matched_excerpt and "清洗脚本" in hits[0].matched_excerpt
    assert str(other.id) not in [h.document_id for h in hits]


def test_unrelated_query_returns_empty(db_session):
    """(d) 无关查询四路都无真实证据 → 空列表且不报错。"""
    uid = _user(db_session)
    doc = _doc(
        db_session,
        uid,
        title="Kubernetes网络插件选型",
        body="We compared CNI plugins for Kubernetes clusters, including Calico and Cilium.",
        summary="Kubernetes CNI 对比评测",
    )
    # 走真实 local embedding：无关查询与该正文的余弦噪声实测远低于语义门槛
    vec = get_embedding_provider(get_settings()).embed([doc.plain_text])[0]
    _chunk(db_session, doc, doc.plain_text, vec)

    hits = search_service.search(
        db_session, uid, "紫菜蛋花汤的家常做法", limit=10, settings=get_settings()
    )
    assert hits == []


def test_cross_user_isolation(client, auth_headers, second_auth_headers, db_session):
    """(e) 第二个用户（second_auth_headers）搜不到别人的文档，只能搜到自己的。"""
    owner_id = uuid.UUID(
        client.get("/api/v1/auth/me", headers=auth_headers).json()["data"]["id"]
    )
    other_id = uuid.UUID(
        client.get("/api/v1/auth/me", headers=second_auth_headers).json()["data"]["id"]
    )
    owner_doc = _doc(
        db_session, owner_id, title="甲的任务调度笔记", body="甲讨论任务调度的实现细节。"
    )
    other_doc = _doc(
        db_session, other_id, title="乙的任务调度笔记", body="乙也收藏了任务调度文章。"
    )

    payload = {"query": "任务调度", "limit": 10}
    mine = client.post("/api/v1/search", headers=auth_headers, json=payload)
    assert mine.status_code == 200, mine.text
    assert [r["document_id"] for r in mine.json()["data"]["results"]] == [str(owner_doc.id)]

    theirs = client.post("/api/v1/search", headers=second_auth_headers, json=payload)
    assert theirs.status_code == 200, theirs.text
    ids = [r["document_id"] for r in theirs.json()["data"]["results"]]
    assert str(other_doc.id) in ids, "自己应搜到自己的文档"
    assert str(owner_doc.id) not in ids, "跨用户隔离：不得返回别人的文档"


def test_natural_language_filler_query_finds_content_terms(db_session):
    """自然语言回忆里的「之前看过」「讲的是」「好像」等外壳不应淹没内容词。"""
    uid = _user(db_session)
    target = _doc(
        db_session,
        uid,
        title="Playwright 浏览器自动化实践",
        body="这个项目用 Playwright 驱动真实浏览器，把重复的网页操作交给脚本执行。",
        summary="用 AI 自动操作浏览器的开源项目，基于 Playwright。",
    )
    other = _doc(
        db_session,
        uid,
        title="周末烘焙记录",
        body="面粉、黄油和糖的比例需要反复调整。",
        summary="黄油曲奇做法",
    )

    query = "之前看过一篇文章，讲的是用 AI 自动操作浏览器，好像还提到了 Playwright"
    hits = search_service.search(db_session, uid, query, limit=10, settings=get_settings())

    assert [h.document_id for h in hits] == [str(target.id)]
    assert "Playwright" in hits[0].match_reason or "自动操作浏览器" in hits[0].match_reason
    assert "之前看过" not in hits[0].match_reason
    assert hits[0].matched_excerpt and (
        "Playwright" in hits[0].matched_excerpt or "浏览器" in hits[0].matched_excerpt
    )
    assert str(other.id) not in [h.document_id for h in hits]


def test_summary_only_match_is_recalled(db_session):
    """正文没出现查询词、但摘要出现时，仍应靠摘要召回并给出真实证据。"""
    uid = _user(db_session)
    target = _doc(
        db_session,
        uid,
        title="一篇技术笔记",
        body="这里记录的是完全不同的内容，和数据库无关。",
        summary="Kubernetes 任务调度配置指南",
    )
    other = _doc(
        db_session, uid, title="红烧肉做法", body="先炒糖色，再小火慢炖。", summary="家常菜"
    )

    hits = search_service.search(db_session, uid, "任务调度", limit=10, settings=get_settings())

    assert [h.document_id for h in hits] == [str(target.id)]
    hit = hits[0]
    assert "任务调度" in hit.match_reason
    assert "摘要" in hit.match_reason
    assert hit.matched_excerpt and "任务调度" in hit.matched_excerpt
    assert str(other.id) not in [h.document_id for h in hits]


def test_scores_bounded_and_sorted_desc(db_session):
    """(f) 分数在 [0,1]、按降序、且都不低于 search_min_score。"""
    settings = get_settings()
    uid = _user(db_session)
    both = _doc(
        db_session,
        uid,
        title="任务调度工具对比",
        body="轻量级任务调度工具支持 cron 表达式，实现灵活的任务调度策略。",
    )
    partial = _doc(
        db_session, uid, title="任务调度进阶", body="深入讲解任务调度的实现原理。"
    )
    irrelevant = _doc(db_session, uid, title="红烧肉做法", body="家常红烧肉的做法，先炒糖色。")

    hits = search_service.search(db_session, uid, "任务调度 cron", limit=10, settings=settings)

    assert [h.document_id for h in hits] == [str(both.id), str(partial.id)]
    scores = [h.score for h in hits]
    assert all(0.0 <= s <= 1.0 for s in scores), scores
    assert scores == sorted(scores, reverse=True), scores
    assert all(s >= settings.search_min_score for s in scores), scores
    assert str(irrelevant.id) not in [h.document_id for h in hits]


def test_failed_document_without_body_found_by_title(db_session):
    """(g) 摘要/正文为空的 failed 文档按标题仍可被搜到，不虚构片段。"""
    uid = _user(db_session)
    failed = _doc(
        db_session,
        uid,
        title="构建失败的页面",
        body=None,
        summary=None,
        url="https://broken.example.org/archived-page-42",
        parse_status="failed",
    )

    hits = search_service.search(db_session, uid, "构建失败的页面", limit=10, settings=get_settings())

    assert [h.document_id for h in hits] == [str(failed.id)]
    hit = hits[0]
    assert hit.parse_status == "failed"
    assert hit.summary is None
    assert hit.matched_excerpt is None, "无正文无摘要时不得虚构片段"
    assert "构建失败的页面" in hit.match_reason, hit.match_reason
