"""URL normalization, deduplication hashing and source detection. Normalization must stay conservative: only known tracking parameters are removed."""
from __future__ import annotations

import hashlib
import re
import uuid
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import ApiError
from app.models import Document

# Delete only these explicit tracking parameters and keep everything else (so the content identity does not change)
TRACKING_KEYS = {
    "gclid",
    "fbclid",
    "yclid",
    "igshid",
    "mc_cid",
    "mc_eid",
    "from",
    "sca",
    "spm",
    "weibo_id",
    "share_source",
    "share_medium",
    "share_plat",
    "share_session_id",
    "wx_header",
}
TRACKING_PREFIXES = ("utm_", "wt_", "hmsr", "hmci", "hmdt")

DEFAULT_PORTS = {"http": 80, "https": 443}

# Mobile share sheets often paste the title/description together with the link; on save, keep only the first http(s) link in it.
_URL_IN_TEXT_RE = re.compile(
    r"https?://[^\s<>\"'“”‘’（）\[\]{}，。；：！？、]+", re.IGNORECASE
)
_TRAILING_URL_PUNCT = ".,;:!?，。；：！？、\"'”’"


@dataclass(frozen=True)
class NormalizedUrl:
    original: str
    canonical: str
    url_hash: str
    host: str
    scheme: str
    source_type: str


def extract_first_url(raw: str) -> str | None:
    """Extract the first http(s) link from a bare URL or from share text."""
    match = _URL_IN_TEXT_RE.search(raw or "")
    if not match:
        return None
    candidate = match.group(0).rstrip(_TRAILING_URL_PUNCT)
    # Share/Markdown text often wraps the link in extra parentheses; trim only unpaired trailing parentheses.
    while candidate.endswith(")") and candidate.count(")") > candidate.count("("):
        candidate = candidate[:-1]
    return candidate


def detect_source_type(host: str) -> str:
    host = host.lower()
    if host == "mp.weixin.qq.com" or host.endswith(".weixin.qq.com") or host == "weixin.qq.com":
        return "wechat"
    if host in {"github.com", "www.github.com", "gist.github.com"}:
        return "github"
    if host in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}:
        return "youtube"
    if host in {"bilibili.com", "www.bilibili.com", "m.bilibili.com", "b23.tv"}:
        return "bilibili"
    if host in {"x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"}:
        return "twitter"
    return "web"


def _keep_query(key: str) -> bool:
    if key in TRACKING_KEYS:
        return False
    return not any(key.startswith(prefix) for prefix in TRACKING_PREFIXES)


def normalize_url(raw: str) -> NormalizedUrl:
    raw = (raw or "").strip()
    original = extract_first_url(raw) or raw
    if not original:
        raise ApiError("INVALID_URL", "请输入有效的 HTTP 或 HTTPS 链接。")
    try:
        parts = urlsplit(original)
    except ValueError as exc:
        raise ApiError("INVALID_URL", "请输入有效的 HTTP 或 HTTPS 链接。") from exc

    scheme = parts.scheme.lower()
    if scheme not in {"http", "https"}:
        raise ApiError("INVALID_URL", "请输入有效的 HTTP 或 HTTPS 链接。")
    if parts.username or parts.password:
        raise ApiError("INVALID_URL", "链接中不能包含账号信息。")

    host = (parts.hostname or "").lower()
    if not host:
        raise ApiError("INVALID_URL", "请输入有效的 HTTP 或 HTTPS 链接。")

    port = ""
    if parts.port is not None and parts.port != DEFAULT_PORTS[scheme]:
        port = f":{parts.port}"

    netloc = f"{host}{port}"
    if "[" in host:  # IPv6 literal
        ipv6 = host.split("%")[0]
        netloc = f"[{ipv6}]{port}"

    path = parts.path or ""
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")

    query_pairs = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if _keep_query(k)]
    query = urlencode(sorted(query_pairs, key=lambda kv: (kv[0], kv[1])))

    canonical = urlunsplit((scheme, netloc, path, query, ""))
    return NormalizedUrl(
        original=original,
        canonical=canonical,
        url_hash=sha256_text(canonical),
        host=host,
        scheme=scheme,
        source_type=detect_source_type(host),
    )


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def dedupe(session: Session, user_id: uuid.UUID | str, url_hash: str) -> Document | None:
    return session.scalar(
        select(Document).where(Document.user_id == user_id, Document.normalized_url_hash == url_hash)
    )
