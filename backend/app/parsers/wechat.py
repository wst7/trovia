"""WeChat official-account articles (mp.weixin.qq.com): fault-tolerant extraction with several selector sets."""
from __future__ import annotations

import re
from datetime import datetime, timezone

from app.fetch import FetchResult
from app.logging import get_logger
from app.parsers.base import (
    WECHAT_TZ,
    ParseResult,
    absolute_urls,
    clean_text,
    make_soup,
    meta_content,
    parse_datetime,
)

logger = get_logger("trovia.parsers.wechat")

_TITLE_SUFFIX_RE = re.compile(r"\s*[-|–—]\s*微信公众平台\s*$")
_CT_RE = re.compile(r"""var\s+ct\s*=\s*["']?(\d{10})""")
_CREATE_TIME_RE = re.compile(r"""createTime\s*=\s*['"]([\d-]+ [\d:]+)['"]""")


def _first_text(soup, selectors: list[str]) -> str | None:
    for selector in selectors:
        node = soup.select_one(selector)
        if node is not None:
            text = clean_text(node.get_text(" ", strip=True))
            if text:
                return text
    return None


def _parse_publish_time(soup, fetched_text: str) -> datetime | None:
    raw = (
        _first_text(soup, ["#publish_time", "#publish_time2", ".rich_media_meta_text"])
        or meta_content(soup, "og:article:published_time", "article:published_time")
    )
    dt = parse_datetime(raw)
    if dt is not None:
        return dt.astimezone(timezone.utc)
    match = _CT_RE.search(fetched_text or "")
    if match:
        return datetime.fromtimestamp(int(match.group(1)), tz=timezone.utc)
    match = _CREATE_TIME_RE.search(fetched_text or "")
    if match:
        dt = parse_datetime(match.group(1))
        if dt is not None:
            return dt.replace(tzinfo=WECHAT_TZ).astimezone(timezone.utc)
    return None


def _inline_text(node) -> str:
    """Inline joining: Chinese is concatenated directly, a space is inserted between two ASCII words."""
    result = ""
    for part in node.stripped_strings:
        if not part:
            continue
        if (
            result
            and not result[-1].isspace()
            and not part[0].isspace()
            and result[-1].isascii()
            and result[-1].isalnum()
            and part[0].isascii()
            and part[0].isalnum()
        ):
            result += " "
        result += part
    return clean_text(result)


def _content_markdown(node) -> tuple[str | None, str | None, list[str], list[str]]:
    """Produce (markdown, plain_text, images, links) from the body node."""
    images = [
        img.get("data-src") or img.get("data-original") or img.get("src") or ""
        for img in node.find_all("img")
    ]
    links = [a.get("href") or "" for a in node.find_all("a", href=True)]

    paragraphs: list[str] = []
    blocks = node.find_all(["h1", "h2", "h3", "h4", "p", "li", "blockquote"])
    if not blocks:
        blocks = [node]
    for block in blocks:
        text = _inline_text(block)
        if not text:
            continue
        if paragraphs and paragraphs[-1] == text:  # nested container repeat
            continue
        paragraphs.append(text)
    if not paragraphs:
        return None, None, images, links

    text_all = "\n\n".join(paragraphs).strip()
    return text_all or None, text_all or None, images, links


class WechatParser:
    name = "wechat"

    def matches(self, url: str, source_type: str) -> bool:
        return source_type == "wechat"

    def parse(self, fetched: FetchResult) -> ParseResult:
        try:
            return self._parse(fetched)
        except Exception as exc:
            logger.exception("wechat_parse_error", extra={"url": fetched.url})
            return ParseResult(
                source_type="wechat",
                original_url=fetched.url,
                canonical_url=fetched.final_url or fetched.url,
                parse_status="failed",
                error_code="PARSE_ERROR",
                error_message=f"微信文章解析出错：{exc.__class__.__name__}",
                metadata={"parser": self.name},
            )

    def _parse(self, fetched: FetchResult) -> ParseResult:
        soup = make_soup(fetched.text)
        base_url = fetched.final_url or fetched.url

        raw_title = _first_text(soup, ["#activity-name", ".rich_media_title", "h1#activity-name"])
        if not raw_title:
            raw_title = clean_text(soup.title.get_text() if soup.title else None)
        title = _TITLE_SUFFIX_RE.sub("", raw_title) if raw_title else None

        account = _first_text(
            soup, ["#js_name", ".profile_nickname", "#js_nickname", ".rich_media_meta_nickname"]
        )
        author = (
            _first_text(soup, ["#js_author_name", "#js_author_name_list"])
            or meta_content(soup, "og:article:author", "article:author")
            or account
        )
        published_at = _parse_publish_time(soup, fetched.text)
        description = meta_content(soup, "og:description", "twitter:description")
        language = clean_text(soup.html.get("lang") if soup.html else None) or "zh-CN"

        content_node = None
        for selector in ("#js_content", ".rich_media_content", "#page-content .rich_media_content"):
            content_node = soup.select_one(selector)
            if content_node is not None:
                break

        images: list[str] = []
        links: list[str] = []
        markdown = None
        plain_text = None
        if content_node is not None:
            markdown, plain_text, raw_images, raw_links = _content_markdown(content_node)
            images = absolute_urls(base_url, raw_images, limit=20)
            links = absolute_urls(base_url, raw_links, limit=50)

        metadata: dict = {
            "parser": self.name,
            "account": account,
            "images": images,
            "links": links,
        }

        if plain_text:
            status, code, message = "completed", None, None
        elif title or account:
            status = "partial"
            code = "CONTENT_NOT_FOUND"
            message = "未能提取微信文章正文（页面可能需要在微信内打开或结构已变化），仅保存了元数据。"
        else:
            status = "failed"
            code = "CONTENT_NOT_FOUND"
            message = "页面中没有可识别的微信文章内容。"

        return ParseResult(
            source_type="wechat",
            original_url=fetched.url,
            canonical_url=base_url,
            title=title,
            author=author,
            published_at=published_at,
            site_name="微信公众号" + (f" · {account}" if account else ""),
            description=description,
            content_markdown=markdown,
            plain_text=plain_text,
            images=images,
            links=links,
            language=language,
            parse_status=status,
            error_code=code,
            error_message=message,
            metadata=metadata,
        )
