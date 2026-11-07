"""Shared parser contract (6.3) and HTML helper utilities."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Protocol
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup

from app.fetch import FetchResult

WECHAT_TZ = timezone(timedelta(hours=8))  # WeChat article timestamps are in Beijing time


@dataclass
class ParseResult:
    source_type: str
    original_url: str
    canonical_url: str
    title: str | None = None
    author: str | None = None
    published_at: datetime | None = None
    site_name: str | None = None
    description: str | None = None
    content_markdown: str | None = None
    plain_text: str | None = None
    images: list[str] = field(default_factory=list)
    links: list[str] = field(default_factory=list)
    language: str | None = None
    parse_status: str = "completed"  # completed | partial | failed
    error_code: str | None = None
    error_message: str | None = None
    metadata: dict = field(default_factory=dict)


class Parser(Protocol):
    name: str

    def matches(self, url: str, source_type: str) -> bool: ...

    def parse(self, fetched: FetchResult) -> ParseResult: ...


# ---------------------------------------------------------------- HTML helpers

_WS_RE = re.compile(r"[ \t\r\f\v 　]+")


def make_soup(html: str) -> BeautifulSoup:
    try:
        return BeautifulSoup(html or "", "lxml")
    except Exception:
        return BeautifulSoup(html or "", "html.parser")


def clean_text(value: str | None) -> str | None:
    """Collapse whitespace; returning None means the value is missing."""
    if value is None:
        return None
    text = _WS_RE.sub(" ", value)
    text = re.sub(r"\s*\n\s*", "\n", text).strip()
    return text or None


def meta_content(soup: BeautifulSoup, *names: str) -> str | None:
    """Look up the content of meta/property/itemprop in order."""
    for name in names:
        tag = soup.find("meta", attrs={"property": name}) or soup.find(
            "meta", attrs={"name": name}
        ) or soup.find("meta", attrs={"itemprop": name})
        if tag is not None:
            value = clean_text(tag.get("content"))
            if value:
                return value
    return None


def parse_json_ld(soup: BeautifulSoup) -> list[dict]:
    """Extract every JSON-LD script; parse failures are ignored."""
    payloads: list[dict] = []
    for script in soup.find_all("script", attrs={"type": re.compile("ld\\+json", re.I)}):
        raw = script.string or script.get_text() or ""
        raw = raw.strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            continue
        if isinstance(data, dict):
            payloads.append(data)
        elif isinstance(data, list):
            payloads.extend(item for item in data if isinstance(item, dict))
    return payloads


def first_json_ld(soup: BeautifulSoup, types: set[str]) -> dict | None:
    """Find the JSON-LD object whose @type matches (including ones nested inside @graph)."""
    wanted = {t.lower() for t in types}

    def _walk(obj: dict) -> dict | None:
        raw_type = obj.get("@type")
        names = raw_type if isinstance(raw_type, list) else [raw_type]
        if any(isinstance(n, str) and n.lower() in wanted for n in names):
            return obj
        graph = obj.get("@graph")
        if isinstance(graph, list):
            for item in graph:
                if isinstance(item, dict):
                    found = _walk(item)
                    if found is not None:
                        return found
        return None

    for payload in parse_json_ld(soup):
        found = _walk(payload)
        if found is not None:
            return found
    return None


_EPOCH_RE = re.compile(r"^\d{10}(\d{3})?$")
_TIME_FORMATS = (
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d",
    "%Y/%m/%d %H:%M",
    "%Y/%m/%d",
)


def parse_datetime(value: str | None) -> datetime | None:
    """Parse common publish-time formats and normalize to UTC; a timestamp without zone information is treated as UTC."""
    text = (value or "").strip()
    if not text:
        return None
    if _EPOCH_RE.match(text):
        return datetime.fromtimestamp(int(text), tz=timezone.utc)
    iso = text.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(iso)
        dt = dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        pass
    for fmt in _TIME_FORMATS:
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def absolute_urls(base: str, urls: list[str], *, limit: int = 50) -> list[str]:
    """Turn into absolute URLs, keep only http(s), deduplicate preserving order, truncate to limit."""
    seen: set[str] = set()
    result: list[str] = []
    for url in urls:
        if not url:
            continue
        absolute = urljoin(base, url.strip())
        scheme = urlsplit(absolute).scheme.lower()
        if scheme not in {"http", "https"}:
            continue
        if absolute in seen:
            continue
        seen.add(absolute)
        result.append(absolute)
        if len(result) >= limit:
            break
    return result


def host_of(url: str) -> str | None:
    try:
        return urlsplit(url).hostname
    except ValueError:
        return None
