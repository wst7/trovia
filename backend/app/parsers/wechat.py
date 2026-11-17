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
_CT_RE = re.compile(r"""(?:var\s+ct|window\.ct)\s*=\s*["']?(\d{10})""")
_CREATE_TIME_RE = re.compile(r"""createTime\s*=\s*['"]([\d-]+ [\d:]+)['"]""")


# Shared pages (opened outside WeChat) have no rendered #js_content: the body
# lives inside an inline object, e.g. window.cgiDataNew = { ..., content_noencode: '...' }.
_SINGLE_QUOTED_RE = re.compile(r"""\n\s+([A-Za-z_]\w*):\s*'((?:[^'\\]|\\.)*)'""")
_DOUBLE_QUOTED_RE = re.compile(r"""\n\s+([A-Za-z_]\w*):\s*"((?:[^"\\]|\\.)*)\"""", re.S)
_JS_SIMPLE_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}
_TZ_HINT_RE = re.compile(r"(Z\b|[+-]\d{2}:?\d{2}\b|\bGMT\b|\bUTC\b)", re.I)


def _js_unescape(value: str) -> str:
    """Decode \\xHH / \\uHHHH / \\n escapes without touching the UTF-8 itself."""
    out: list[str] = []
    index, size = 0, len(value)
    while index < size:
        char = value[index]
        if char != "\\" or index + 1 >= size:
            out.append(char)
            index += 1
            continue
        nxt = value[index + 1]
        if nxt == "x" and index + 3 < size:
            try:
                out.append(chr(int(value[index + 2 : index + 4], 16)))
                index += 4
                continue
            except ValueError:
                pass
        elif nxt == "u" and index + 5 < size:
            try:
                out.append(chr(int(value[index + 2 : index + 6], 16)))
                index += 6
                continue
            except ValueError:
                pass
        out.append(_JS_SIMPLE_ESCAPES.get(nxt, nxt))
        index += 2
    return "".join(out)


def _js_payload(text: str, limit: int = 400_000) -> dict[str, str]:
    """Pull top-level string fields out of the inline cgiDataNew object."""
    start = (text or "").find("cgiDataNew")
    if start < 0:
        return {}
    segment = text[start : start + limit]
    fields: dict[str, str] = {}
    for pattern in (_SINGLE_QUOTED_RE, _DOUBLE_QUOTED_RE):
        for match in pattern.finditer(segment):
            fields.setdefault(match.group(1), _js_unescape(match.group(2)))
    return fields


def _payload_text(raw: str | None) -> str | None:
    """Inline bodies are plain text: trim each line but keep paragraph breaks."""
    if not raw:
        return None
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    out: list[str] = []
    previous_blank = False
    for line in text.split("\n"):
        stripped = line.strip()
        if stripped:
            out.append(stripped)
            previous_blank = False
        elif out and not previous_blank:
            out.append("")
            previous_blank = True
    return "\n".join(out).strip() or None


def _first_text(soup, selectors: list[str]) -> str | None:
    for selector in selectors:
        node = soup.select_one(selector)
        if node is not None:
            text = clean_text(node.get_text(" ", strip=True))
            if text:
                return text
    return None


def _parse_wechat_time(raw: str | None) -> datetime | None:
    """WeChat prints Beijing wall-clock time; parse_datetime treats naive input as UTC."""
    text = (raw or "").strip()
    if not text:
        return None
    dt = parse_datetime(text)
    if dt is None:
        return None
    if _TZ_HINT_RE.search(text):
        return dt.astimezone(timezone.utc)
    return dt.replace(tzinfo=WECHAT_TZ).astimezone(timezone.utc)


def _parse_publish_time(
    soup, fetched_text: str, payload: dict[str, str] | None = None
) -> datetime | None:
    payload = payload or {}
    raw = (
        _first_text(soup, ["#publish_time", "#publish_time2", ".rich_media_meta_text"])
        or meta_content(soup, "og:article:published_time", "article:published_time")
        or payload.get("create_time")
        or payload.get("ori_create_time")
    )
    dt = _parse_wechat_time(raw)
    if dt is not None:
        return dt
    match = _CT_RE.search(fetched_text or "")
    if match:
        return datetime.fromtimestamp(int(match.group(1)), tz=timezone.utc)
    match = _CREATE_TIME_RE.search(fetched_text or "")
    if match:
        return _parse_wechat_time(match.group(1))
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


_HEADING_TAGS = {"h1": 1, "h2": 2, "h3": 3, "h4": 4}


def _list_depth(node) -> int:
    """How deep an <li> sits: 0 is the outermost list."""
    depth = 0
    parent = node.parent
    while parent is not None:
        if getattr(parent, "name", None) in ("ul", "ol"):
            depth += 1
        parent = parent.parent
    return max(0, depth - 1)


def _list_marker(node, text: str) -> str:
    """Ordered lists keep the author's number; nesting becomes two spaces per level."""
    indent = "  " * _list_depth(node)
    parent = node.parent
    if getattr(parent, "name", None) != "ol":
        return f"{indent}- {text}"
    index = 0
    for sibling in parent.find_all("li", recursive=False):
        index += 1
        if sibling is node:
            break
    return f"{indent}{index}. {text}"


def _content_markdown(node) -> tuple[str | None, str | None, list[str], list[str]]:
    """Produce (markdown, plain_text, images, links) from the body node.

    WeChat bodies have real headings, lists and quotes. Flattening them into
    paragraphs is what makes the detail screen read as a wall of text, so keep
    `##` / `- ` / `1.` / `> ` here and let the renderer lay them out.
    """
    images = [
        img.get("data-src") or img.get("data-original") or img.get("src") or ""
        for img in node.find_all("img")
    ]
    links = [a.get("href") or "" for a in node.find_all("a", href=True)]

    lines: list[str] = []
    blocks = node.find_all(["h1", "h2", "h3", "h4", "p", "li", "blockquote"])
    if not blocks:
        blocks = [node]

    for block in blocks:
        text = _inline_text(block)
        if not text:
            continue
        name = getattr(block, "name", "")
        if name in _HEADING_TAGS:
            line = f"{'#' * _HEADING_TAGS[name]} {text}"
        elif name == "li":
            line = _list_marker(block, text)
        elif name == "blockquote":
            line = f"> {text}"
        else:
            line = text

        if lines and lines[-1] == line:  # nested container repeat
            continue
        if lines and name not in ("li", "blockquote") and lines[-1].startswith(("#", "- ", "> ")):
            lines.append("")
        lines.append(line)

    if not lines:
        return None, None, images, links

    markdown = "\n".join(lines).strip()
    plain = re.sub(r"^(?:#{1,4} |- |\d+\. |> )", "", markdown, flags=re.M)
    return markdown or None, plain.strip() or None, images, links


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
        payload = _js_payload(fetched.text or "")

        raw_title = (
            _first_text(soup, ["#activity-name", ".rich_media_title", "h1#activity-name"])
            or meta_content(soup, "og:title", "twitter:title")
            or payload.get("title")
        )
        if not raw_title:
            raw_title = clean_text(soup.title.get_text() if soup.title else None)
        title = _TITLE_SUFFIX_RE.sub("", raw_title) if raw_title else None

        account = (
            _first_text(
                soup, ["#js_name", ".profile_nickname", "#js_nickname", ".rich_media_meta_nickname"]
            )
            or payload.get("nick_name")
        )
        author = (
            _first_text(soup, ["#js_author_name", "#js_author_name_list"])
            or meta_content(soup, "og:article:author", "article:author")
            or payload.get("author")
            or account
        )
        published_at = _parse_publish_time(soup, fetched.text, payload)
        description = (
            meta_content(soup, "og:description", "twitter:description")
            or clean_text(payload.get("desc"))
        )
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
        extraction = "dom"
        if content_node is not None:
            markdown, plain_text, raw_images, raw_links = _content_markdown(content_node)
            images = absolute_urls(base_url, raw_images, limit=20)
            links = absolute_urls(base_url, raw_links, limit=50)

        if not plain_text:  # shared pages keep the body only inside the inline JSON
            inline_text = _payload_text(payload.get("content_noencode") or payload.get("content"))
            if inline_text and len(inline_text) >= 40:
                markdown = plain_text = inline_text
                extraction = "js_payload"

        metadata: dict = {
            "parser": self.name,
            "account": account,
            "images": images,
            "links": links,
            "extraction": extraction,
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
