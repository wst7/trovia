"""混合检索：四路召回 + 候选集 min-max 归一化 + 配置权重加权融合。

四路召回（全部强制 user_id 过滤；删除为硬删，行不存在即不可见）与原始分来源：

================= ==========================================================
通道              原始分（通道内取 max）
================= ==========================================================
全文 (fts)        ts_rank_cd(to_tsvector('simple', title||summary||plain_text),
                  websearch_to_tsquery('simple', terms OR ...)) 原值 r → r/(r+1) ∈ [0,1)
三元组 (trgm)     similarity(title, clean_q)、similarity(summary, clean_q)、
                  similarity(plain_text, clean_q) 原值，≥ _TRGM_MIN 才算证据
                  （中文无分词，3 字以上公共子串靠它兜底；长正文会被长度稀释）
词面 (ILIKE)      query 去掉「之前看过一篇文章」「帮我找」等叙事外壳后切出的 term
                  （外加整串 query / clean_q）对 title / summary / plain_text /
                  keywords / topics / site_name / author / 描述 / URL 做 ILIKE，
                  证据 = 命中模式数 / 模式总数
语义 (pgvector)   查询向量化后取 chunk 余弦距离 top-N（search_vector_candidates），
                  按文档聚合最优 chunk，cos = 1 - distance，
                  ≥ _SEMANTIC_MIN_COS 才算证据（local 哈希无关噪声实测 ≤0.06）
================= ==========================================================

四路分数映射到四个加权维度（权重 = settings.search_weights，默认
lexical 0.35 / semantic 0.35 / title 0.20 / meta 0.10）：

- lexical = max(全文 r/(r+1), 正文/摘要三元组, 正文/摘要词面命中率)
- title   = max(标题全文秩, 标题三元组, 标题词面命中率)
- meta    = keywords/topics/site_name/author/描述/URL 的词面命中率
- semantic= 该文档最优 chunk 的余弦相似度

融合公式（候选集 = 至少一路命中的文档；候选集内某路未命中该文档记 0）：

    score = clip01( Σ_channel weight_channel × minmax_channel(raw) )

minmax 在候选集内做 (x - min)/(max - min)：该通道全 0 → 全 0；
该通道全为相同正值 → 全 1。低于 settings.search_min_score 的结果剔除，
按 score 降序（同分按 saved_at 降序）取 limit。搜索期不做任何模型调用，
只有 _embed_query 这一次查询向量化。

match_reason 模板（每个分句都对应真实证据，列出的命中词必须在对应字段里
实际存在；禁止编造正文没有的内容）：

- 正文词面命中：        正文与「{query}」相关：命中关键词「t1」「t2」
- 正文仅三元组相似：    正文与「{query}」内容相似
- 摘要词面命中：        摘要命中关键词「t1」「t2」（仅列正文未出现的词）
- 摘要仅三元组相似：    摘要与「{query}」内容相似
- 标题词面命中：        标题命中关键词「t1」「t2」
- 标题仅三元组相似：    标题与「{query}」相似（仅在无正文证据时提及）
- 元数据命中：          来源信息匹配关键词「t1」「t2」
- 语义 + 其他证据：     与你描述的内容语义相近
- 仅语义：              正文语义上接近你描述的内容
- 分句用「，」连接；存在来源域名时追加「（来源 {host}）」；结尾「。」。
  命中词按长度降序最多列 2 个（更具体的词优先）。

matched_excerpt：正文命中词的上下文窗口（≤200 字符，截断处加省略号）→
摘要命中词的上下文窗口 → 语义命中 chunk 的片段 → 摘要首句 → None。绝不虚构。
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlparse

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.ai.embedding import get_embedding_provider
from app.config import Settings, get_settings
from app.logging import get_logger

logger = get_logger("trovia.search")

# 候选准入与打分的绝对门槛（阈值依据：中文真子串标题命中 similarity ≥0.10、
# 无关串 =0；local 哈希 embedding 无关查询余弦噪声实测 ≤0.06）
_TRGM_MIN = 0.05
_SEMANTIC_MIN_COS = 0.1

_MAX_TERMS = 12          # term 上限，防止模式爆炸
_MAX_REASON_TERMS = 2    # match_reason 每个分句最多列几个命中词
_EXCERPT_MAX = 200       # matched_excerpt 长度上限（含省略号）
_EXCERPT_CONTEXT = 40    # 命中词前置上下文字符数

_CHANNELS = ("lexical", "semantic", "title", "meta")

_TERM_SPLIT_RE = re.compile(r"[\s,.;:!?，。！？；：、…·\"'“”‘’（）()【】\[\]<>《》—\-_/\\]+")

# 中文自然语言回忆常带叙事/提问外壳；先去掉这些短语，只留下内容词。
# 短语按长度降序进入正则，避免「之前看过」先吃掉「之前看过一篇文章」。
_FILLER_PHRASES = (
    "之前看过一篇文章", "之前看过一篇", "之前看过", "以前看过一篇文章", "以前看过一篇", "以前看过",
    "我曾经看过", "我看过一篇", "我看过", "看过一篇", "我收藏过一篇", "我收藏过", "收藏过一篇", "收藏过",
    "我记得有一篇", "我记得", "好像还提到了", "好像有一篇", "好像", "似乎", "大概",
    "帮我找一下", "请帮我找", "帮我找", "我想找回", "我想找", "想找回", "找一下",
    "有一篇讲", "有一篇", "一篇文章", "一篇", "这篇文章", "那篇文章", "这个内容", "那个内容",
    "讲的是", "说的是", "内容是关于", "是关于", "关于", "还提到了", "提到了", "提到",
    "怎么样", "怎么", "如何", "为什么", "是什么", "什么是",
    "我们", "你们", "他们", "它们", "咱们", "这个", "那个", "这些", "那些",
)
_FILLER_RE = re.compile("|".join(re.escape(p) for p in sorted(_FILLER_PHRASES, key=len, reverse=True)))

# 中英文脚本相邻处切开，使「AI自动操作浏览器」「Playwright语义搜索」也能产出独立 term。
_SCRIPT_BOUNDARY_RE = re.compile(
    r"(?<=[A-Za-z0-9])(?=[㐀-鿿])|(?<=[㐀-鿿])(?=[A-Za-z0-9])"
)

# 单个中文虚词/泛动词不参与匹配；单字内容词（如「猫」）仍保留。
_SINGLE_CJK_NOISE = set(
    "的了和是在有就都而及或这那我你他她它们把被对从到为很也不没么些之其此"
    "并且因此但是所以如果虽然然后已经一下用讲说看找写做篇个里中上下"
)

_EN_STOPWORDS = {
    "a", "an", "the", "this", "that", "these", "those", "i", "we", "you", "he", "she",
    "it", "they", "me", "my", "our", "your", "his", "her", "its", "their", "about",
    "of", "for", "to", "in", "on", "at", "by", "with", "and", "or", "but", "is",
    "are", "was", "were", "be", "been", "being", "do", "does", "did", "have", "has",
    "had", "find", "show", "remember", "please",
}


@dataclass(frozen=True)
class _QueryPlan:
    original: str
    clean: str
    terms: tuple[str, ...]
    patterns: tuple[str, ...]
    fts_query: str


@dataclass
class SearchHit:
    document_id: str
    title: str | None
    url: str
    source_type: str
    site_name: str | None
    summary: str | None
    score: float
    match_reason: str
    matched_excerpt: str | None
    saved_at: datetime
    parse_status: str


# ---------------------------------------------------------------------------
# 查询预处理
# ---------------------------------------------------------------------------

def _is_noise_term(term: str) -> bool:
    if term.lower() in _EN_STOPWORDS:
        return True
    if len(term) == 1:
        if term.isascii() and term.isalnum():
            return True
        if term in _SINGLE_CJK_NOISE:
            return True
    return False


def _terms(query: str) -> list[str]:
    """去掉叙事/提问外壳，按标点、空白和中英文边界切出内容词。"""
    cleaned = _FILLER_RE.sub(" ", query or "")
    terms: list[str] = []
    for part in _TERM_SPLIT_RE.split(cleaned):
        for piece in _SCRIPT_BOUNDARY_RE.split(part):
            piece = piece.strip()
            if not piece or _is_noise_term(piece):
                continue
            if piece not in terms:
                terms.append(piece)
    return terms[:_MAX_TERMS]


def _plan_query(query: str) -> _QueryPlan:
    original = (query or "").strip()
    terms = _terms(original)
    if not terms:
        # 整句都是虚词/标点时，退回原始串，保持「无证据则空结果」的语义。
        terms = [original] if original else []
    clean = " ".join(terms)
    patterns: list[str] = list(terms)
    for candidate in (original, clean):
        if candidate and candidate not in patterns:
            patterns.append(candidate)
    return _QueryPlan(
        original=original,
        clean=clean or original,
        terms=tuple(terms),
        patterns=tuple(patterns),
        fts_query=" OR ".join(terms),
    )


def _like_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _matched(patterns: list[str], haystack: str) -> list[str]:
    """haystack 里真实存在的模式（ILIKE 的 Python 侧等价校验，供解释用）。"""
    low = haystack.lower()
    return [p for p in patterns if p and p.lower() in low]


# ---------------------------------------------------------------------------
# 召回
# ---------------------------------------------------------------------------

def _embed_query(query: str, settings: Settings) -> list[float] | None:
    """查询向量化：搜索期唯一一次模型调用；失败降级为无语义通道。"""
    try:
        vectors = get_embedding_provider(settings).embed([query])
    except Exception as exc:  # 语义通道故障不应让词面检索一起挂掉
        logger.warning("query_embed_failed", extra={"error": str(exc)})
        return None
    if not vectors or not vectors[0]:
        return None
    return [float(x) for x in vectors[0]]


def _semantic_candidates(
    session: Session, uid: uuid.UUID, query: str, settings: Settings
) -> dict[uuid.UUID, tuple[float, str | None]]:
    """语义召回：top-N chunk 按距离升序，每文档取首个（= 最优）chunk。"""
    qvec = _embed_query(query, settings)
    if not qvec:
        return {}
    vec_literal = "[" + ",".join(repr(x) for x in qvec) + "]"
    topk = max(1, int(settings.search_vector_candidates))
    rows = session.execute(
        text(
            """
            SELECT document_id, dist, content
            FROM (
                SELECT document_id, content,
                       embedding <=> CAST(:qvec AS vector) AS dist
                FROM document_chunks
                WHERE user_id = :user_id AND embedding IS NOT NULL
                ORDER BY embedding <=> CAST(:qvec AS vector)
                LIMIT :topk
            ) t
            ORDER BY dist
            """
        ),
        {"qvec": vec_literal, "user_id": uid, "topk": topk},
    ).all()
    out: dict[uuid.UUID, tuple[float, str | None]] = {}
    for doc_id, dist, content in rows:
        if doc_id in out:
            continue  # 已按距离升序，首见即该文档最优 chunk
        cos = 1.0 - float(dist)
        if cos >= _SEMANTIC_MIN_COS:
            out[doc_id] = (cos, content)
    return out


_LEXICAL_SQL = """
WITH base AS (
    SELECT d.*,
           coalesce(d.summary_short, '') || ' ' || coalesce(d.summary_long, '') AS summary_text
    FROM documents d
    WHERE d.user_id = :user_id
)
SELECT d.id, d.title, d.original_url, d.canonical_url, d.source_type, d.site_name,
       d.summary_short, d.summary_long, d.summary_text,
       d.author, d.keywords, d.topics, d.description,
       d.saved_at, d.parse_status,
       ts_rank_cd(
           to_tsvector(
               'simple',
               coalesce(d.title, '') || ' ' || d.summary_text || ' ' || coalesce(d.plain_text, '')
           ),
           websearch_to_tsquery('simple', :fts_q)
       ) AS fts_rank,
       ts_rank_cd(
           to_tsvector('simple', coalesce(d.title, '')),
           websearch_to_tsquery('simple', :fts_q)
       ) AS title_fts_rank,
       similarity(coalesce(d.title, ''), :qclean) AS title_trgm,
       similarity(d.summary_text, :qclean) AS summary_trgm,
       similarity(coalesce(d.plain_text, ''), :qclean) AS body_trgm,
       (SELECT count(*) FROM unnest(CAST(:patterns AS text[])) AS x(pat)
           WHERE coalesce(d.plain_text, '') ILIKE x.pat) AS body_hits,
       (SELECT count(*) FROM unnest(CAST(:patterns AS text[])) AS x(pat)
           WHERE d.summary_text ILIKE x.pat) AS summary_hits
FROM base d
WHERE (
        to_tsvector(
            'simple',
            coalesce(d.title, '') || ' ' || d.summary_text || ' ' || coalesce(d.plain_text, '')
        )
          @@ websearch_to_tsquery('simple', :fts_q)
     OR similarity(coalesce(d.title, ''), :qclean) >= :trgm_min
     OR similarity(d.summary_text, :qclean) >= :trgm_min
     OR similarity(coalesce(d.plain_text, ''), :qclean) >= :trgm_min
     OR coalesce(d.title, '') ILIKE ANY(:patterns)
     OR d.summary_text ILIKE ANY(:patterns)
     OR coalesce(d.plain_text, '') ILIKE ANY(:patterns)
     OR (array_to_string(d.keywords, ' ') || ' ' || array_to_string(d.topics, ' ') || ' '
         || coalesce(d.site_name, '') || ' ' || coalesce(d.author, '') || ' '
         || coalesce(d.description, '') || ' ' || d.original_url || ' ' || d.canonical_url)
          ILIKE ANY(:patterns)
     {sem_clause}
  )
"""


def _lexical_candidates(
    session: Session,
    uid: uuid.UUID,
    plan: _QueryPlan,
    like_patterns: list[str],
    sem_ids: set[uuid.UUID],
    settings: Settings,
) -> list:
    """全文/三元组/词面三路的候选行（含语义入围文档，保证其字段可展示）。"""
    sem_clause = "OR d.id = ANY(:sem_ids)" if sem_ids else ""
    params: dict = {
        "qclean": plan.clean,
        "fts_q": plan.fts_query,
        "patterns": like_patterns,
        "user_id": uid,
        "trgm_min": _TRGM_MIN,
    }
    if sem_ids:
        params["sem_ids"] = list(sem_ids)
    return session.execute(
        text(_LEXICAL_SQL.format(sem_clause=sem_clause)), params
    ).all()


# ---------------------------------------------------------------------------
# 打分与融合
# ---------------------------------------------------------------------------

def _minmax(values: dict[uuid.UUID, float]) -> dict[uuid.UUID, float]:
    """候选集内 min-max 归一化到 [0,1]；全 0 → 全 0；相同正值 → 全 1。"""
    if not values:
        return {}
    lo = min(values.values())
    hi = max(values.values())
    if hi <= 0:
        return {k: 0.0 for k in values}
    if hi == lo:
        return {k: 1.0 for k in values}
    span = hi - lo
    return {k: (v - lo) / span for k, v in values.items()}


def _fts_norm(rank: float) -> float:
    rank = float(rank or 0)
    return rank / (1.0 + rank) if rank > 0 else 0.0


def _meta_text(row) -> str:
    return " ".join(
        [
            " ".join(row.keywords or []),
            " ".join(row.topics or []),
            row.site_name or "",
            row.author or "",
            row.description or "",
            row.original_url or "",
            row.canonical_url or "",
        ]
    )


def _row_raw_scores(row, patterns: list[str], semantic: float) -> dict[str, float]:
    n = max(1, len(patterns))
    title = row.title or ""
    body_trgm = float(row.body_trgm or 0)
    summary_trgm = float(row.summary_trgm or 0)
    title_trgm = float(row.title_trgm or 0)
    body_hits = int(row.body_hits or 0)
    summary_hits = int(row.summary_hits or 0)
    title_hits = len(_matched(patterns, title))
    meta_hits = len(_matched(patterns, _meta_text(row)))
    # 摘要也是用户记得的内容：它与正文共享 lexical 维度，摘要单独命中也能召回。
    lexical = max(
        _fts_norm(row.fts_rank),
        body_trgm if body_trgm >= _TRGM_MIN else 0.0,
        summary_trgm if summary_trgm >= _TRGM_MIN else 0.0,
        body_hits / n if body_hits else 0.0,
        summary_hits / n if summary_hits else 0.0,
    )
    title_score = max(
        _fts_norm(row.title_fts_rank),
        title_trgm if title_trgm >= _TRGM_MIN else 0.0,
        title_hits / n if title_hits else 0.0,
    )
    meta = meta_hits / n if meta_hits else 0.0
    return {
        "lexical": lexical,
        "semantic": semantic,
        "title": title_score,
        "meta": meta,
    }


# ---------------------------------------------------------------------------
# 结果解释（全部基于真实证据）
# ---------------------------------------------------------------------------

def _display_terms(matched: list[str]) -> str:
    picked: list[str] = []
    for term in sorted(matched, key=len, reverse=True):
        if any(term in already for already in picked):
            continue  # 已被更长的命中词包含，不重复列出
        picked.append(term)
        if len(picked) >= _MAX_REASON_TERMS:
            break
    return "".join(f"「{t}」" for t in picked)


def _host(row) -> str:
    host = ""
    try:
        host = urlparse(row.original_url or "").hostname or ""
    except ValueError:
        host = ""
    if not host:
        host = (row.site_name or "").strip()
    if host.lower().startswith("www."):
        host = host[4:]
    return host


def _build_reason(
    query: str,
    matched_body: list[str],
    matched_summary: list[str],
    matched_title: list[str],
    matched_meta: list[str],
    has_semantic: bool,
    body_trgm_ok: bool,
    summary_trgm_ok: bool,
    title_trgm_ok: bool,
    host: str,
) -> str:
    segs: list[str] = []
    if matched_body:
        segs.append(f"正文与「{query}」相关：命中关键词{_display_terms(matched_body)}")
    elif body_trgm_ok:
        segs.append(f"正文与「{query}」内容相似")
    # 摘要通常由正文抽取，已列出的词不重复；摘要独有命中时单独说明。
    summary_only = [t for t in matched_summary if t not in matched_body]
    if summary_only:
        segs.append(f"摘要命中关键词{_display_terms(summary_only)}")
    elif summary_trgm_ok and not matched_body and not body_trgm_ok:
        segs.append(f"摘要与「{query}」内容相似")
    if matched_title:
        segs.append(f"标题命中关键词{_display_terms(matched_title)}")
    elif title_trgm_ok and not matched_body:
        segs.append(f"标题与「{query}」相似")
    if matched_meta:
        segs.append(f"来源信息匹配关键词{_display_terms(matched_meta)}")
    if has_semantic:
        segs.append("与你描述的内容语义相近" if segs else "正文语义上接近你描述的内容")
    if not segs:  # 防御：有召回证据但词面校验没列出词（如仅全文秩命中）
        segs.append(f"命中与「{query}」相关的内容")
    reason = "，".join(segs)
    if host:
        reason += f"（来源 {host}）"
    return reason + "。"


def _slice_around(text_: str, pos: int) -> str:
    """以 pos 为起点取窗口，截断处加省略号，总长 ≤ _EXCERPT_MAX。"""
    length = len(text_)
    if length <= _EXCERPT_MAX:
        return text_
    start = max(0, pos - _EXCERPT_CONTEXT)
    end = min(length, start + _EXCERPT_MAX)
    lead = "…" if start > 0 else ""
    tail = "…" if end < length else ""
    frag = text_[start:end]
    overflow = len(lead) + len(tail) + len(frag) - _EXCERPT_MAX
    if overflow > 0:
        frag = frag[: len(frag) - overflow]
    return lead + frag + tail


def _first_sentence(summary: str | None) -> str | None:
    if not summary or not summary.strip():
        return None
    s = summary.strip()
    idx = next((i for i, ch in enumerate(s) if ch in "。！？!?\n"), None)
    sent = s[:idx].strip() if idx is not None else s
    if not sent:
        sent = s
    if len(sent) > _EXCERPT_MAX:
        return sent[: _EXCERPT_MAX - 1] + "…"
    return sent


def _body_window(body: str, matched: list[str]) -> str | None:
    low = body.lower()
    best_pos = -1
    best_term = ""
    for term in matched:
        pos = low.find(term.lower())
        if pos < 0:
            continue
        if best_pos < 0 or pos < best_pos or (pos == best_pos and len(term) > len(best_term)):
            best_pos, best_term = pos, term
    if best_pos < 0:
        return None
    return _slice_around(body, best_pos)


def _build_excerpt(
    body: str,
    matched_body: list[str],
    chunk_content: str | None,
    summary_text: str,
    matched_summary: list[str],
) -> str | None:
    if body and matched_body:
        window = _body_window(body, matched_body)
        if window:
            return window
    if summary_text and matched_summary:
        window = _body_window(summary_text, matched_summary)
        if window:
            return window
    if chunk_content:
        window = _slice_around(chunk_content, 0)
        if window:
            return window
    return _first_sentence(summary_text)


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------

def search(
    session: Session,
    user_id: str,
    query: str,
    limit: int = 10,
    settings: Settings | None = None,
) -> list[SearchHit]:
    settings = settings or get_settings()
    q = (query or "").strip()
    if not q or limit <= 0:
        return []
    uid = uuid.UUID(str(user_id))

    plan = _plan_query(q)
    if not plan.terms:
        return []
    like_patterns = [f"%{_like_escape(p)}%" for p in plan.patterns]

    # 1) 语义召回（唯一一次向量化；用去掉叙事外壳后的内容词，减少虚词噪声）
    sem = _semantic_candidates(session, uid, plan.clean, settings)

    # 2) 全文/三元组/词面召回（含语义入围文档的字段）
    rows = _lexical_candidates(session, uid, plan, like_patterns, set(sem), settings)

    # 3) 各通道原始分
    candidates: dict[uuid.UUID, dict] = {}
    for row in rows:
        raw = _row_raw_scores(row, list(plan.patterns), sem.get(row.id, (0.0, None))[0])
        if max(raw.values()) <= 0.0:
            continue  # 入围条件与原始分不一致时的兜底（如全文秩为 0 的边界）
        candidates[row.id] = {"row": row, "raw": raw}
    if not candidates:
        return []

    # 4) 候选集内 min-max 归一化 → 加权融合 → 阈值 → 排序截断
    weights = settings.search_weights
    norms = {
        ch: _minmax({did: cand["raw"][ch] for did, cand in candidates.items()})
        for ch in _CHANNELS
    }
    scored: list[tuple[float, uuid.UUID, dict]] = []
    for did, cand in candidates.items():
        score = sum(weights.get(ch, 0.0) * norms[ch][did] for ch in _CHANNELS)
        score = max(0.0, min(1.0, score))
        if score < settings.search_min_score:
            continue
        scored.append((score, did, cand))
    if not scored:
        return []
    scored.sort(key=lambda item: item[2]["row"].saved_at, reverse=True)  # 稳定排序
    scored.sort(key=lambda item: item[0], reverse=True)
    scored = scored[:limit]

    # 5) 只为最终返回的文档取正文，拼真实证据的解释与片段
    bodies = {
        r.id: r.plain_text or ""
        for r in session.execute(
            text(
                "SELECT id, plain_text FROM documents "
                "WHERE user_id = :user_id AND id = ANY(:ids)"
            ),
            {"user_id": uid, "ids": [did for _, did, _ in scored]},
        ).all()
    }

    hits: list[SearchHit] = []
    patterns = list(plan.patterns)
    for score, did, cand in scored:
        row = cand["row"]
        body = bodies.get(did, "")
        meta_text = _meta_text(row)
        summary_text = row.summary_text or ""
        matched_body = _matched(patterns, body)
        matched_summary = _matched(patterns, summary_text)
        matched_title = _matched(patterns, row.title or "")
        matched_meta = _matched(patterns, meta_text)
        chunk_content = sem.get(did, (0.0, None))[1]
        reason = _build_reason(
            plan.clean,
            matched_body,
            matched_summary,
            matched_title,
            matched_meta,
            has_semantic=cand["raw"]["semantic"] > 0.0,
            body_trgm_ok=float(row.body_trgm or 0) >= _TRGM_MIN,
            summary_trgm_ok=float(row.summary_trgm or 0) >= _TRGM_MIN,
            title_trgm_ok=float(row.title_trgm or 0) >= _TRGM_MIN,
            host=_host(row),
        )
        hits.append(
            SearchHit(
                document_id=str(did),
                title=row.title,
                url=row.original_url,
                source_type=row.source_type,
                site_name=row.site_name,
                summary=row.summary_short,
                score=score,
                match_reason=reason,
                matched_excerpt=_build_excerpt(
                    body, matched_body, chunk_content, summary_text, matched_summary
                ),
                saved_at=row.saved_at,
                parse_status=row.parse_status,
            )
        )
    return hits
