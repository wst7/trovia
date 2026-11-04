"""视频页解析（YouTube / Bilibili / Twitter）：仅提取 OG 与 JSON-LD 元数据。

无字幕/转录能力，不伪造正文：有元数据时 parse_status='partial'。
"""
from __future__ import annotations

import re

from app.fetch import FetchResult
from app.logging import get_logger
from app.parsers.base import (
    ParseResult,
    clean_text,
    first_json_ld,
    host_of,
    make_soup,
    meta_content,
    parse_datetime,
)

logger = get_logger("trovia.parsers.video")

VIDEO_SOURCES = {"youtube", "bilibili", "twitter"}

_DURATION_RE = re.compile(r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$", re.I)


def _duration_seconds(value: str | None) -> int | None:
    """ISO-8601 时长（PT12M34S）或纯秒数 → 秒。"""
    text = (value or "").strip()
    if not text:
        return None
    match = _DURATION_RE.match(text)
    if match:
        hours = int(match.group(1) or 0)
        minutes = int(match.group(2) or 0)
        seconds = int(match.group(3) or 0)
        return hours * 3600 + minutes * 60 + seconds
    if text.isdigit():
        return int(text)
    return None


class VideoParser:
    name = "video"

    def matches(self, url: str, source_type: str) -> bool:
        return source_type in VIDEO_SOURCES

    def parse(self, fetched: FetchResult) -> ParseResult:
        try:
            return self._parse(fetched)
        except Exception as exc:
            logger.exception("video_parse_error", extra={"url": fetched.url})
            return ParseResult(
                source_type="web",
                original_url=fetched.url,
                canonical_url=fetched.final_url or fetched.url,
                parse_status="failed",
                error_code="PARSE_ERROR",
                error_message=f"视频页解析出错：{exc.__class__.__name__}",
                metadata={"parser": self.name},
            )

    def _parse(self, fetched: FetchResult) -> ParseResult:
        soup = make_soup(fetched.text)
        base_url = fetched.final_url or fetched.url
        video_ld = first_json_ld(soup, {"VideoObject"}) or {}

        title = (
            meta_content(soup, "og:title", "twitter:title")
            or clean_text(soup.title.get_text() if soup.title else None)
            or clean_text(video_ld.get("name"))
        )
        description = (
            meta_content(soup, "og:description", "twitter:description", "description")
            or clean_text(video_ld.get("description"))
        )
        author = None
        author_ld = video_ld.get("author")
        if isinstance(author_ld, dict):
            author = clean_text(str(author_ld.get("name") or ""))
        elif isinstance(author_ld, str):
            author = clean_text(author_ld)
        author = author or meta_content(soup, "twitter:creator", "article:author", "author")

        published_raw = (
            meta_content(soup, "article:published_time", "published_time", "date")
            or video_ld.get("uploadDate")
            or video_ld.get("datePublished")
        )
        published_at = parse_datetime(
            published_raw if isinstance(published_raw, str) else None
        )
        duration = _duration_seconds(
            video_ld.get("duration") or meta_content(soup, "video:duration", "duration")
        )
        site_name = meta_content(soup, "og:site_name") or host_of(base_url)
        language = clean_text(soup.html.get("lang") if soup.html else None)
        video_url = meta_content(soup, "og:video", "og:video:url", "twitter:player")

        metadata: dict = {
            "parser": self.name,
            "duration_seconds": duration,
            "video_url": video_url,
            "has_transcript": False,
        }

        if title or description:
            status = "partial"
            code = None
            message = "视频页面仅保存了元数据，未获取字幕或正文内容。"
        else:
            status = "failed"
            code = "CONTENT_NOT_FOUND"
            message = "页面中没有可识别的视频元数据。"

        return ParseResult(
            source_type="web",
            original_url=fetched.url,
            canonical_url=base_url,
            title=title,
            author=author,
            published_at=published_at,
            site_name=site_name,
            description=description,
            content_markdown=None,
            plain_text=None,
            images=[],
            links=[],
            language=language,
            parse_status=status,
            error_code=code,
            error_message=message,
            metadata=metadata,
        )
