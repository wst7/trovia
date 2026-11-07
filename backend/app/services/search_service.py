"""Hybrid retrieval: four-way recall + min-max normalization over the candidate set + weighted fusion with the configured weights.

Four-way recall (every channel forces a user_id filter; deletes are hard deletes, so a row that no longer exists is invisible) and the source of each raw score:

=================== ==========================================================
Channel             Raw score (max within the channel)
=================== ==========================================================
Full-text (fts)     ts_rank_cd(to_tsvector('simple', title||summary||plain_text),
                    websearch_to_tsquery('simple', terms OR ...)) raw r → r/(r+1) ∈ [0,1)
Trigram (trgm)      similarity(title, clean_q), similarity(summary, clean_q),
                    similarity(plain_text, clean_q) raw values; evidence only when
                    ≥ _TRGM_MIN (Chinese has no word segmentation, so shared
                    substrings of 3+ characters are caught here; long bodies get
                    diluted by length)
Literal (ILIKE)     the terms cut out of the query after stripping narrative
                    shells such as "I read an article before" / "help me find"
                    (plus the whole query string / clean_q), ILIKE-matched against
                    title / summary / plain_text / keywords / topics / site_name /
                    author / description / URL;
                    evidence = matched pattern count / total pattern count
Semantic (pgvector) embed the query, then take top-N chunks by cosine distance
                    (search_vector_candidates), aggregate the best chunk per
                    document, cos = 1 - distance, and count it as evidence only
                    when ≥ _SEMANTIC_MIN_COS (measured noise for unrelated
                    queries with the local hash embedding ≤0.06)
=================== ==========================================================

The four channel scores map onto four weighted dimensions (weights = settings.search_weights, default lexical 0.35 / semantic 0.35 / title 0.20 / meta 0.10):

- lexical = max(full-text r/(r+1), body/summary trigram, body/summary literal hit rate)
- title   = max(title full-text rank, title trigram, title literal hit rate)
- meta    = literal hit rate over keywords/topics/site_name/author/description/URL
- semantic= cosine similarity of that document's best chunk

Fusion formula (candidate set = documents hit by at least one channel; inside the candidate set a channel that missed a document contributes 0):

    score = clip01( Σ_channel weight_channel × minmax_channel(raw) )

minmax computes (x - min)/(max - min) inside the candidate set: a channel that is all 0 → all 0; a channel where every value is the same positive number → all 1. Results below settings.search_min_score are dropped, then the top `limit` are taken by descending score (ties by descending saved_at). No model call happens during search apart from the single _embed_query query embedding.

match_reason templates (every clause maps to real evidence; a listed matched term must actually exist in the corresponding field; never invent content the body does not have). The emitted strings wrap the query and the terms in Chinese corner brackets, join clauses with a Chinese comma, and end with a Chinese full stop; they are shown below with ASCII punctuation:

- Body literal hit:         body relates to "{query}": matched keywords "t1", "t2"
- Body trigram-only:        body content is similar to "{query}"
- Summary literal hit:      summary matched keywords "t1", "t2" (only terms absent from the body are listed)
- Summary trigram-only:     summary content is similar to "{query}"
- Title literal hit:        title matched keywords "t1", "t2"
- Title trigram-only:       title is similar to "{query}" (only mentioned when there is no body evidence)
- Metadata hit:             source information matched keywords "t1", "t2"
- Semantic + other:         semantically close to the content you described
- Semantic only:            body is semantically close to the content you described
- Up to 2 matched terms are listed per clause, longest first (the more specific term wins).

matched_excerpt: context window around a body matched term (≤200 characters, ellipsis at the truncation point) → context window around a summary matched term → the snippet of the semantically matched chunk → first sentence of the summary → None. Never fabricated.
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

# Absolute thresholds for candidate admission and scoring (basis: a real Chinese substring title hit scores similarity ≥0.10,
# an unrelated string =0; measured cosine noise for unrelated queries with the local hash embedding is ≤0.06)
_TRGM_MIN = 0.05
_SEMANTIC_MIN_COS = 0.1

_MAX_TERMS = 12          # cap on terms, so the pattern count can't explode
_MAX_REASON_TERMS = 2    # how many matched terms each match_reason clause may list
_EXCERPT_MAX = 200       # max length of matched_excerpt (ellipsis included)
_EXCERPT_CONTEXT = 40    # characters of context before the matched term

_CHANNELS = ("lexical", "semantic", "title", "meta")

_TERM_SPLIT_RE = re.compile(r"[\s,.;:!?，。！？；：、…·\"'“”‘’（）()【】\[\]<>《》—\-_/\\]+")

# Natural-language recall in Chinese often carries a narrative or question shell; strip these phrases first and keep only content words.
# Phrases go into the regex longest first, so the short "saw it before" doesn't swallow the longer "saw an article about it".
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

# Split where Latin and CJK scripts meet, so a Latin word glued to Chinese (e.g. "AI" + "browser automation") still yields separate terms.
_SCRIPT_BOUNDARY_RE = re.compile(
    r"(?<=[A-Za-z0-9])(?=[㐀-鿿])|(?<=[㐀-鿿])(?=[A-Za-z0-9])"
)

# A lone Chinese function word or generic verb takes no part in matching; single-character content words (e.g. "cat") are kept.
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
# Query preprocessing
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
    """Strip the narrative/question shell, then cut the content terms out by punctuation, whitespace and Latin/CJK boundaries."""
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
        # When the whole sentence is function words or punctuation, fall back to the raw string, preserving "no evidence means empty result".
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
    """Patterns that really occur in haystack (the Python-side equivalent of the ILIKE check, used for explanations)."""
    low = haystack.lower()
    return [p for p in patterns if p and p.lower() in low]


# ---------------------------------------------------------------------------
# Recall
# ---------------------------------------------------------------------------

def _embed_query(query: str, settings: Settings) -> list[float] | None:
    """Embed the query: the only model call during search; on failure degrade to no semantic channel."""
    try:
        vectors = get_embedding_provider(settings).embed([query])
    except Exception as exc:  # A semantic-channel failure must not take lexical search down with it
        logger.warning("query_embed_failed", extra={"error": str(exc)})
        return None
    if not vectors or not vectors[0]:
        return None
    return [float(x) for x in vectors[0]]


def _semantic_candidates(
    session: Session, uid: uuid.UUID, query: str, settings: Settings
) -> dict[uuid.UUID, tuple[float, str | None]]:
    """Semantic recall: top-N chunks ordered by ascending distance, taking the first (= best) chunk of every document."""
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
            continue  # Already ordered by distance, so the first sighting is that document's best chunk
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
    """Candidate rows of the full-text/trigram/literal channels (including the documents that made the semantic cut, so their fields can be displayed)."""
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
# Scoring and fusion
# ---------------------------------------------------------------------------

def _minmax(values: dict[uuid.UUID, float]) -> dict[uuid.UUID, float]:
    """Min-max normalize to [0,1] inside the candidate set; all 0 → all 0; identical positive values → all 1."""
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
    # The summary is also something users remember: it shares the lexical dimension with the body, so a summary-only hit still recalls.
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
# Result explanation (all grounded in real evidence)
# ---------------------------------------------------------------------------

def _display_terms(matched: list[str]) -> str:
    picked: list[str] = []
    for term in sorted(matched, key=len, reverse=True):
        if any(term in already for already in picked):
            continue  # Already contained in a longer matched term; don't list it twice
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
    # The summary is usually extracted from the body, so terms already listed aren't repeated; a summary-only hit gets its own clause.
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
    if not segs:  # Defensive: there is recall evidence but the literal check listed no terms (e.g. only a full-text rank hit)
        segs.append(f"命中与「{query}」相关的内容")
    reason = "，".join(segs)
    if host:
        reason += f"（来源 {host}）"
    return reason + "。"


def _slice_around(text_: str, pos: int) -> str:
    """Take a window starting at pos, add an ellipsis where it is truncated, total length ≤ _EXCERPT_MAX."""
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
# Entry point
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

    # 1) Semantic recall (the only embedding call; uses content words with the narrative shell stripped, to cut function-word noise)
    sem = _semantic_candidates(session, uid, plan.clean, settings)

    # 2) Full-text / trigram / literal recall (including the fields of documents that made the semantic cut)
    rows = _lexical_candidates(session, uid, plan, like_patterns, set(sem), settings)

    # 3) Raw score per channel
    candidates: dict[uuid.UUID, dict] = {}
    for row in rows:
        raw = _row_raw_scores(row, list(plan.patterns), sem.get(row.id, (0.0, None))[0])
        if max(raw.values()) <= 0.0:
            continue  # Fallback for when the admission condition and the raw scores disagree (e.g. a full-text rank of 0)
        candidates[row.id] = {"row": row, "raw": raw}
    if not candidates:
        return []

    # 4) min-max within the candidate set → weighted fusion → threshold → sort and truncate
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
    scored.sort(key=lambda item: item[2]["row"].saved_at, reverse=True)  # stable sort
    scored.sort(key=lambda item: item[0], reverse=True)
    scored = scored[:limit]

    # 5) Fetch bodies only for the documents finally returned, to assemble the real-evidence explanation and excerpt
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
